"""Thin async wrapper around the configured chat-completions provider.

Supports:
- Groq via the native Groq SDK
- any OpenAI-compatible endpoint (for example a local Ollama server hosting
  `qwen2.5-coder:0.5b`)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from groq import (
    APIStatusError as GroqAPIStatusError,
    AsyncGroq,
    BadRequestError as GroqBadRequestError,
    NotFoundError as GroqNotFoundError,
    RateLimitError as GroqRateLimitError,
)
from openai import AsyncOpenAI, RateLimitError as OpenAIRateLimitError

from app.core.config import settings

_groq_client: AsyncGroq | None = None
_openai_client: AsyncOpenAI | None = None
log = logging.getLogger(__name__)


def _provider() -> str:
    return settings.llm_provider.strip().lower()


def get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        # max_retries=0 — we handle retries ourselves with model fallback logic
        _groq_client = AsyncGroq(api_key=settings.resolved_llm_api_key, max_retries=0)
    return _groq_client


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        kwargs: dict[str, Any] = {
            "api_key": settings.resolved_llm_api_key or "local-dev-token",
        }
        if settings.llm_api_base:
            kwargs["base_url"] = settings.llm_api_base.rstrip("/")
        _openai_client = AsyncOpenAI(**kwargs)
    return _openai_client


_RATE_LIMIT_BACKOFF = (5, 15, 30)  # seconds between retries

# Groq fallback model chain — tried when the primary model hits quota limits.
# Avoid qwen3-* models: thinking mode is on by default and Groq does not expose
# a supported API to disable it, causing unpredictable JSON structure in responses.
# llama-3.1-70b-versatile was decommissioned on Groq — do not add it back.
_GROQ_FALLBACK_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
]

_GROQ_RETRY_AFTER_RE = re.compile(r"try again in ([\d.]+)s", re.IGNORECASE)
_GROQ_TPM_RETRIES = 2

# 400 error codes that mean "this model can't be used" — skip to next, don't raise
_SKIP_MODEL_CODES = {"model_decommissioned", "model_not_active", "model_not_found"}


def _groq_model_unavailable(exc: Exception) -> bool:
    """True when we should try the next model in the Groq fallback chain."""
    err_body = str(exc).lower()
    if "model_not_found" in err_body or "does not exist" in err_body:
        return True
    if "decommissioned" in err_body:
        return True
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        code = (body.get("error") or {}).get("code", "")
        if code in _SKIP_MODEL_CODES:
            return True
    status = getattr(exc, "status_code", None)
    return status == 404


def _groq_retry_after_seconds(exc: Exception) -> float | None:
    m = _GROQ_RETRY_AFTER_RE.search(str(exc))
    if not m:
        return None
    return min(float(m.group(1)) + 0.75, 60.0)


def _groq_rate_limit_is_tpm(exc: Exception) -> bool:
    s = str(exc).lower()
    return "per minute" in s or "tokens per minute" in s or "tpm" in s


async def complete(
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    json_mode: bool = False,
    cache_system: bool = True,  # kept for API compatibility
) -> str:
    """Single-turn chat completion with automatic rate-limit retry + model fallback."""
    del cache_system

    primary_model = settings.resolved_llm_model
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    if _provider() == "groq":
        return await _complete_groq(
            messages, primary_model, max_tokens, temperature, json_mode
        )

    if _provider() in {"openai", "openai_compatible", "vllm"}:
        return await _complete_openai(messages, primary_model, max_tokens, temperature)

    raise ValueError(f"Unsupported LLM_PROVIDER: {settings.llm_provider!r}")


async def _complete_groq(
    messages: list[dict],
    model: str,
    max_tokens: int,
    temperature: float,
    json_mode: bool,
) -> str:
    client = get_groq_client()
    # Try primary model, then fallbacks
    models_to_try = [model] + [m for m in _GROQ_FALLBACK_MODELS if m != model]
    last_err: Exception | None = None

    for current_model in models_to_try:
        tpm_retries = 0
        while True:
            try:
                kwargs: dict[str, Any] = {
                    "model": current_model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": messages,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                resp = await client.chat.completions.create(**kwargs)
                if current_model != settings.resolved_llm_model:
                    log.info("Used fallback model %s", current_model)
                return resp.choices[0].message.content or ""
            except GroqRateLimitError as e:
                last_err = e
                wait = _groq_retry_after_seconds(e)
                if _groq_rate_limit_is_tpm(e) and tpm_retries < _GROQ_TPM_RETRIES:
                    delay = wait or _RATE_LIMIT_BACKOFF[min(tpm_retries, len(_RATE_LIMIT_BACKOFF) - 1)]
                    log.warning(
                        "Groq TPM limit on %s, waiting %.1fs (retry %d/%d)",
                        current_model,
                        delay,
                        tpm_retries + 1,
                        _GROQ_TPM_RETRIES,
                    )
                    await asyncio.sleep(delay)
                    tpm_retries += 1
                    continue
                log.warning(
                    "Rate limit on %s, trying next model: %s",
                    current_model,
                    str(e)[:120],
                )
                break
            except (GroqBadRequestError, GroqNotFoundError) as e:
                last_err = e
                if _groq_model_unavailable(e):
                    log.warning("Model %s unavailable, trying next: %s", current_model, e)
                    break
                err_body = str(e).lower()
                if "token" in err_body and ("limit" in err_body or "large" in err_body):
                    log.warning("Request too large for %s, trying next model", current_model)
                    break
                raise
            except GroqAPIStatusError as e:
                last_err = e
                if _groq_model_unavailable(e):
                    log.warning("Model %s unavailable (%s), trying next", current_model, e.status_code)
                    break
                if e.status_code == 413:
                    log.warning("Request too large for %s (413), trying next model", current_model)
                    break
                raise
            except Exception:
                raise

    # Last resort: one more try on the smallest model after TPM cooldown.
    if last_err and _groq_rate_limit_is_tpm(last_err):
        final_model = "llama-3.1-8b-instant"
        delay = _groq_retry_after_seconds(last_err) or 10.0
        log.warning(
            "All Groq models rate-limited; final retry on %s in %.1fs",
            final_model,
            delay,
        )
        await asyncio.sleep(delay)
        try:
            kwargs = {
                "model": final_model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            resp = await client.chat.completions.create(**kwargs)
            log.info("Used final TPM cooldown retry on %s", final_model)
            return resp.choices[0].message.content or ""
        except Exception as e:
            last_err = e

    raise last_err  # type: ignore[misc]


async def _complete_openai(
    messages: list[dict],
    model: str,
    max_tokens: int,
    temperature: float,
) -> str:
    client = get_openai_client()
    last_err: Exception | None = None
    for attempt, backoff in enumerate([0] + list(_RATE_LIMIT_BACKOFF)):
        if backoff:
            log.warning("OpenAI rate limit, retrying in %ds", backoff)
            await asyncio.sleep(backoff)
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages,
            }
            resp = await client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content or ""
        except OpenAIRateLimitError as e:
            last_err = e
            continue
        except Exception:
            raise
    raise last_err  # type: ignore[misc]


_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)


def _escape_control_chars_in_strings(text: str) -> str:
    """Repair raw control chars inside quoted strings for permissive JSON parse.

    Smaller local models often emit literal newlines / tabs inside string
    values, which is illegal JSON but still easy to repair safely.
    """
    out: list[str] = []
    in_str = False
    esc = False

    for ch in text:
        if in_str:
            if esc:
                out.append(ch)
                esc = False
                continue
            if ch == "\\":
                out.append(ch)
                esc = True
                continue
            if ch == '"':
                out.append(ch)
                in_str = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                out.append("\\r")
                continue
            if ch == "\t":
                out.append("\\t")
                continue
            if ord(ch) < 32:
                out.append(f"\\u{ord(ch):04x}")
                continue
            out.append(ch)
            continue

        out.append(ch)
        if ch == '"':
            in_str = True

    return "".join(out)


def _extract_json_candidate(text: str) -> str:
    """Slice out the first balanced JSON object/array from a model response."""
    match = _JSON_FENCE.search(text)
    candidate = match.group(1) if match else text
    start = min(
        (i for i in (candidate.find("{"), candidate.find("[")) if i != -1),
        default=-1,
    )
    if start == -1:
        raise ValueError(f"no JSON found in response: {text[:200]}")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(candidate)):
        ch = candidate[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return candidate[start : i + 1]
    raise ValueError(f"unterminated JSON in response: {text[:200]}")


def _loads_permissive_json(candidate: str) -> Any:
    """Parse JSON, retrying with repaired control chars when needed."""
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        repaired = _escape_control_chars_in_strings(candidate)
        return json.loads(repaired)


def extract_json(text: str) -> Any:
    """Best-effort extraction of a JSON value from a model response."""
    candidate = _extract_json_candidate(text)
    return _loads_permissive_json(candidate)


def _parse_llm_json(raw: str) -> Any:
    """Parse model output as JSON with fence extraction fallback."""
    try:
        return _loads_permissive_json(raw)
    except (json.JSONDecodeError, ValueError):
        return extract_json(raw)


def _groq_error_body(error: GroqBadRequestError) -> dict[str, Any]:
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            pass
    return {}


def _recover_from_groq_json_validate(error: GroqBadRequestError) -> Any | None:
    """Try to salvage Groq's failed_generation payload after json_validate_failed."""
    err = (_groq_error_body(error).get("error") or {})
    if err.get("code") != "json_validate_failed":
        return None
    failed = err.get("failed_generation")
    if not isinstance(failed, str) or not failed.strip():
        return None
    for candidate in (failed, _escape_control_chars_in_strings(failed)):
        try:
            return _parse_llm_json(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
    return None


async def _complete_json_retry_plain(
    system: str,
    user: str,
    *,
    max_tokens: int,
    temperature: float,
    reason: str,
) -> Any:
    log.warning(
        "%s: retrying structured output without json_mode (%s)",
        settings.resolved_llm_model,
        reason,
    )
    retry_system = (
        f"{system}\n\n"
        "CRITICAL JSON OUTPUT RULES:\n"
        "- Return ONE valid JSON object only. No markdown fences or commentary.\n"
        "- Inside every string value (especially file `content`): use \\n for newlines.\n"
        "- Escape every double quote as \\\". In Python code prefer single-quoted strings "
        "for paths and messages (e.g. @app.get('/items/')) to avoid JSON breakage.\n"
    )
    retry_user = (
        f"{user}\n\n"
        "Your previous response was not valid JSON. Return the same schema again as "
        "strict valid JSON only, with all special characters properly escaped."
    )
    raw = await complete(
        system=retry_system,
        user=retry_user,
        max_tokens=max_tokens,
        temperature=min(temperature, 0.25),
        json_mode=False,
    )
    if not (raw or "").strip():
        raise ValueError("empty response on JSON retry")
    return _parse_llm_json(raw)


async def complete_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.4,
) -> Any:
    """Chat completion with tolerant JSON parsing and Groq-safe fallbacks."""
    raw: str
    try:
        raw = await complete(
            system=system,
            user=user,
            max_tokens=max_tokens,
            temperature=temperature,
            json_mode=True,
        )
    except GroqBadRequestError as e:
        err_body = str(e).lower()
        if "json_validate" in err_body or "failed to generate json" in err_body:
            recovered = _recover_from_groq_json_validate(e)
            if recovered is not None:
                log.info("Recovered pipeline JSON from Groq failed_generation")
                return recovered
            return await _complete_json_retry_plain(
                system,
                user,
                max_tokens=max_tokens,
                temperature=temperature,
                reason="json_validate_failed",
            )
        raise

    if not (raw or "").strip():
        return await _complete_json_retry_plain(
            system,
            user,
            max_tokens=max_tokens,
            temperature=temperature,
            reason="empty response",
        )

    try:
        return _parse_llm_json(raw)
    except (json.JSONDecodeError, ValueError) as first_error:
        return await _complete_json_retry_plain(
            system,
            user,
            max_tokens=max_tokens,
            temperature=temperature,
            reason=str(first_error),
        )
