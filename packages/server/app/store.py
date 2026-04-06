import json
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Callable, TypeVar
from copy import deepcopy
from uuid import uuid4

from app.config import get_settings

StoreMutationResult = TypeVar("StoreMutationResult")


class JsonStore:
    def __init__(self, data_file: Path) -> None:
        self._data_file = data_file
        self._lock = Lock()

    def ensure_initialized(self) -> None:
        self._data_file.parent.mkdir(parents=True, exist_ok=True)
        if not self._data_file.exists() or self._data_file.stat().st_size == 0:
            self._write_state(self._empty_state())

    def _empty_state(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "users": [],
            "documents": [],
            "refresh_sessions": []
        }

    def _read_state(self) -> dict[str, list[dict[str, Any]]]:
        self.ensure_initialized()
        with self._data_file.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_state(self, state: dict[str, list[dict[str, Any]]]) -> None:
        self._data_file.parent.mkdir(parents=True, exist_ok=True)
        with self._data_file.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)

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
                    raise ValueError("Email already in use")
                if existing_user["username"].casefold() == normalized_username.casefold():
                    raise ValueError("Username already in use")

            user = {
                "id": str(uuid4()),
                "username": normalized_username,
                "email": normalized_email,
                "password_hash": password_hash,
                "created_at": created_at
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

    def update_document(
        self,
        *,
        document_id: str,
        title: str | None,
        content: str | None,
        updated_at: str,
        updated_by_user_id: str,
        source: str
    ) -> dict[str, Any] | None:
        def mutation(state: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
            for document in state["documents"]:
                if document["id"] != document_id or document["deleted_at"] is not None:
                    continue

                next_title = title.strip() if title is not None else document["title"]
                next_content = content if content is not None else document["content"]

                if next_title == document["title"] and next_content == document["content"]:
                    return deepcopy(document)

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
                return deepcopy(document)

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
