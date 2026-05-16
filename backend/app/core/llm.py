"""Thin async wrapper around the Groq Chat Completions API.

Same surface as the previous Anthropic version (`complete` / `complete_json`)
so the agents are oblivious to the provider. Uses Groq's native JSON mode for
structured outputs where possible.
"""
from __future__ import annotations

import json
import re
from typing import Any

from groq import AsyncGroq

from app.core.config import settings

_client: AsyncGroq | None = None


def get_client() -> AsyncGroq:
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=settings.groq_api_key)
    return _client


async def complete(
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.7,
    json_mode: bool = False,
    cache_system: bool = True,  # kept for API compatibility; Groq has no cache
) -> str:
    """Single-turn chat completion against Groq."""
    del cache_system  # unused — Groq has no ephemeral cache

    client = get_client()
    kwargs: dict[str, Any] = {
        "model": settings.groq_model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    resp = await client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)


def extract_json(text: str) -> Any:
    """Best-effort extraction of a JSON value from a model response."""
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
                return json.loads(candidate[start : i + 1])
    raise ValueError(f"unterminated JSON in response: {text[:200]}")


async def complete_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 4096,
    temperature: float = 0.4,
) -> Any:
    """Chat completion with Groq's JSON mode, with regex fallback."""
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
        return json.loads(raw)
    except json.JSONDecodeError:
        return extract_json(raw)
