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
# qwen3-32b and llama-4-scout have large context windows and separate quota pools.
_GROQ_FALLBACK_MODELS = [
    "qwen/qwen3-32b",                              # 32B, strong code understanding
    "meta-llama/llama-4-scout-17b-16e-instruct",   # Llama 4 Scout, separate pool
    "llama-3.1-8b-instant",                         # small model, last resort
]

# 400 error codes that mean "this model can't be used" — skip to next, don't raise
_SKIP_MODEL_CODES = {"model_decommissioned", "model_not_active", "model_not_found"}


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
        for attempt, backoff in enumerate([0] + list(_RATE_LIMIT_BACKOFF)):
            if backoff:
                log.warning(
                    "Groq rate limit on %s, retrying in %ds (attempt %d)…",
                    current_model, backoff, attempt,
                )
                await asyncio.sleep(backoff)
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
                err_str = str(e).lower()
                # Any quota exhaustion → skip immediately to next model
                # (TPD = daily, TPM = per-minute — both mean this model can't serve us now)
                log.warning("Rate limit on %s, trying next model: %s", current_model, str(e)[:120])
                break
            except GroqBadRequestError as e:
                last_err = e
                err_body = str(e).lower()
                # Model decommissioned / not active — skip to next model
                body_dict = getattr(e, "body", {}) or {}
                code = (body_dict.get("error") or {}).get("code", "")
                if code in _SKIP_MODEL_CODES or "decommissioned" in err_body:
                    log.warning("Model %s unavailable (%s), trying next", current_model, code)
                    break
                # 400 due to request too large — also skip
                if "token" in err_body and ("limit" in err_body or "large" in err_body):
                    log.warning("Request too large for %s, trying next model", current_model)
                    break
                raise
            except GroqAPIStatusError as e:
                last_err = e
                # 413 = request too large for this model's context/quota window
                if e.status_code == 413:
                    log.warning("Request too large for %s (413), trying next model", current_model)
                    break
                raise
            except Exception:
                raise

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


async def complete_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.4,
) -> Any:
    """Chat completion with tolerant JSON parsing and one strict retry."""
    # When using response_format=json_object, Groq requires the word "JSON" in
    # the prompt. Our prompts already instruct to return JSON, so we're good.
    raw = await complete(
        system=system,
        user=user,
        max_tokens=max_tokens,
        temperature=temperature,
        json_mode=True,
    )
    try:
        return _loads_permissive_json(raw)
    except (json.JSONDecodeError, ValueError) as first_error:
        try:
            return extract_json(raw)
        except (json.JSONDecodeError, ValueError):
            pass

        if _provider() not in {"openai", "openai_compatible", "vllm"}:
            raise first_error

        log.warning(
            "structured JSON parse failed for %s; retrying with stricter prompt: %s",
            settings.resolved_llm_model,
            first_error,
        )
        retry_system = (
            f"{system}\n\n"
            "CRITICAL: Return ONLY strict valid JSON. "
            "Do not include markdown fences or commentary. "
            "Escape all newlines inside string values as \\n."
        )
        retry_user = (
            f"{user}\n\n"
            "Your last answer was invalid JSON. "
            "Return the same schema again as strict valid JSON only."
        )
        raw_retry = await complete(
            system=retry_system,
            user=retry_user,
            max_tokens=max_tokens,
            temperature=min(temperature, 0.2),
            json_mode=False,
        )
        try:
            return _loads_permissive_json(raw_retry)
        except (json.JSONDecodeError, ValueError):
            return extract_json(raw_retry)
