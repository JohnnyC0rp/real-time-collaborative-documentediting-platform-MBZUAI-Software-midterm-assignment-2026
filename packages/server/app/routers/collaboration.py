from __future__ import annotations

from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.collaboration import CollaborationHub
from app.dependencies import get_json_store
from app.errors import AppError, authentication_required
from app.guest_access import resolve_guest_document_access
from app.routers.documents import (
    WRITE_ROLES,
    normalize_title,
    resolve_document_for_user,
    to_public_user,
    to_version_response
)
from app.security import decode_token, utc_now
from app.store import JsonStore

router = APIRouter(prefix="/api/collaboration", tags=["collaboration"])

hub = CollaborationHub()


def get_current_document_version_id(document: dict[str, Any]) -> str:
    versions = document.get("versions", [])
    if not versions:
        raise AppError(500, "SERVER_ERROR", "Document versions are missing")
    return versions[-1]["id"]


def collaboration_document_payload(document: dict[str, Any], store: JsonStore) -> dict[str, Any]:
    latest_version = document["versions"][-1] if document.get("versions") else None
    return {
        "id": document["id"],
        "title": document["title"],
        "content": document["content"],
        "updated_at": document["updated_at"],
        "version_id": get_current_document_version_id(document),
        "merge_strategy": document.get("_merge_strategy", "direct"),
        "latest_version": (
            to_version_response(latest_version, store).model_dump(mode="json")
            if latest_version is not None
            else None
        )
    }


def authenticate_websocket_user(token: str | None, store: JsonStore) -> dict[str, Any]:
    if not token:
        raise authentication_required()

    payload = decode_token(token, expected_type="access")
    user_id = payload.get("sub")
    if not user_id:
        raise authentication_required("Malformed authentication token")

    user = store.get_user_by_id(user_id)
    if user is None:
        raise authentication_required("User no longer exists")

    return user


def resolve_websocket_actor(
    *,
    token: str | None,
    share_token: str | None,
    guest_key: str | None,
    document_id: str,
    store: JsonStore
) -> tuple[dict[str, Any], dict[str, Any], str]:
    if token:
        current_user = authenticate_websocket_user(token, store)
        document, role = resolve_document_for_user(
            document_id=document_id,
            current_user=current_user,
            store=store
        )
        return current_user, document, role

    document, role, guest_user, _share_link = resolve_guest_document_access(
        share_token=share_token,
        guest_key=guest_key,
        store=store
    )
    if document["id"] != document_id:
        raise AppError(404, "NOT_FOUND", "Document not found")
    return guest_user, document, role


@router.websocket("/documents/{document_id}")
async def collaborate_on_document(websocket: WebSocket, document_id: str) -> None:
    store = get_json_store()
    token = websocket.query_params.get("token")
    share_token = websocket.query_params.get("share_token")
    guest_key = websocket.query_params.get("guest_key")

    try:
        current_user, document, role = resolve_websocket_actor(
            token=token,
            share_token=share_token,
            guest_key=guest_key,
            document_id=document_id,
            store=store
        )
    except AppError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    connected_at = utc_now().isoformat()
    connection = await hub.connect(
        document_id=document_id,
        websocket=websocket,
        user=current_user,
        role=role,
        connected_at=connected_at
    )

    await websocket.send_json(
        {
            "type": "snapshot",
            "document": collaboration_document_payload(document, store),
            "presence": await hub.presence_for_document(document_id)
        }
    )
    await hub.send_presence(document_id)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if share_token:
                try:
                    current_user, document, role = resolve_websocket_actor(
                        token=None,
                        share_token=share_token,
                        guest_key=guest_key,
                        document_id=document_id,
                        store=store
                    )
                except AppError:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return

            if message_type == "ping":
                await websocket.send_json(
                    {
                        "type": "ack",
                        "document": collaboration_document_payload(
                            store.get_document_by_id(document_id) or document,
                            store
                        )
                    }
                )
                continue

            if message_type == "activity":
                await hub.touch(
                    document_id,
                    connection.id,
                    utc_now().isoformat(),
                    selection_from=message.get("selection_from"),
                    selection_to=message.get("selection_to"),
                    selection_preview=message.get("selection_preview")
                )
                await hub.send_presence(document_id)
                continue

            if message_type != "document.update":
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "VALIDATION_ERROR",
                        "message": "Unsupported collaboration message type"
                    }
                )
                continue

            if role not in WRITE_ROLES:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "FORBIDDEN",
                        "message": "Your role cannot modify this document"
                    }
                )
                continue

            title = normalize_title(str(message.get("title", "")))
            content = str(message.get("content", ""))
            updated_at = utc_now().isoformat()
            updated_document = store.update_document(
                document_id=document_id,
                title=title,
                content=content,
                base_version_id=message.get("base_version_id"),
                base_title=message.get("base_title"),
                base_content=message.get("base_content"),
                updated_at=updated_at,
                updated_by_user_id=current_user["id"],
                source="autosave"
            )
            if updated_document is None:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "NOT_FOUND",
                        "message": "Document not found"
                    }
                )
                continue

            document = updated_document
            active_at = utc_now().isoformat()
            await hub.touch(
                document_id,
                connection.id,
                active_at,
                selection_from=message.get("selection_from"),
                selection_to=message.get("selection_to"),
                selection_preview=message.get("selection_preview")
            )

            await websocket.send_json(
                {
                    "type": "ack",
                    "document": collaboration_document_payload(updated_document, store)
                }
            )
            await hub.broadcast(
                document_id=document_id,
                exclude_connection_id=connection.id,
                payload={
                    "type": "document.updated",
                    "document": collaboration_document_payload(updated_document, store),
                    "updated_by": to_public_user(current_user).model_dump(mode="json")
                }
            )
            await hub.send_presence(document_id)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(document_id, connection.id)
        await hub.send_presence(document_id)
