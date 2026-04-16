import json
import re
from dataclasses import dataclass
from functools import lru_cache
from html import unescape
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from app.config import Settings, get_settings

TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


class AiProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class AiGenerationRequest:
    feature: str
    source_text: str
    selection_mode: str
    prompt_text: str
    tone: str | None
    output_length: str | None


def plain_text_from_html(value: str) -> str:
    without_tags = TAG_RE.sub(" ", value)
    return SPACE_RE.sub(" ", unescape(without_tags)).strip()


def trim_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


@lru_cache
def load_prompt_templates(prompt_file: str) -> dict[str, str]:
    with Path(prompt_file).open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, dict):
        raise AiProviderError("Prompt template file must contain a JSON object")

    return {str(key): str(value) for key, value in data.items()}


def build_ai_request(
    *,
    feature: str,
    document_title: str,
    document_content: str,
    selected_text: str | None,
    tone: str | None,
    output_length: str | None,
    settings: Settings
) -> AiGenerationRequest:
    document_text = plain_text_from_html(document_content)
    target_text = SPACE_RE.sub(" ", (selected_text or "").strip())
    selection_mode = "selection" if target_text else "document_excerpt"

    if not target_text:
        target_text = document_text

    target_text = trim_text(target_text, settings.ai_max_source_chars)
    if not target_text:
        raise AiProviderError("Select some text or add content before using the assistant")

    context_text = trim_text(document_text, settings.ai_max_context_chars)
    templates = load_prompt_templates(str(settings.ai_prompt_file))
    template = templates.get(feature)
    if not template:
        raise AiProviderError(f"Prompt template missing for '{feature}'")

    prompt_lines = [
        "You are helping with a collaborative document.",
        f"Document title: {document_title.strip() or 'Untitled document'}",
        f"Target mode: {selection_mode.replace('_', ' ')}",
        template.format(
            tone=tone or "clear",
            output_length=output_length or "medium"
        ),
        "",
        "Target text:",
        target_text
    ]

    if context_text and context_text != target_text:
        prompt_lines.extend(["", "Extra document context:", context_text])

    return AiGenerationRequest(
        feature=feature,
        source_text=target_text,
        selection_mode=selection_mode,
        prompt_text="\n".join(prompt_lines),
        tone=tone,
        output_length=output_length
    )


def chunk_text(value: str, size: int = 48) -> list[str]:
    return [value[index : index + size] for index in range(0, len(value), size)] or [""]


def ensure_sentence(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        return cleaned
    if cleaned[-1] not in ".!?":
        return f"{cleaned}."
    return cleaned


def sentence_case(value: str) -> str:
    if not value:
        return value
    return value[0].upper() + value[1:]


def split_sentences(value: str) -> list[str]:
    cleaned = SPACE_RE.sub(" ", value).strip()
    if not cleaned:
        return []
    return [item.strip() for item in SENTENCE_RE.split(cleaned) if item.strip()]


def rewrite_text(source_text: str, tone: str | None) -> str:
    result = SPACE_RE.sub(" ", source_text).strip()

    if tone == "formal":
        replacements = {
            "can't": "cannot",
            "won't": "will not",
            "it's": "it is",
            "don't": "do not",
            "we're": "we are",
            "you'll": "you will"
        }
        for old, new in replacements.items():
            result = re.sub(rf"\b{re.escape(old)}\b", new, result, flags=re.IGNORECASE)
        result = sentence_case(result)
    elif tone == "friendly":
        sentences = split_sentences(result)
        result = " ".join(sentence_case(sentence) for sentence in sentences)
    else:
        result = re.sub(r"\s*,\s*", ", ", result)
        result = re.sub(r"\s*;\s*", ". ", result)
        result = result.replace(" in order to ", " to ")
        result = sentence_case(result)

    return ensure_sentence(result)


def summarize_text(source_text: str, output_length: str | None) -> str:
    sentences = split_sentences(source_text)
    if not sentences:
        return ""

    wanted = {
        "short": 1,
        "medium": 2,
        "long": 4
    }.get(output_length or "medium", 2)

    return " ".join(sentences[:wanted])


def fix_grammar_text(source_text: str) -> str:
    result = SPACE_RE.sub(" ", source_text).strip()
    result = re.sub(r"\s+([,.;!?])", r"\1", result)
    result = re.sub(r"([,.;!?])([A-Za-z])", r"\1 \2", result)
    sentences = split_sentences(result)
    if sentences:
        result = " ".join(sentence_case(sentence) for sentence in sentences)
    else:
        result = sentence_case(result)
    return ensure_sentence(result)


class MockAiProvider:
    model_name = "mock-local"

    def stream(self, request: AiGenerationRequest):
        if request.feature == "rewrite":
            result = rewrite_text(request.source_text, request.tone)
        elif request.feature == "summarize":
            result = summarize_text(request.source_text, request.output_length)
        elif request.feature == "fix_grammar":
            result = fix_grammar_text(request.source_text)
        else:
            raise AiProviderError(f"Unsupported feature '{request.feature}'")

        for chunk in chunk_text(result):
            yield chunk


class OpenAICompatProvider:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def model_name(self) -> str:
        return self._settings.ai_model

    def stream(self, request: AiGenerationRequest):
        headers = {
            "Content-Type": "application/json"
        }
        if self._settings.ai_api_key:
            headers["Authorization"] = f"Bearer {self._settings.ai_api_key}"

        payload = json.dumps(
            {
                "model": self._settings.ai_model,
                "stream": True,
                "temperature": 0.3,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a careful writing assistant. Return only the revised text."
                    },
                    {
                        "role": "user",
                        "content": request.prompt_text
                    }
                ]
            }
        ).encode("utf-8")

        url = self._settings.ai_base_url.rstrip("/") + "/chat/completions"
        call = urllib_request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib_request.urlopen(call, timeout=120) as response:
                while True:
                    raw_line = response.readline()
                    if not raw_line:
                        break

                    line = raw_line.decode("utf-8").strip()
                    if not line or not line.startswith("data:"):
                        continue

                    body = line[5:].strip()
                    if body == "[DONE]":
                        break

                    event = json.loads(body)
                    choice = (event.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    token = delta.get("content")
                    if token:
                        yield token
        except urllib_error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="ignore").strip()
            raise AiProviderError(details or f"AI provider returned HTTP {exc.code}") from exc
        except urllib_error.URLError as exc:
            raise AiProviderError(str(exc.reason)) from exc


@lru_cache
def get_ai_provider():
    settings = get_settings()
    if settings.ai_provider == "mock":
        return MockAiProvider()
    if settings.ai_provider == "openai_compat":
        return OpenAICompatProvider(settings)
    raise AiProviderError(f"Unknown AI provider '{settings.ai_provider}'")
