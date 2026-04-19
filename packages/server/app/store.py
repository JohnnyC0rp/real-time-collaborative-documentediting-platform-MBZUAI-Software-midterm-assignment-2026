import json
import secrets
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Callable, TypeVar
from uuid import uuid4

from diff_match_patch import diff_match_patch

from app.config import get_settings
from app.security import hash_password, utc_now, verify_password

StoreMutationResult = TypeVar("StoreMutationResult")

DEFAULT_TEST_USERNAME = "test"
DEFAULT_TEST_PASSWORD = "12345678"
DEFAULT_TEST_EMAIL = "test@example.com"

dmp = diff_match_patch()


class StoreConflictError(ValueError):
    pass


class JsonStore:
    def __init__(self, data_file: Path) -> None:
        self._data_file = data_file
        self._lock = Lock()
        self._initialized = False

    def ensure_initialized(self) -> None:
        if self._initialized:
            return

        self._data_file.parent.mkdir(parents=True, exist_ok=True)
        if not self._data_file.exists() or self._data_file.stat().st_size == 0:
            self._write_state(self._empty_state())
            self._initialized = True
            return

        with self._data_file.open("r", encoding="utf-8") as handle:
            state = json.load(handle)

        if self._apply_state_defaults(state, enforce_test_password=True):
            self._write_state(state)

        self._initialized = True

    def _empty_state(self) -> dict[str, list[dict[str, Any]]]:
        state = {
            "users": [],
            "documents": [],
            "refresh_sessions": [],
            "ai_interactions": [],
            "guest_identities": []
        }
        self._apply_state_defaults(state, enforce_test_password=True)
        return state

    def _apply_state_defaults(
        self,
        state: dict[str, list[dict[str, Any]]],
        *,
        enforce_test_password: bool
    ) -> bool:
        did_change = False

        for key in ("users", "documents", "refresh_sessions", "ai_interactions", "guest_identities"):
            if key not in state:
                state[key] = []
                did_change = True

        for user in state["users"]:
            if "is_guest" not in user:
                user["is_guest"] = False
                did_change = True

        for interaction in state["ai_interactions"]:
            for key in ("input_tokens", "output_tokens", "estimated_cost_usd"):
                if key not in interaction:
                    interaction[key] = None
                    did_change = True

        for document in state["documents"]:
            if "shares" not in document:
                document["shares"] = []
                did_change = True
            if "share_links" not in document:
                document["share_links"] = []
                did_change = True
            if "versions" not in document:
                document["versions"] = []
                did_change = True

        return self._ensure_default_test_user(
            state,
            enforce_test_password=enforce_test_password
        ) or did_change

    def _ensure_default_test_user(
        self,
        state: dict[str, list[dict[str, Any]]],
        *,
        enforce_test_password: bool
    ) -> bool:
        for user in state["users"]:
            if user.get("is_guest"):
                continue
            if user["username"].casefold() != DEFAULT_TEST_USERNAME:
                continue

            did_change = False
            password_hash = str(user.get("password_hash", ""))
            if not password_hash:
                user["password_hash"] = hash_password(DEFAULT_TEST_PASSWORD)
                did_change = True
            elif enforce_test_password and not verify_password(DEFAULT_TEST_PASSWORD, password_hash):
                user["password_hash"] = hash_password(DEFAULT_TEST_PASSWORD)
                did_change = True

            return did_change

        existing_emails = {
            user["email"].casefold()
            for user in state["users"]
            if not user.get("is_guest")
        }
        test_email = DEFAULT_TEST_EMAIL
        email_suffix = 1
        while test_email.casefold() in existing_emails:
            test_email = f"test+seed{email_suffix}@example.com"
            email_suffix += 1

        state["users"].append(
            {
                "id": str(uuid4()),
                "username": DEFAULT_TEST_USERNAME,
                "email": test_email,
                "password_hash": hash_password(DEFAULT_TEST_PASSWORD),
                "created_at": utc_now().isoformat(),
                "is_guest": False
            }
        )
        # Keep one predictable local account around so demo logins do not require archaeology.
        return True

    def _read_state(self) -> dict[str, list[dict[str, Any]]]:
        self.ensure_initialized()
        with self._data_file.open("r", encoding="utf-8") as handle:
            state = json.load(handle)

        self._apply_state_defaults(state, enforce_test_password=False)
        return state

    def _write_state(self, state: dict[str, list[dict[str, Any]]]) -> None:
        self._data_file.parent.mkdir(parents=True, exist_ok=True)
        with self._data_file.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)
        self._initialized = True

    def _mutate(
        self,
        mutation: Callable[[dict[str, list[dict[str, Any]]]], StoreMutationResult]
    ) -> StoreMutationResult:
        with self._lock:
            state = self._read_state()
            result = mutation(state)
            self._write_state(state)
            return result

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        state = self._read_state()
        return next((user for user in state["users"] if user["id"] == user_id), None)

    def find_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        needle = identifier.strip().casefold()
        state = self._read_state()
        return next(
            (
                user
                for user in state["users"]
                if not user.get("is_guest")
                if user["username"].casefold() == needle or user["email"].casefold() == needle
            ),
            None
        )

    def list_users_by_ids(self, user_ids: set[str]) -> dict[str, dict[str, Any]]:
        state = self._read_state()
        return {
            user["id"]: user
            for user in state["users"]
            if user["id"] in user_ids
        }

    def create_user(
        self,
        *,
        username: str,
        email: str,
        password_hash: str,
        created_at: str
    ) -> dict[str, Any]:
        normalized_email = email.strip().lower()
        normalized_username = username.strip()

        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
            for existing_user in state["users"]:
                if existing_user["email"].casefold() == normalized_email.casefold():
                    raise StoreConflictError("Email already in use")
                if existing_user["username"].casefold() == normalized_username.casefold():
                    raise StoreConflictError("Username already in use")

            user = {
                "id": str(uuid4()),
                "username": normalized_username,
                "email": normalized_email,
                "password_hash": password_hash,
                "created_at": created_at,
                "is_guest": False
            }
            state["users"].append(user)
            return user

        return self._mutate(mutation)

    def create_refresh_session(
        self,
        *,
        session_id: str,
        user_id: str,
        token_hash: str,
        expires_at: str,
        created_at: str
    ) -> dict[str, Any]:
        session = {
            "id": session_id,
            "user_id": user_id,
            "token_hash": token_hash,
            "created_at": created_at,
            "expires_at": expires_at,
            "revoked_at": None
        }

        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
            state["refresh_sessions"].append(session)
            return session

        return self._mutate(mutation)

    def get_refresh_session(self, session_id: str) -> dict[str, Any] | None:
        state = self._read_state()
        return next(
            (session for session in state["refresh_sessions"] if session["id"] == session_id),
            None
        )

    def revoke_refresh_session(self, session_id: str, revoked_at: str) -> None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> None:
            for session in state["refresh_sessions"]:
                if session["id"] == session_id:
                    session["revoked_at"] = revoked_at
                    break

        self._mutate(mutation)

    def create_ai_interaction(
        self,
        *,
        document_id: str,
        requested_by_user_id: str,
        action: str,
        requested_at: str,
        model_id: str,
        requested_document_version_id: str,
        selection_plain_text_start: int,
        selection_plain_text_end: int,
        selection_text_preview: str,
        target_language: str | None,
        instruction: str | None
    ) -> dict[str, Any]:
        interaction = {
            "id": str(uuid4()),
            "document_id": document_id,
            "requested_by_user_id": requested_by_user_id,
            "action": action,
            "stage": "accepted",
            "resolution": "pending-review",
            "requested_at": requested_at,
            "completed_at": None,
            "resolved_at": None,
            "updated_at": requested_at,
            "model_id": model_id,
            "target_language": target_language,
            "instruction": instruction,
            "requested_document_version_id": requested_document_version_id,
            "current_document_version_id": None,
            "applied_document_version_id": None,
            "selection_plain_text_start": selection_plain_text_start,
            "selection_plain_text_end": selection_plain_text_end,
            "selection_text_preview": selection_text_preview,
            "suggestion_preview": None,
            "prompt_sha256": None,
            "response_sha256": None,
            "final_text_sha256": None,
            "error_code": None,
            "input_tokens": None,
            "output_tokens": None,
            "estimated_cost_usd": None
        }

        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
            state["ai_interactions"].append(interaction)
            return deepcopy(interaction)

        return self._mutate(mutation)

    def get_ai_interaction_by_id(self, interaction_id: str) -> dict[str, Any] | None:
        state = self._read_state()
        return next(
            (
                deepcopy(interaction)
                for interaction in state["ai_interactions"]
                if interaction["id"] == interaction_id
            ),
            None
        )

    def count_ai_requests_since(self, user_id: str, since_iso: str) -> int:
        state = self._read_state()
        return sum(
            1
            for interaction in state["ai_interactions"]
            if interaction["requested_by_user_id"] == user_id
            and interaction["requested_at"] >= since_iso
        )

    def list_ai_interactions(self, document_id: str) -> list[dict[str, Any]]:
        state = self._read_state()
        interactions = [
            deepcopy(interaction)
            for interaction in state["ai_interactions"]
            if interaction["document_id"] == document_id
        ]
        interactions.sort(key=lambda item: item["requested_at"], reverse=True)
        return interactions

    def expire_pending_ai_interactions(
        self,
        *,
        document_id: str,
        requested_by_user_id: str,
        expired_at: str
    ) -> int:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> int:
            expired_count = 0
            for interaction in state["ai_interactions"]:
                if interaction["document_id"] != document_id:
                    continue
                if interaction["requested_by_user_id"] != requested_by_user_id:
                    continue
                if interaction["resolution"] != "pending-review":
                    continue
                if interaction["stage"] not in {"accepted", "complete", "stale"}:
                    continue

                interaction["resolution"] = "expired"
                interaction["resolved_at"] = expired_at
                interaction["updated_at"] = expired_at
                expired_count += 1

            return expired_count

        return self._mutate(mutation)

    def complete_ai_interaction(
        self,
        *,
        interaction_id: str,
        stage: str,
        completed_at: str,
        current_document_version_id: str,
        suggestion_preview: str,
        prompt_sha256: str,
        response_sha256: str,
        input_tokens: int,
        output_tokens: int,
        estimated_cost_usd: float
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for interaction in state["ai_interactions"]:
                if interaction["id"] != interaction_id:
                    continue

                interaction["stage"] = stage
                interaction["completed_at"] = completed_at
                interaction["updated_at"] = completed_at
                interaction["current_document_version_id"] = current_document_version_id
                interaction["suggestion_preview"] = suggestion_preview
                interaction["prompt_sha256"] = prompt_sha256
                interaction["response_sha256"] = response_sha256
                interaction["input_tokens"] = input_tokens
                interaction["output_tokens"] = output_tokens
                interaction["estimated_cost_usd"] = estimated_cost_usd
                return deepcopy(interaction)

            return None

        return self._mutate(mutation)

    def fail_ai_interaction(
        self,
        *,
        interaction_id: str,
        failed_at: str,
        error_code: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for interaction in state["ai_interactions"]:
                if interaction["id"] != interaction_id:
                    continue

                interaction["stage"] = "failed"
                interaction["resolution"] = "failed"
                interaction["completed_at"] = failed_at
                interaction["resolved_at"] = failed_at
                interaction["updated_at"] = failed_at
                interaction["error_code"] = error_code
                return deepcopy(interaction)

            return None

        return self._mutate(mutation)

    def resolve_ai_interaction(
        self,
        *,
        interaction_id: str,
        resolution: str,
        resolved_at: str,
        applied_document_version_id: str | None,
        suggestion_preview: str | None,
        final_text_sha256: str | None
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for interaction in state["ai_interactions"]:
                if interaction["id"] != interaction_id:
                    continue

                interaction["resolution"] = resolution
                interaction["resolved_at"] = resolved_at
                interaction["updated_at"] = resolved_at
                interaction["applied_document_version_id"] = applied_document_version_id
                if suggestion_preview is not None:
                    interaction["suggestion_preview"] = suggestion_preview
                interaction["final_text_sha256"] = final_text_sha256
                return deepcopy(interaction)

            return None

        return self._mutate(mutation)

    def get_document_by_id(self, document_id: str) -> dict[str, Any] | None:
        state = self._read_state()
        for document in state["documents"]:
            if document["id"] == document_id and document["deleted_at"] is None:
                return deepcopy(document)
        return None

    def list_accessible_documents(self, user_id: str) -> list[dict[str, Any]]:
        state = self._read_state()
        documents = []
        for document in state["documents"]:
            if document["deleted_at"] is not None:
                continue
            if self.get_document_role(document, user_id) is None:
                continue
            documents.append(deepcopy(document))

        documents.sort(key=lambda item: item["updated_at"], reverse=True)
        return documents

    def create_document(
        self,
        *,
        owner_id: str,
        title: str,
        created_at: str,
        content: str = "<p></p>"
    ) -> dict[str, Any]:
        document = {
            "id": str(uuid4()),
            "title": title.strip(),
            "content": content,
            "owner_id": owner_id,
            "created_at": created_at,
            "updated_at": created_at,
            "deleted_at": None,
            "shares": [],
            "share_links": [],
            "versions": [
                {
                    "id": str(uuid4()),
                    "title": title.strip(),
                    "content": content,
                    "created_at": created_at,
                    "created_by_user_id": owner_id,
                    "source": "initial",
                    "restored_from_version_id": None
                }
            ]
        }

        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
            state["documents"].append(document)
            return deepcopy(document)

        return self._mutate(mutation)

    def create_share_link(
        self,
        *,
        document_id: str,
        role: str,
        created_at: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                for share_link in document["share_links"]:
                    if share_link["role"] == role and share_link["revoked_at"] is None:
                        share_link["revoked_at"] = created_at

                share_link = {
                    "id": str(uuid4()),
                    "token": secrets.token_urlsafe(24),
                    "role": role,
                    "created_at": created_at,
                    "revoked_at": None
                }
                document["share_links"].append(share_link)
                document["updated_at"] = created_at
                return deepcopy(share_link)

            return None

        return self._mutate(mutation)

    def revoke_share_link(self, document_id: str, share_link_id: str, revoked_at: str) -> bool:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> bool:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                for share_link in document["share_links"]:
                    if share_link["id"] == share_link_id and share_link["revoked_at"] is None:
                        share_link["revoked_at"] = revoked_at
                        document["updated_at"] = revoked_at
                        return True
            return False

        return self._mutate(mutation)

    def get_document_by_share_token(
        self,
        share_token: str
    ) -> tuple[dict[str, Any], dict[str, Any]] | None:
        state = self._read_state()
        for document in state["documents"]:
            if document["deleted_at"] is not None:
                continue
            for share_link in document["share_links"]:
                if share_link["token"] == share_token and share_link["revoked_at"] is None:
                    return deepcopy(document), deepcopy(share_link)
        return None

    def ensure_guest_identity(
        self,
        *,
        share_link_id: str,
        guest_key: str,
        created_at: str
    ) -> dict[str, Any]:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
            for guest_identity in state["guest_identities"]:
                if (
                    guest_identity["share_link_id"] == share_link_id
                    and guest_identity["guest_key"] == guest_key
                ):
                    guest_identity["last_seen_at"] = created_at
                    user = next(
                        (
                            existing_user
                            for existing_user in state["users"]
                            if existing_user["id"] == guest_identity["user_id"]
                        ),
                        None
                    )
                    if user is None:
                        raise RuntimeError("Guest identity user is missing")
                    return deepcopy(user)

            ghost_number = (
                sum(
                    1
                    for guest_identity in state["guest_identities"]
                    if guest_identity["share_link_id"] == share_link_id
                )
                + 1
            )
            guest_user = {
                "id": str(uuid4()),
                "username": f"Ghost #{ghost_number}",
                "email": f"ghost-{share_link_id[:8]}-{ghost_number}@example.com",
                "password_hash": "",
                "created_at": created_at,
                "is_guest": True
            }
            state["users"].append(guest_user)
            state["guest_identities"].append(
                {
                    "id": str(uuid4()),
                    "share_link_id": share_link_id,
                    "guest_key": guest_key,
                    "user_id": guest_user["id"],
                    "created_at": created_at,
                    "last_seen_at": created_at
                }
            )
            return deepcopy(guest_user)

        return self._mutate(mutation)

    def update_document(
        self,
        *,
        document_id: str,
        title: str | None,
        content: str | None,
        base_version_id: str | None,
        base_title: str | None,
        base_content: str | None,
        updated_at: str,
        updated_by_user_id: str,
        source: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                merge_strategy = "direct"
                next_title = title.strip() if title is not None else document["title"]
                next_content = content if content is not None else document["content"]

                if title is not None and base_title is not None and base_title != document["title"]:
                    next_title = merge_text_update(
                        base_text=base_title,
                        current_text=document["title"],
                        requested_text=next_title
                    )
                    merge_strategy = "char-merge"

                if content is not None and base_content is not None and base_content != document["content"]:
                    next_content = merge_text_update(
                        base_text=base_content,
                        current_text=document["content"],
                        requested_text=next_content
                    )
                    merge_strategy = "char-merge"

                if next_title == document["title"] and next_content == document["content"]:
                    unchanged_document = deepcopy(document)
                    unchanged_document["_merge_strategy"] = merge_strategy
                    unchanged_document["_base_version_id"] = base_version_id
                    return unchanged_document

                document["title"] = next_title
                document["content"] = next_content
                document["updated_at"] = updated_at
                document["versions"].append(
                    {
                        "id": str(uuid4()),
                        "title": next_title,
                        "content": next_content,
                        "created_at": updated_at,
                        "created_by_user_id": updated_by_user_id,
                        "source": source,
                        "restored_from_version_id": None
                    }
                )
                updated_document = deepcopy(document)
                updated_document["_merge_strategy"] = merge_strategy
                updated_document["_base_version_id"] = base_version_id
                return updated_document

            return None

        return self._mutate(mutation)

    def delete_document(self, document_id: str, deleted_at: str) -> bool:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> bool:
            for document in state["documents"]:
                if document["id"] == document_id and document["deleted_at"] is None:
                    document["deleted_at"] = deleted_at
                    document["updated_at"] = deleted_at
                    return True
            return False

        return self._mutate(mutation)

    def upsert_share(
        self,
        *,
        document_id: str,
        target_user_id: str,
        role: str,
        granted_at: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                for share in document["shares"]:
                    if share["user_id"] == target_user_id:
                        share["role"] = role
                        share["granted_at"] = granted_at
                        document["updated_at"] = granted_at
                        return deepcopy(share)

                share = {
                    "id": str(uuid4()),
                    "user_id": target_user_id,
                    "role": role,
                    "granted_at": granted_at
                }
                document["shares"].append(share)
                document["updated_at"] = granted_at
                return deepcopy(share)

            return None

        return self._mutate(mutation)

    def remove_share(self, document_id: str, share_id: str, removed_at: str) -> bool:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> bool:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                for index, share in enumerate(document["shares"]):
                    if share["id"] == share_id:
                        document["shares"].pop(index)
                        document["updated_at"] = removed_at
                        return True
            return False

        return self._mutate(mutation)

    def restore_document_version(
        self,
        *,
        document_id: str,
        version_id: str,
        restored_at: str,
        restored_by_user_id: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                target_version = next(
                    (version for version in document["versions"] if version["id"] == version_id),
                    None
                )
                if target_version is None:
                    return None

                document["title"] = target_version["title"]
                document["content"] = target_version["content"]
                document["updated_at"] = restored_at
                document["versions"].append(
                    {
                        "id": str(uuid4()),
                        "title": target_version["title"],
                        "content": target_version["content"],
                        "created_at": restored_at,
                        "created_by_user_id": restored_by_user_id,
                        "source": "restore",
                        "restored_from_version_id": version_id
                    }
                )
                return deepcopy(document)

            return None

        return self._mutate(mutation)

    def get_document_role(self, document: dict[str, Any], user_id: str) -> str | None:
        if document["owner_id"] == user_id:
            return "owner"

        for share in document["shares"]:
            if share["user_id"] == user_id:
                return share["role"]

        return None


@lru_cache
def get_store() -> JsonStore:
    return JsonStore(get_settings().data_file)


def merge_text_update(*, base_text: str, current_text: str, requested_text: str) -> str:
    if requested_text == current_text:
        return current_text
    if base_text == current_text:
        return requested_text
    if requested_text == base_text:
        return current_text

    patches = dmp.patch_make(base_text, requested_text)
    merged_text, _results = dmp.patch_apply(patches, current_text)
    return merged_text
