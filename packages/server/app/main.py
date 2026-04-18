from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import AppError
from app.routers.ai import router as ai_router
from app.routers.auth import router as auth_router
from app.routers.collaboration import router as collaboration_router
from app.routers.documents import router as documents_router
from app.routers.public import router as public_router
from app.store import get_store

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description="Collaborative document editor backend with document CRUD and AI assistant APIs.",
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
def ensure_data_file() -> None:
    get_store().ensure_initialized()


@app.exception_handler(AppError)
def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message
            }
        }
    )


@app.exception_handler(RequestValidationError)
def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    first_error = exc.errors()[0]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": first_error.get("msg", "Validation failed")
            }
        }
    )


@app.get("/health", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "app": settings.app_name
    }


app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(ai_router)
app.include_router(collaboration_router)
app.include_router(public_router)
