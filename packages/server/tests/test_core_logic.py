import pytest

from app.ai.prompts import build_prompt
from app.errors import AppError
from app.routers.documents import require_role
from app.security import create_access_token, decode_token, hash_password, verify_password
from app.store import merge_text_update


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("correct horse battery staple")

    assert password_hash != "correct horse battery staple"
    assert verify_password("correct horse battery staple", password_hash)
    assert not verify_password("definitely the wrong password", password_hash)


def test_decode_token_rejects_wrong_expected_type() -> None:
    token, _ = create_access_token("user-123")

    with pytest.raises(AppError, match="Token type mismatch"):
        decode_token(token, expected_type="refresh")


def test_require_role_blocks_viewer_from_editor_actions() -> None:
    with pytest.raises(AppError, match="You cannot edit this document"):
        require_role("viewer", {"owner", "editor"}, "You cannot edit this document")


def test_build_prompt_uses_templates_and_runtime_context() -> None:
    system_prompt, user_prompt = build_prompt(
        action="translate",
        selected_text="Hello world",
        before_context="Before",
        after_context="After",
        outline_summary="## Heading",
        target_language="Arabic",
        instruction="Keep the tone formal"
    )

    assert "editorial assistant" in system_prompt.lower()
    assert "Hello world" in user_prompt
    assert "Arabic" in user_prompt
    assert "Keep the tone formal" in user_prompt


def test_merge_text_update_rebases_character_level_edits() -> None:
    merged = merge_text_update(
        base_text="Alpha plan",
        current_text="Alpha team plan",
        requested_text="Alpha plan draft"
    )

    assert merged == "Alpha team plan draft"
