from typing import Any

from app.errors import AppError
from app.security import utc_now
from app.store import JsonStore


def resolve_guest_document_access(
    *,
    share_token: str | None,
    guest_key: str | None,
    store: JsonStore
) -> tuple[dict[str, Any], str, dict[str, Any], dict[str, Any]]:
    if not share_token:
        raise AppError(401, "AUTHENTICATION_REQUIRED", "Share link token is required")
    if not guest_key or not guest_key.strip():
        raise AppError(400, "VALIDATION_ERROR", "Guest identity key is required")

    share_result = store.get_document_by_share_token(share_token)
    if share_result is None:
        raise AppError(404, "NOT_FOUND", "Share link not found or has been revoked")

    document, share_link = share_result
    guest_user = store.ensure_guest_identity(
        share_link_id=share_link["id"],
        guest_key=guest_key.strip(),
        created_at=utc_now().isoformat()
    )
    return document, share_link["role"], guest_user, share_link
