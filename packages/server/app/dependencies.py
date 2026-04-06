from datetime import UTC, datetime

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.errors import authentication_required
from app.security import decode_token
from app.store import JsonStore, get_store

bearer_scheme = HTTPBearer(auto_error=False)


def get_json_store() -> JsonStore:
    return get_store()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    store: JsonStore = Depends(get_json_store)
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise authentication_required()

    payload = decode_token(credentials.credentials, expected_type="access")
    user_id = payload.get("sub")
    if not user_id:
        raise authentication_required("Malformed authentication token")

    user = store.get_user_by_id(user_id)
    if user is None:
        raise authentication_required("User no longer exists")

    return user


def is_expired(iso_timestamp: str) -> bool:
    return datetime.fromisoformat(iso_timestamp) <= datetime.now(UTC)
