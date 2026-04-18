from fastapi import APIRouter, Depends, status

from app.dependencies import get_current_user, get_json_store
from app.errors import AppError
from app.schemas import (
    CreateDocumentRequest,
    DocumentAiInteractionResponse,
    DocumentDetailResponse,
    DocumentShareResponse,
    DocumentsResponse,
    DocumentSummaryResponse,
    DocumentVersionResponse,
    PublicUserResponse,
    RestoreVersionRequest,
    ShareDocumentRequest,
    SuccessResponse,
    UpdateDocumentRequest
)
from app.security import utc_now
from app.store import JsonStore

router = APIRouter(prefix="/api/documents", tags=["documents"])

WRITE_ROLES = {"owner", "editor"}


def normalize_title(title: str) -> str:
    normalized = title.strip()
    if not normalized:
        raise AppError(400, "VALIDATION_ERROR", "Title cannot be empty")
    return normalized


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


def require_role(actual_role: str, allowed_roles: set[str], message: str) -> None:
    if actual_role not in allowed_roles:
        raise AppError(403, "FORBIDDEN", message)


def to_share_response(share: dict, store: JsonStore) -> DocumentShareResponse:
    shared_user = store.get_user_by_id(share["user_id"])
    user = to_public_user(shared_user)
    return DocumentShareResponse(
        id=share["id"],
        user_id=share["user_id"],
        username=user.username,
        email=user.email,
        role=share["role"],
        granted_at=share["granted_at"]
    )


def to_version_response(version: dict, store: JsonStore) -> DocumentVersionResponse:
    created_by = to_public_user(store.get_user_by_id(version["created_by_user_id"]))
    return DocumentVersionResponse(
        id=version["id"],
        title=version["title"],
        content=version["content"],
        created_at=version["created_at"],
        created_by=created_by,
        source=version["source"],
        restored_from_version_id=version["restored_from_version_id"]
    )


def to_ai_interaction_response(interaction: dict, store: JsonStore) -> DocumentAiInteractionResponse:
    requested_by = to_public_user(store.get_user_by_id(interaction["requested_by_user_id"]))
    return DocumentAiInteractionResponse(
        id=interaction["id"],
        feature=interaction["feature"],
        requested_at=interaction["requested_at"],
        requested_by=requested_by,
        selection_mode=interaction["selection_mode"],
        tone=interaction.get("tone"),
        output_length=interaction.get("output_length"),
        original_text=interaction["original_text"],
        prompt_text=interaction["prompt_text"],
        model=interaction["model"],
        response_text=interaction.get("response_text", ""),
        status=interaction["status"],
        error_message=interaction.get("error_message"),
        decided_at=interaction.get("decided_at")
    )


def to_document_summary(document: dict, role: str, store: JsonStore) -> DocumentSummaryResponse:
    owner = to_public_user(store.get_user_by_id(document["owner_id"]))
    return DocumentSummaryResponse(
        id=document["id"],
        title=document["title"],
        owner_id=document["owner_id"],
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        role=role,
        owner=owner
    )


def to_document_detail(document: dict, role: str, store: JsonStore) -> DocumentDetailResponse:
    summary = to_document_summary(document, role, store)
    shares = [to_share_response(share, store) for share in document["shares"]]
    versions = [
        to_version_response(version, store)
        for version in reversed(document["versions"])
    ]
    ai_history = [
        to_ai_interaction_response(interaction, store)
        for interaction in document.get("ai_history", [])
    ]
    return DocumentDetailResponse(
        **summary.model_dump(),
        content=document["content"],
        shares=shares,
        versions=versions,
        ai_history=ai_history
    )


@router.get("", response_model=DocumentsResponse)
def list_documents(
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentsResponse:
    documents = []
    for document in store.list_accessible_documents(current_user["id"]):
        role = store.get_document_role(document, current_user["id"])
        if role is None:
            continue
        documents.append(to_document_summary(document, role, store))
    return DocumentsResponse(documents=documents)


@router.post("", response_model=DocumentDetailResponse, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: CreateDocumentRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document = store.create_document(
        owner_id=current_user["id"],
        title=normalize_title(payload.title),
        created_at=utc_now().isoformat()
    )
    return to_document_detail(document, "owner", store)


@router.get("/{document_id}", response_model=DocumentDetailResponse)
def get_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    return to_document_detail(document, role, store)


@router.put("/{document_id}", response_model=DocumentDetailResponse)
def update_document(
    document_id: str,
    payload: UpdateDocumentRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, WRITE_ROLES, "You cannot edit this document")

    if payload.title is None and payload.content is None:
        raise AppError(400, "VALIDATION_ERROR", "Nothing to update")

    next_title = normalize_title(payload.title) if payload.title is not None else None
    updated = store.update_document(
        document_id=document["id"],
        title=next_title,
        content=payload.content,
        updated_at=utc_now().isoformat(),
        updated_by_user_id=current_user["id"],
        source=payload.save_source
    )
    if updated is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(updated, role, store)


@router.delete("/{document_id}", response_model=SuccessResponse)
def delete_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> SuccessResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, {"owner"}, "Only the owner can delete this document")

    was_deleted = store.delete_document(document["id"], utc_now().isoformat())
    if not was_deleted:
        raise AppError(404, "NOT_FOUND", "Document not found")
    return SuccessResponse()


@router.post("/{document_id}/shares", response_model=DocumentDetailResponse)
def share_document(
    document_id: str,
    payload: ShareDocumentRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, {"owner"}, "Only the owner can manage sharing")

    target_user = store.find_user_by_identifier(payload.identifier)
    if target_user is None:
        raise AppError(404, "NOT_FOUND", "Target user not found")

    if target_user["id"] == current_user["id"]:
        raise AppError(409, "CONFLICT", "Owner permissions are already in place")

    share = store.upsert_share(
        document_id=document_id,
        target_user_id=target_user["id"],
        role=payload.role,
        granted_at=utc_now().isoformat()
    )
    if share is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    refreshed_document = store.get_document_by_id(document_id)
    if refreshed_document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(refreshed_document, role, store)


@router.delete("/{document_id}/shares/{share_id}", response_model=DocumentDetailResponse)
def remove_share(
    document_id: str,
    share_id: str,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, {"owner"}, "Only the owner can manage sharing")

    was_removed = store.remove_share(document_id, share_id, utc_now().isoformat())
    if not was_removed:
        raise AppError(404, "NOT_FOUND", "Share entry not found")

    refreshed_document = store.get_document_by_id(document_id)
    if refreshed_document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(refreshed_document, role, store)


@router.post("/{document_id}/versions/restore", response_model=DocumentDetailResponse)
def restore_version(
    document_id: str,
    payload: RestoreVersionRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, WRITE_ROLES, "You cannot restore versions for this document")

    restored = store.restore_document_version(
        document_id=document["id"],
        version_id=payload.version_id,
        restored_at=utc_now().isoformat(),
        restored_by_user_id=current_user["id"]
    )
    if restored is None:
        raise AppError(404, "NOT_FOUND", "Version not found")

    return to_document_detail(restored, role, store)
