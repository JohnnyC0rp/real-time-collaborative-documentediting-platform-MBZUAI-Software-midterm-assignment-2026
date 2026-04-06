from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class UserResponse(BaseModel):
    id: str
    username: str
    email: EmailStr
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicUserResponse(BaseModel):
    id: str
    username: str
    email: EmailStr


class AuthSessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class CreateDocumentRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class UpdateDocumentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    content: str | None = None
    save_source: Literal["autosave", "manual-update"] = "manual-update"


class ShareDocumentRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    role: Literal["editor", "viewer"]


class RestoreVersionRequest(BaseModel):
    version_id: str = Field(min_length=1, max_length=64)


class DocumentShareResponse(BaseModel):
    id: str
    user_id: str
    username: str
    email: EmailStr
    role: Literal["editor", "viewer"]
    granted_at: datetime


class DocumentVersionResponse(BaseModel):
    id: str
    title: str
    content: str
    created_at: datetime
    created_by: PublicUserResponse
    source: Literal["autosave", "manual-update", "restore", "initial"]
    restored_from_version_id: str | None


class DocumentSummaryResponse(BaseModel):
    id: str
    title: str
    owner_id: str
    created_at: datetime
    updated_at: datetime
    role: Literal["owner", "editor", "viewer"]
    owner: PublicUserResponse


class DocumentDetailResponse(DocumentSummaryResponse):
    content: str
    shares: list[DocumentShareResponse]
    versions: list[DocumentVersionResponse]


class DocumentsResponse(BaseModel):
    documents: list[DocumentSummaryResponse]


class SuccessResponse(BaseModel):
    success: bool = True
