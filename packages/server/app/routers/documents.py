from fastapi import APIRouter, Depends, status

from app.dependencies import get_current_user, get_json_store
from app.errors import AppError
from app.schemas import (
    CreateShareLinkRequest,
    CreateDocumentRequest,
    DocumentAiInteractionResponse,
    DocumentDetailResponse,
    DocumentShareResponse,
    DocumentShareLinkResponse,
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


def build_public_user_lookup(store: JsonStore, user_ids: set[str]) -> dict[str, PublicUserResponse]:
    return {
        user_id: to_public_user(user)
        for user_id, user in store.list_users_by_ids(user_ids).items()
    }


def require_public_user(
    public_users_by_id: dict[str, PublicUserResponse],
    user_id: str
) -> PublicUserResponse:
    user = public_users_by_id.get(user_id)
    if user is None:
        raise AppError(404, "NOT_FOUND", "User not found")
    return user


def resolve_public_user(
    store_or_users: JsonStore | dict[str, PublicUserResponse],
    user_id: str
) -> PublicUserResponse:
    if isinstance(store_or_users, JsonStore):
        return to_public_user(store_or_users.get_user_by_id(user_id))
    return require_public_user(store_or_users, user_id)


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


def to_share_response(
    share: dict,
    store_or_users: JsonStore | dict[str, PublicUserResponse]
) -> DocumentShareResponse:
    user = resolve_public_user(store_or_users, share["user_id"])
    return DocumentShareResponse(
        id=share["id"],
        user_id=share["user_id"],
        username=user.username,
        email=user.email,
        role=share["role"],
        granted_at=share["granted_at"]
    )


def to_share_link_response(share_link: dict) -> DocumentShareLinkResponse:
    return DocumentShareLinkResponse(
        id=share_link["id"],
        token=share_link["token"],
        role=share_link["role"],
        created_at=share_link["created_at"],
        revoked_at=share_link["revoked_at"]
    )


def to_version_response(
    version: dict,
    store_or_users: JsonStore | dict[str, PublicUserResponse]
) -> DocumentVersionResponse:
    created_by = resolve_public_user(store_or_users, version["created_by_user_id"])
    return DocumentVersionResponse(
        id=version["id"],
        title=version["title"],
        content=version["content"],
        created_at=version["created_at"],
        created_by=created_by,
        source=version["source"],
        restored_from_version_id=version["restored_from_version_id"]
    )


def to_ai_interaction_response(
    interaction: dict,
    store_or_users: JsonStore | dict[str, PublicUserResponse]
) -> DocumentAiInteractionResponse:
    requested_by = resolve_public_user(store_or_users, interaction["requested_by_user_id"])
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


def to_document_summary(
    document: dict,
    role: str,
    store: JsonStore,
    public_users_by_id: dict[str, PublicUserResponse] | None = None
) -> DocumentSummaryResponse:
    owner = (
        require_public_user(public_users_by_id, document["owner_id"])
        if public_users_by_id is not None
        else to_public_user(store.get_user_by_id(document["owner_id"]))
    )
    return DocumentSummaryResponse(
        id=document["id"],
        title=document["title"],
        owner_id=document["owner_id"],
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        role=role,
        owner=owner
    )


def to_document_detail(
    document: dict,
    role: str,
    store: JsonStore,
    *,
    include_share_links: bool = False,
    include_ai_history: bool = False
) -> DocumentDetailResponse:
    user_ids = {document["owner_id"]}
    user_ids.update(share["user_id"] for share in document["shares"])
    user_ids.update(version["created_by_user_id"] for version in document["versions"])
    if include_ai_history:
        user_ids.update(
            interaction["requested_by_user_id"]
            for interaction in document.get("ai_history", [])
        )

    public_users_by_id = build_public_user_lookup(store, user_ids)
    summary = to_document_summary(document, role, store, public_users_by_id)
    shares = [to_share_response(share, public_users_by_id) for share in document["shares"]]
    share_links = (
        [to_share_link_response(share_link) for share_link in document.get("share_links", [])]
        if include_share_links
        else []
    )
    versions = [
        to_version_response(version, public_users_by_id)
        for version in reversed(document["versions"])
    ]
    ai_history = [
        to_ai_interaction_response(interaction, public_users_by_id)
        for interaction in document.get("ai_history", [])
    ] if include_ai_history else []
    return DocumentDetailResponse(
        **summary.model_dump(),
        content=document["content"],
        shares=shares,
        share_links=share_links,
        versions=versions,
        ai_history=ai_history
    )


@router.get("", response_model=DocumentsResponse)
def list_documents(
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentsResponse:
    documents = store.list_accessible_documents(current_user["id"])
    public_users_by_id = build_public_user_lookup(
        store,
        {document["owner_id"] for document in documents}
    )
    summaries = []
    for document in documents:
        role = store.get_document_role(document, current_user["id"])
        if role is None:
            continue
        summaries.append(to_document_summary(document, role, store, public_users_by_id))
    return DocumentsResponse(documents=summaries)


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
    return to_document_detail(document, "owner", store, include_share_links=True)


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
    return to_document_detail(document, role, store, include_share_links=role == "owner")


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
        base_version_id=payload.base_version_id,
        base_title=payload.base_title,
        base_content=payload.base_content,
        updated_at=utc_now().isoformat(),
        updated_by_user_id=current_user["id"],
        source=payload.save_source
    )
    if updated is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(updated, role, store, include_share_links=role == "owner")


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

    return to_document_detail(refreshed_document, role, store, include_share_links=role == "owner")


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

    return to_document_detail(refreshed_document, role, store, include_share_links=role == "owner")


@router.post("/{document_id}/share-links", response_model=DocumentDetailResponse)
def create_share_link(
    document_id: str,
    payload: CreateShareLinkRequest,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, {"owner"}, "Only the owner can create share links")

    created_link = store.create_share_link(
        document_id=document["id"],
        role=payload.role,
        created_at=utc_now().isoformat()
    )
    if created_link is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    refreshed_document = store.get_document_by_id(document_id)
    if refreshed_document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(refreshed_document, role, store, include_share_links=True)


@router.delete("/{document_id}/share-links/{share_link_id}", response_model=DocumentDetailResponse)
def revoke_share_link(
    document_id: str,
    share_link_id: str,
    current_user: dict = Depends(get_current_user),
    store: JsonStore = Depends(get_json_store)
) -> DocumentDetailResponse:
    document, role = resolve_document_for_user(
        document_id=document_id,
        current_user=current_user,
        store=store
    )
    require_role(role, {"owner"}, "Only the owner can revoke share links")

    was_revoked = store.revoke_share_link(document["id"], share_link_id, utc_now().isoformat())
    if not was_revoked:
        raise AppError(404, "NOT_FOUND", "Share link not found")

    refreshed_document = store.get_document_by_id(document_id)
    if refreshed_document is None:
        raise AppError(404, "NOT_FOUND", "Document not found")

    return to_document_detail(refreshed_document, role, store, include_share_links=True)


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

    return to_document_detail(restored, role, store, include_share_links=role == "owner")
