from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers.auth import router as auth_router
from app.routers.documents import router as documents_router

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description=(
        "Assignment 2 core application backend. Real-time collaboration and AI "
        "assistant endpoints arrive after the document core is stable."
    ),
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/health", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "app": settings.app_name
    }


app.include_router(auth_router)
app.include_router(documents_router)
