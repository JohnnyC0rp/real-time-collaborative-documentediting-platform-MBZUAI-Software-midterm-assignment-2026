import asyncio
import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.ai import AiGenerationInput, build_prompt, get_ai_provider
from app.config import get_settings
from app.dependencies import get_current_user, get_json_store
from app.errors import AppError
from app.schemas import (
    AiActionAcceptedResponse,
    AiActionResultResponse,
    AiActionStreamingResponse,
    AiHistoryResponse,
    AiInteractionResponse,
    PublicUserResponse,
    ResolveAiInteractionRequest,
    SubmitAiActionRequest
)
from app.security import utc_now
from app.store import JsonStore

router = APIRouter(prefix="/api/ai", tags=["ai"])

AI_ENABLED_ROLES = {"owner", "editor"}


def to_public_user(user: dict | None) -> PublicUserResponse:
    if user is None:
        raise AppError(404, "NOT_FOUND", "User not found")
    return PublicUserResponse(
        id=user["id"],
        username=user["username"],
        email=user["email"]
    )


def resolve_document_for_user(
    *,
    document_id: str,
    current_user: dict,
    store: JsonStore
) -> tuple[dict, str]:
    document = store.get_document_by_id(document_id)
    if document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    role = store.get_document_role(document, current_user["id"])
    if role is None:
        raise AppError(403, "FORBIDDEN", "You do not have access to this document")

    return document, role


def preview_text(value: str | None, limit: int = 180) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[: limit - 1].rstrip()}…"


def sha256_text(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clamp_context(before_context: str, after_context: str) -> tuple[str, str]:
    settings = get_settings()
    max_chars = max(0, settings.ai_max_context_chars)
    if len(before_context) + len(after_context) <= max_chars:
        return before_context, after_context

    before_budget = max_chars // 2
    after_budget = max_chars - before_budget
    return before_context[-before_budget:], after_context[:after_budget]


def chunk_text(value: str, size: int = 80) -> list[str]:
    if not value:
        return [""]
    return [value[index : index + size] for index in range(0, len(value), size)]


def event_message(event_name: str, payload: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"


def get_latest_version_id(document: dict) -> str:
    versions = document.get("versions", [])
    if not versions:
        raise AppError(500, "SERVER_ERROR", "Document versions are missing")
    return versions[-1]["id"]


def get_daily_quota(role: str) -> int:
    settings = get_settings()
    if role == "owner":
        return settings.ai_daily_quota_owner
    if role == "editor":
        return settings.ai_daily_quota_editor
    return settings.ai_daily_quota_viewer


def current_model_id() -> str:
    settings = get_settings()
    if settings.ai_provider == "openai":
        return settings.openai_model
    if settings.ai_provider == "gemini":
        return settings.gemini_model
    return "local-fallback-v1"


def to_ai_interaction_response(interaction: dict, store: JsonStore) -> AiInteractionResponse:
    requested_by = to_public_user(store.get_user_by_id(interaction["requested_by_user_id"]))
    return AiInteractionResponse(
        id=interaction["id"],
        document_id=interaction["document_id"],
        action=interaction["action"],
        stage=interaction["stage"],
        resolution=interaction["resolution"],
        requested_at=interaction["requested_at"],
        completed_at=interaction["completed_at"],
        resolved_at=interaction["resolved_at"],
        updated_at=interaction["updated_at"],
        requested_by=requested_by,
        model_id=interaction["model_id"],
        target_language=interaction["target_language"],
        instruction=interaction["instruction"],
        requested_document_version_id=interaction["requested_document_version_id"],
        current_document_version_id=interaction["current_document_version_id"],
        applied_document_version_id=interaction["applied_document_version_id"],
        selection_plain_text_start=interaction["selection_plain_text_start"],
        selection_plain_text_end=interaction["selection_plain_text_end"],
        selection_text_preview=interaction["selection_text_preview"],
        suggestion_preview=interaction["suggestion_preview"],
        error_code=interaction["error_code"]
    )


@router.post("/actions")
async def submit_ai_action(
    payload: SubmitAiActionRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> StreamingResponse:
    if payload.selection.plain_text_end <= payload.selection.plain_text_start:
        raise AppError(400, "VALIDATION_ERROR", "Selection range must have a positive length")
    if not payload.selection.text.strip():
        raise AppError(400, "VALIDATION_ERROR", "AI actions require a non-empty text selection")
    if payload.action == "translate" and not payload.target_language:
        raise AppError(400, "VALIDATION_ERROR", "Target language is required for translation")

    document, role = resolve_document_for_user(
        document_id=payload.document_id,
        current_user=current_user,
        store=store
    )
    if role not in AI_ENABLED_ROLES:
        raise AppError(403, "POLICY_BLOCKED", "Your role is not allowed to invoke AI actions")

    quota = get_daily_quota(role)
    day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    if store.count_ai_requests_since(current_user["id"], day_start.isoformat()) >= quota:
        reset_at = (day_start + timedelta(days=1)).isoformat()
        raise AppError(
            429,
            "QUOTA_EXCEEDED",
            f"Daily AI quota reached. The quota resets at {reset_at}"
        )

    before_context, after_context = clamp_context(
        payload.selection.before_context,
        payload.selection.after_context
    )
    system_prompt, user_prompt = build_prompt(
        action=payload.action,
        selected_text=payload.selection.text,
        before_context=before_context,
        after_context=after_context,
        outline_summary=payload.selection.outline_summary,
        target_language=payload.target_language,
        instruction=payload.instruction
    )

    requested_at = utc_now().isoformat()
    store.expire_pending_ai_interactions(
        document_id=document["id"],
        requested_by_user_id=current_user["id"],
        expired_at=requested_at
    )
    interaction = store.create_ai_interaction(
        document_id=document["id"],
        requested_by_user_id=current_user["id"],
        action=payload.action,
        requested_at=requested_at,
        model_id=current_model_id(),
        requested_document_version_id=payload.requested_document_version_id,
        selection_plain_text_start=payload.selection.plain_text_start,
        selection_plain_text_end=payload.selection.plain_text_end,
        selection_text_preview=preview_text(payload.selection.text) or payload.selection.text[:180],
        target_language=payload.target_language,
        instruction=payload.instruction
    )
    provider = get_ai_provider()
    generation_input = AiGenerationInput(
        action=payload.action,
        selected_text=payload.selection.text,
        before_context=before_context,
        after_context=after_context,
        outline_summary=payload.selection.outline_summary,
        target_language=payload.target_language,
        instruction=payload.instruction,
        system_prompt=system_prompt,
        user_prompt=user_prompt
    )

    async def stream() -> AsyncIterator[str]:
        accepted = AiActionAcceptedResponse(
            interaction_id=interaction["id"],
            action=payload.action,
            requested_at=requested_at,
            model_id=current_model_id()
        )
        yield event_message("accepted", accepted.model_dump(mode="json"))

        try:
            provider_response = await asyncio.to_thread(provider.generate, generation_input)
            suggestion_text = provider_response.text.strip()
            accumulated_text = ""
            for chunk in chunk_text(suggestion_text):
                accumulated_text += chunk
                streaming = AiActionStreamingResponse(
                    interaction_id=interaction["id"],
                    delta=chunk,
                    accumulated_text=accumulated_text
                )
                yield event_message("streaming", streaming.model_dump(mode="json"))
                await asyncio.sleep(0.02)

            completed_at = utc_now().isoformat()
            refreshed_document = store.get_document_by_id(document["id"])
            if refreshed_document is None:
                raise AppError(404, "NOT_FOUND", "Document not found")

            current_document_version_id = get_latest_version_id(refreshed_document)
            stage = (
                "stale"
                if current_document_version_id != payload.requested_document_version_id
                else "complete"
            )
            store.complete_ai_interaction(
                interaction_id=interaction["id"],
                stage=stage,
                completed_at=completed_at,
                current_document_version_id=current_document_version_id,
                suggestion_preview=preview_text(suggestion_text) or "",
                prompt_sha256=sha256_text(f"{system_prompt}\n\n{user_prompt}") or "",
                response_sha256=sha256_text(suggestion_text) or ""
            )

            result = AiActionResultResponse(
                interaction_id=interaction["id"],
                document_id=document["id"],
                action=payload.action,
                stage=stage,
                resolution="pending-review",
                requested_at=requested_at,
                completed_at=completed_at,
                model_id=provider_response.model_id,
                original_text=payload.selection.text,
                suggestion_text=suggestion_text,
                requested_document_version_id=payload.requested_document_version_id,
                current_document_version_id=current_document_version_id,
                target_language=payload.target_language,
                instruction=payload.instruction,
                selection=payload.selection
            )
            yield event_message(stage, result.model_dump(mode="json"))
        except AppError as exc:
            failed_at = utc_now().isoformat()
            store.fail_ai_interaction(
                interaction_id=interaction["id"],
                failed_at=failed_at,
                error_code=exc.code
            )
            yield event_message(
                "failed",
                {
                    "interaction_id": interaction["id"],
                    "error": {
                        "code": exc.code,
                        "message": exc.message
                    }
                }
            )
        except Exception:
            failed_at = utc_now().isoformat()
            store.fail_ai_interaction(
                interaction_id=interaction["id"],
                failed_at=failed_at,
                error_code="SERVER_ERROR"
            )
            yield event_message(
                "failed",
                {
                    "interaction_id": interaction["id"],
                    "error": {
                        "code": "SERVER_ERROR",
                        "message": "The AI provider failed unexpectedly"
                    }
                }
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )


@router.post("/interactions/{interaction_id}/resolve", response_model=AiInteractionResponse)
def resolve_ai_interaction(
    interaction_id: str,
    payload: ResolveAiInteractionRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> AiInteractionResponse:
    interaction = store.get_ai_interaction_by_id(interaction_id)
    if interaction is None:
        raise AppError(404, "NOT_FOUND", "AI interaction not found")

    document, role = resolve_document_for_user(
        document_id=interaction["document_id"],
        current_user=current_user,
        store=store
    )
    if interaction["requested_by_user_id"] != current_user["id"] and role != "owner":
        raise AppError(403, "FORBIDDEN", "You cannot resolve this AI interaction")
    if interaction["resolution"] != "pending-review":
        raise AppError(409, "CONFLICT", "This AI interaction is already resolved")

    if payload.resolution in {"accepted", "edited-before-apply"}:
        if not payload.applied_document_version_id:
            raise AppError(400, "VALIDATION_ERROR", "Applied version is required when committing AI text")
        version_ids = {version["id"] for version in document["versions"]}
        if payload.applied_document_version_id not in version_ids:
            raise AppError(400, "VALIDATION_ERROR", "Applied version does not belong to this document")
    elif payload.applied_document_version_id is not None:
        raise AppError(400, "VALIDATION_ERROR", "Rejected suggestions cannot link to a document version")

    resolved = store.resolve_ai_interaction(
        interaction_id=interaction_id,
        resolution=payload.resolution,
        resolved_at=utc_now().isoformat(),
        applied_document_version_id=payload.applied_document_version_id,
        suggestion_preview=preview_text(payload.final_text),
        final_text_sha256=sha256_text(payload.final_text)
    )
    if resolved is None:
        raise AppError(404, "NOT_FOUND", "AI interaction not found")

    return to_ai_interaction_response(resolved, store)


@router.get("/history/{document_id}", response_model=AiHistoryResponse)
def get_ai_history(
    document_id: str,
    action: str | None = None,
    requested_by_user_id: str | None = None,
    resolution: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> AiHistoryResponse:
    _document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    if role != "owner":
        raise AppError(403, "FORBIDDEN", "Only document owners can review AI history")

    interactions = store.list_ai_interactions(document_id)

    if action is not None:
        interactions = [item for item in interactions if item["action"] == action]
    if requested_by_user_id is not None:
        interactions = [
            item for item in interactions if item["requested_by_user_id"] == requested_by_user_id
        ]
    if resolution is not None:
        interactions = [item for item in interactions if item["resolution"] == resolution]
    if date_from is not None:
        start_iso = datetime.combine(date_from, datetime.min.time(), tzinfo=UTC).isoformat()
        interactions = [item for item in interactions if item["requested_at"] >= start_iso]
    if date_to is not None:
        end_iso = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=UTC).isoformat()
        interactions = [item for item in interactions if item["requested_at"] < end_iso]

    return AiHistoryResponse(
        interactions=[to_ai_interaction_response(item, store) for item in interactions],
        total=len(interactions)
    )
