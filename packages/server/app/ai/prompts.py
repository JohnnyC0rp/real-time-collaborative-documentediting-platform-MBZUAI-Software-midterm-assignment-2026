from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).with_name("prompts")


@lru_cache
def load_prompt_template(name: str) -> str:
    template_path = PROMPTS_DIR / f"{name}.txt"
    return template_path.read_text(encoding="utf-8").strip()


def build_prompt(
    *,
    action: str,
    selected_text: str,
    before_context: str,
    after_context: str,
    outline_summary: str,
    target_language: str | None,
    instruction: str | None
) -> tuple[str, str]:
    system_prompt = load_prompt_template("system")
    action_prompt = load_prompt_template(action)
    user_prompt = action_prompt.format(
        selected_text=selected_text.strip(),
        before_context=before_context.strip() or "(none)",
        after_context=after_context.strip() or "(none)",
        outline_summary=outline_summary.strip() or "(none)",
        target_language=(target_language or "the requested language").strip(),
        instruction=(instruction or "No extra instruction provided.").strip()
    )
    return system_prompt, user_prompt
