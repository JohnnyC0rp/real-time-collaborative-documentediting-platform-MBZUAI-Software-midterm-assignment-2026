from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response, status

from app.config import get_settings
from app.dependencies import get_current_user, get_json_store, is_expired
from app.errors import AppError, authentication_required
from app.schemas import (
    AuthSessionResponse,
    LoginRequest,
    RegisterRequest,
    SuccessResponse,
    UserResponse
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    utc_now,
    verify_password
)
from app.store import JsonStore

router = APIRouter(prefix="/api/auth", tags=["authentication"])


def user_to_response(user: dict) -> UserResponse:
    return UserResponse.model_validate(user)


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/"
    )


def clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/"
    )


def read_refresh_cookie(request: Request) -> str | None:
    settings = get_settings()
    return request.cookies.get(settings.refresh_cookie_name)


def build_session_response(
    *,
    user: dict,
    response: Response,
    store: JsonStore
) -> AuthSessionResponse:
    now = utc_now()
    refresh_session_id = str(uuid4())
    refresh_token, refresh_expires_at = create_refresh_token(user["id"], refresh_session_id)
    store.create_refresh_session(
        session_id=refresh_session_id,
        user_id=user["id"],
        token_hash=hash_refresh_token(refresh_token),
        created_at=now.isoformat(),
        expires_at=refresh_expires_at.isoformat()
    )
    access_token, access_expires_at = create_access_token(user["id"])

    set_refresh_cookie(response, refresh_token)
    return AuthSessionResponse(
        access_token=access_token,
        expires_at=access_expires_at,
        user=user_to_response(user)
    )


@router.post(
    "/register",
    response_model=AuthSessionResponse,
    status_code=status.HTTP_201_CREATED
)
def register(
    payload: RegisterRequest,
    response: Response,
    store: JsonStore = Depends(get_json_store)
) -> AuthSessionResponse:
    try:
        user = store.create_user(
            username=payload.username,
            email=payload.email,
            password_hash=hash_password(payload.password),
            created_at=utc_now().isoformat()
        )
    except ValueError as exc:
        raise AppError(409, "CONFLICT", str(exc)) from exc

    return build_session_response(user=user, response=response, store=store)


@router.post("/login", response_model=AuthSessionResponse)
def login(
    payload: LoginRequest,
    response: Response,
    store: JsonStore = Depends(get_json_store)
) -> AuthSessionResponse:
    user = store.find_user_by_identifier(payload.identifier)
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise authentication_required("Invalid username/email or password")

    return build_session_response(user=user, response=response, store=store)


@router.post("/refresh", response_model=AuthSessionResponse)
def refresh_session(
    request: Request,
    response: Response,
    store: JsonStore = Depends(get_json_store)
) -> AuthSessionResponse:
    cookie_token = read_refresh_cookie(request)
    if cookie_token is None:
        raise authentication_required("Refresh token missing")

    payload = decode_token(cookie_token, expected_type="refresh")
    session_id = payload.get("sid")
    user_id = payload.get("sub")
    if not session_id or not user_id:
        raise authentication_required("Malformed refresh token")

    refresh_session_record = store.get_refresh_session(session_id)
    if refresh_session_record is None:
        raise authentication_required("Refresh session not found")

    if refresh_session_record["revoked_at"] is not None:
        raise authentication_required("Refresh session revoked")

    if is_expired(refresh_session_record["expires_at"]):
        raise authentication_required("Refresh session expired")

    if refresh_session_record["token_hash"] != hash_refresh_token(cookie_token):
        raise authentication_required("Refresh session mismatch")

    store.revoke_refresh_session(session_id, revoked_at=utc_now().isoformat())

    user = store.get_user_by_id(user_id)
    if user is None:
        clear_refresh_cookie(response)
        raise authentication_required("User no longer exists")

    return build_session_response(user=user, response=response, store=store)


@router.post("/logout", response_model=SuccessResponse)
def logout(
    request: Request,
    response: Response,
    store: JsonStore = Depends(get_json_store)
) -> SuccessResponse:
    cookie_token = read_refresh_cookie(request)
    if cookie_token:
        try:
            payload = decode_token(cookie_token, expected_type="refresh")
            session_id = payload.get("sid")
            if session_id:
                store.revoke_refresh_session(session_id, revoked_at=utc_now().isoformat())
        except AppError:
            # Cookie cleanup still matters even if the token has already gone weird.
            pass

    clear_refresh_cookie(response)
    return SuccessResponse()


@router.get("/me", response_model=UserResponse)
def me(current_user: dict = Depends(get_current_user)) -> UserResponse:
    return user_to_response(current_user)
