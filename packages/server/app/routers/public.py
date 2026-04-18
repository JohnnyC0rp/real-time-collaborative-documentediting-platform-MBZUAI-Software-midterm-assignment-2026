from fastapi import APIRouter, Depends, Header

from app.dependencies import get_json_store
from app.errors import AppError
from app.guest_access import resolve_guest_document_access
from app.routers.documents import normalize_title, to_document_detail
from app.schemas import GuestAccessSessionRequest, GuestAccessSessionResponse, UpdateDocumentRequest
from app.routers.documents import WRITE_ROLES, require_role
from app.routers.documents import to_public_user
from app.security import utc_now
from app.store import JsonStore

router = APIRouter(prefix="/api/public", tags=["public access"])


@router.post("/share-links/{share_token}/session", response_model=GuestAccessSessionResponse)
def create_guest_access_session(
    share_token: str,
    payload: GuestAccessSessionRequest,
    store: JsonStore = Depends(get_json_store)
) -> GuestAccessSessionResponse:
    document, role, guest_user, _share_link = resolve_guest_document_access(
        share_token=share_token,
        guest_key=payload.guest_key,
        store=store
    )
    return GuestAccessSessionResponse(
        actor=to_public_user(guest_user),
        role=role,
        document=to_document_detail(document, role, store)
    )


@router.put("/share-links/{share_token}/documents/{document_id}")
def update_guest_document(
    share_token: str,
    document_id: str,
    payload: UpdateDocumentRequest,
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
    store: JsonStore = Depends(get_json_store)
):
    document, role, guest_user, _share_link = resolve_guest_document_access(
        share_token=share_token,
        guest_key=guest_key,
        store=store
    )
    if document["id"] != document_id:
        raise AppError(404, "NOT_FOUND", "Document not found")

    require_role(role, WRITE_ROLES, "This share link cannot edit the document")

    if payload.title is None and payload.content is None:
        raise AppError(400, "VALIDATION_ERROR", "Nothing to update")

    next_title = normalize_title(payload.title) if payload.title is not None else None
    updated = store.update_document(
        document_id=document["id"],
        title=next_title,
        content=payload.content,
        base_version_id=payload.base_version_id,
        base_title=payload.base_title,
        base_content=payload.base_content,
        updated_at=utc_now().isoformat(),
        updated_by_user_id=guest_user["id"],
        source=payload.save_source
    )
    if updated is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(updated, role, store)
