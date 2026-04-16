import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.ai import AiProviderError, build_ai_request, get_ai_provider
from app.config import get_settings
from app.dependencies import get_current_user, get_json_store
from app.errors import AppError
from app.routers.documents import WRITE_ROLES, require_role, resolve_document_for_user, to_document_detail
from app.schemas import DocumentDetailResponse, GenerateAiSuggestionRequest, UpdateAiInteractionStatusRequest
from app.security import utc_now
from app.store import JsonStore

router = APIRouter(prefix="/api/documents", tags=["ai"])


def encode_event(payload: dict) -> bytes:
    return (json.dumps(payload) + "\n").encode("utf-8")


@router.post("/{document_id}/ai/stream")
async def stream_ai_suggestion(
    document_id: str,
    payload: GenerateAiSuggestionRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> StreamingResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, WRITE_ROLES, "You cannot run the writing assistant for this document")

    if payload.base_updated_at.isoformat() != document["updated_at"]:
        raise AppError(
            409,
            "CONFLICT",
            "This document changed after you loaded it. Refresh it before running the assistant again."
        )

    try:
        ai_request = build_ai_request(
            feature=payload.feature,
            document_title=document["title"],
            document_content=payload.document_content,
            selected_text=payload.selected_text,
            tone=payload.tone,
            output_length=payload.output_length,
            settings=get_settings()
        )
        provider = get_ai_provider()
    except AiProviderError as exc:
        raise AppError(400, "VALIDATION_ERROR", str(exc)) from exc

    started_at = utc_now().isoformat()
    interaction = store.create_ai_interaction(
        document_id=document["id"],
        requested_by_user_id=current_user["id"],
        requested_at=started_at,
        feature=payload.feature,
        selection_mode=ai_request.selection_mode,
        tone=payload.tone,
        output_length=payload.output_length,
        original_text=ai_request.source_text,
        prompt_text=ai_request.prompt_text,
        model=provider.model_name
    )
    if interaction is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    async def event_stream():
        parts: list[str] = []
        yield encode_event(
            {
                "type": "start",
                "interaction_id": interaction["id"],
                "feature": payload.feature,
                "selection_mode": ai_request.selection_mode,
                "original_text": ai_request.source_text,
                "model": provider.model_name
            }
        )

        try:
            for chunk in provider.stream(ai_request):
                if await request.is_disconnected():
                    store.finalize_ai_interaction(
                        document_id=document["id"],
                        interaction_id=interaction["id"],
                        status="canceled",
                        response_text="".join(parts)
                    )
                    return

                parts.append(chunk)
                yield encode_event({"type": "chunk", "text": chunk})
                await asyncio.sleep(0.03)

            final_text = "".join(parts).strip()
            store.finalize_ai_interaction(
                document_id=document["id"],
                interaction_id=interaction["id"],
                status="completed",
                response_text=final_text
            )
            yield encode_event({"type": "done", "text": final_text})
        except AiProviderError as exc:
            partial = "".join(parts).strip()
            store.finalize_ai_interaction(
                document_id=document["id"],
                interaction_id=interaction["id"],
                status="error",
                response_text=partial,
                error_message=str(exc)
            )
            yield encode_event({"type": "error", "message": str(exc)})
        except Exception:
            partial = "".join(parts).strip()
            store.finalize_ai_interaction(
                document_id=document["id"],
                interaction_id=interaction["id"],
                status="error",
                response_text=partial,
                error_message="The assistant stopped before finishing."
            )
            yield encode_event(
                {
                    "type": "error",
                    "message": "The assistant stopped before finishing."
                }
            )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/{document_id}/ai/history/{interaction_id}/status", response_model=DocumentDetailResponse)
def update_ai_interaction_status(
    document_id: str,
    interaction_id: str,
    payload: UpdateAiInteractionStatusRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, WRITE_ROLES, "You cannot update AI suggestions for this document")

    updated = store.set_ai_interaction_feedback(
        document_id=document["id"],
        interaction_id=interaction_id,
        status=payload.status,
        decided_at=utc_now().isoformat()
    )
    if updated is None:
        raise AppError(404, "NOT_FOUND", "AI suggestion not found")

    refreshed_document = store.get_document_by_id(document["id"])
    if refreshed_document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(refreshed_document, role, store)
