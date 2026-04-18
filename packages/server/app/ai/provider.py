import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.config import Settings, get_settings
from app.errors import AppError


@dataclass(frozen=True)
class AiGenerationInput:
    action: str
    selected_text: str
    before_context: str
    after_context: str
    outline_summary: str
    target_language: str | None
    instruction: str | None
    system_prompt: str
    user_prompt: str


@dataclass(frozen=True)
class AiProviderResponse:
    text: str
    model_id: str


class BaseAiProvider:
    def generate(self, generation_input: AiGenerationInput) -> AiProviderResponse:
        raise NotImplementedError


class LocalAiProvider(BaseAiProvider):
    def generate(self, generation_input: AiGenerationInput) -> AiProviderResponse:
        action = generation_input.action
        selected_text = generation_input.selected_text.strip()

        if action == "rewrite":
            text = rewrite_text(selected_text, generation_input.instruction)
        elif action == "summarize":
            text = summarize_text(selected_text)
        elif action == "translate":
            text = translate_text(selected_text, generation_input.target_language)
        elif action == "restructure":
            text = restructure_text(selected_text, generation_input.outline_summary)
        else:
            raise AppError(400, "VALIDATION_ERROR", "Unsupported AI action")

        return AiProviderResponse(text=text, model_id="local-fallback-v1")


class OpenAiProvider(BaseAiProvider):
    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.openai_base_url.rstrip("/")
        self._api_key = settings.openai_api_key
        self._model = settings.openai_model

    def generate(self, generation_input: AiGenerationInput) -> AiProviderResponse:
        if not self._api_key:
            raise AppError(502, "SERVER_ERROR", "OPENAI_API_KEY is not configured")

        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": generation_input.system_prompt
                },
                {
                    "role": "user",
                    "content": generation_input.user_prompt
                }
            ],
            "temperature": 0.4
        }

        request = urllib.request.Request(
            url=f"{self._base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise AppError(502, "SERVER_ERROR", f"AI provider request failed: {detail or exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise AppError(502, "SERVER_ERROR", "AI provider is unavailable") from exc

        try:
            content = body["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, AttributeError, TypeError) as exc:
            raise AppError(502, "SERVER_ERROR", "AI provider returned an unexpected payload") from exc

        if not content:
            raise AppError(502, "SERVER_ERROR", "AI provider returned empty output")

        return AiProviderResponse(text=content, model_id=self._model)


class GeminiProvider(BaseAiProvider):
    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.gemini_base_url.rstrip("/")
        self._api_key = settings.gemini_api_key
        self._model = settings.gemini_model

    def generate(self, generation_input: AiGenerationInput) -> AiProviderResponse:
        if not self._api_key:
            raise AppError(502, "SERVER_ERROR", "GEMINI_API_KEY is not configured")

        payload = {
            "systemInstruction": {
                "parts": [
                    {
                        "text": generation_input.system_prompt
                    }
                ]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": generation_input.user_prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.4
            }
        }

        request = urllib.request.Request(
            url=f"{self._base_url}/models/{self._model}:generateContent?key={self._api_key}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise AppError(502, "SERVER_ERROR", f"AI provider request failed: {detail or exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise AppError(502, "SERVER_ERROR", "AI provider is unavailable") from exc

        content_parts = (
            body.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )
        text = "".join(part.get("text", "") for part in content_parts).strip()

        if not text:
            prompt_feedback = body.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason")
            if block_reason:
                raise AppError(502, "SERVER_ERROR", f"Gemini blocked the request: {block_reason}")
            raise AppError(502, "SERVER_ERROR", "Gemini returned empty output")

        return AiProviderResponse(text=text, model_id=self._model)


def get_ai_provider() -> BaseAiProvider:
    settings = get_settings()
    if settings.ai_provider == "openai":
        return OpenAiProvider(settings)
    if settings.ai_provider == "gemini":
        return GeminiProvider(settings)
    return LocalAiProvider()


def cleanup_text(value: str) -> str:
    collapsed = re.sub(r"[ \t]+", " ", value.strip())
    collapsed = re.sub(r"\n{3,}", "\n\n", collapsed)
    return collapsed


def split_paragraphs(value: str) -> list[str]:
    cleaned = cleanup_text(value)
    return [paragraph.strip() for paragraph in re.split(r"\n{2,}", cleaned) if paragraph.strip()]


def split_sentences(value: str) -> list[str]:
    normalized = cleanup_text(value)
    if not normalized:
        return []
    return [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", normalized) if segment.strip()]


def polish_sentence(sentence: str) -> str:
    sentence = cleanup_text(sentence)
    sentence = re.sub(r"\b(really|very|just)\b", "", sentence, flags=re.IGNORECASE)
    sentence = re.sub(r"\s{2,}", " ", sentence).strip(" ,")
    if sentence and sentence[-1] not in ".!?":
        sentence = f"{sentence}."
    if sentence:
        sentence = sentence[0].upper() + sentence[1:]
    return sentence


def rewrite_text(value: str, instruction: str | None) -> str:
    paragraphs = split_paragraphs(value)
    rewritten: list[str] = []
    wants_shorter = bool(instruction and "short" in instruction.lower())
    wants_formal = bool(instruction and "formal" in instruction.lower())

    for paragraph in paragraphs or [cleanup_text(value)]:
        sentences = [polish_sentence(sentence) for sentence in split_sentences(paragraph)]
        sentences = [sentence for sentence in sentences if sentence]
        if wants_shorter and len(sentences) > 2:
            sentences = sentences[:2]
        text = " ".join(sentences) if sentences else polish_sentence(paragraph)
        if wants_formal:
            text = text.replace("can't", "cannot").replace("won't", "will not")
        rewritten.append(text.strip())

    return "\n\n".join(segment for segment in rewritten if segment)


def summarize_text(value: str) -> str:
    sentences = split_sentences(value)
    if not sentences:
        return cleanup_text(value)
    if len(sentences) <= 2:
        return " ".join(polish_sentence(sentence) for sentence in sentences)

    picks = [sentences[0], sentences[len(sentences) // 2], sentences[-1]]
    summary_parts: list[str] = []
    seen: set[str] = set()
    for sentence in picks:
        polished = polish_sentence(sentence)
        normalized_key = polished.casefold()
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        summary_parts.append(polished)

    return " ".join(summary_parts[:3])


def translate_text(value: str, target_language: str | None) -> str:
    requested_language = (target_language or "the requested language").strip()
    return (
        f"[Local fallback output for translation to {requested_language}. "
        "Configure AI_PROVIDER=openai for model-backed translation quality.]\n\n"
        f"{cleanup_text(value)}"
    )


def restructure_text(value: str, outline_summary: str) -> str:
    paragraphs = split_paragraphs(value)
    sentences = split_sentences(value)
    bullet_points = [polish_sentence(sentence) for sentence in sentences[:4]]

    sections: list[str] = []
    sections.append("Overview")
    sections.append(paragraphs[0] if paragraphs else cleanup_text(value))

    if len(bullet_points) > 1:
        sections.append("\nKey Points")
        sections.extend(f"- {point}" for point in bullet_points)

    if outline_summary.strip():
        sections.append("\nDocument Context")
        sections.append(outline_summary.strip())

    return "\n".join(section for section in sections if section.strip())
