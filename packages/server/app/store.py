import json
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Callable, TypeVar
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


@lru_cache
def get_store() -> JsonStore:
    return JsonStore(get_settings().data_file)
