import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher

from app.config import get_settings
from app.errors import AppError, authentication_required

password_hasher = PasswordHash((BcryptHasher(),))


def utc_now() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str) -> tuple[str, datetime]:
    settings = get_settings()
    issued_at = utc_now()
    expires_at = issued_at + timedelta(minutes=settings.access_token_ttl_minutes)
    token = jwt.encode(
        {
            "sub": user_id,
            "type": "access",
            "jti": str(uuid4()),
            "iat": int(issued_at.timestamp()),
            "exp": expires_at
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )
    return token, expires_at


def create_refresh_token(user_id: str, session_id: str) -> tuple[str, datetime]:
    settings = get_settings()
    issued_at = utc_now()
    expires_at = issued_at + timedelta(days=settings.refresh_token_ttl_days)
    token = jwt.encode(
        {
            "sub": user_id,
            "sid": session_id,
            "type": "refresh",
            "jti": str(uuid4()),
            "iat": int(issued_at.timestamp()),
            "exp": expires_at
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )
    return token, expires_at


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm]
        )
    except ExpiredSignatureError as exc:
        raise authentication_required("Session expired") from exc
    except InvalidTokenError as exc:
        raise authentication_required("Invalid authentication token") from exc

    if payload.get("type") != expected_type:
        raise AppError(401, "AUTHENTICATION_REQUIRED", "Token type mismatch")

    return payload
