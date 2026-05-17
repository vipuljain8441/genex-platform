"""Helpers that make small-model agent outputs safe to validate."""
from __future__ import annotations

from typing import Any

from app.models.schemas import ChallengeKind

_PRIORITY_VALUES = ("low", "medium", "high", "critical")
_DEFECT_KIND_VALUES = ("bug", "flake", "misconfig", "ambiguity", "gap")
_SEVERITY_VALUES = ("low", "medium", "high")
_CHALLENGE_KIND_VALUES = tuple(kind.value for kind in ChallengeKind)


def normalize_priority(value: Any, default: str = "medium") -> str:
    text = str(value or "").strip().lower()
    if text in _PRIORITY_VALUES:
        return text
    for candidate in _PRIORITY_VALUES:
        if candidate in text:
            return candidate
    return default


def normalize_defect_kind(value: Any, default: str = "bug") -> str:
    text = str(value or "").strip().lower()
    if text in _DEFECT_KIND_VALUES:
        return text
    for candidate in _DEFECT_KIND_VALUES:
        if candidate in text:
            return candidate
    return default


def normalize_severity(value: Any, default: str = "medium") -> str:
    text = str(value or "").strip().lower()
    if text in _SEVERITY_VALUES:
        return text
    for candidate in _SEVERITY_VALUES:
        if candidate in text:
            return candidate
    return default


def normalize_challenge_kind(value: Any, default: str = "coding") -> str:
    text = str(value or "").strip().lower()
    if text in _CHALLENGE_KIND_VALUES:
        return text
    for candidate in _CHALLENGE_KIND_VALUES:
        if candidate in text:
            return candidate
    return default


def normalize_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if "," in text:
            return [part.strip() for part in text.split(",") if part.strip()]
        if "|" in text:
            return [part.strip() for part in text.split("|") if part.strip()]
        return [text]
    return []


def normalize_bug_brief_payload(raw: dict[str, Any]) -> dict[str, Any]:
    data = dict(raw or {})
    defects = []
    for defect in data.get("defects") or []:
        item = dict(defect or {})
        item["kind"] = normalize_defect_kind(item.get("kind"))
        item["severity"] = normalize_severity(item.get("severity"))
        item["location_hint"] = str(item.get("location_hint") or "").strip()
        item["behavior_change"] = str(item.get("behavior_change") or "").strip()
        item["fix_hint"] = str(item.get("fix_hint") or "").strip()
        defects.append(item)
    data["defects"] = defects
    data["notes"] = str(data.get("notes") or "").strip()
    return data


def normalize_candidate_ticket_payload(raw: dict[str, Any]) -> dict[str, Any]:
    data = dict(raw or {})
    data["title"] = str(data.get("title") or "Assessment task").strip()
    data["description"] = str(data.get("description") or "").strip()
    data["acceptance_criteria"] = normalize_string_list(data.get("acceptance_criteria"))
    data["priority"] = normalize_priority(data.get("priority"))
    data["labels"] = normalize_string_list(data.get("labels"))
    data["reporter"] = str(data.get("reporter") or "Priya Menon").strip()
    data["assignee"] = str(data.get("assignee") or "you").strip()
    return data


def normalize_candidate_challenge_payload(raw: dict[str, Any]) -> dict[str, Any]:
    data = dict(raw or {})
    data["kind"] = normalize_challenge_kind(data.get("kind"))
    data["title"] = str(data.get("title") or "Challenge").strip()
    data["description"] = str(data.get("description") or "").strip()
    data["instructions"] = str(data.get("instructions") or "").strip()
    data["acceptance_criteria"] = normalize_string_list(data.get("acceptance_criteria"))
    data["priority"] = normalize_priority(data.get("priority"))
    data["labels"] = normalize_string_list(data.get("labels"))
    data["reporter"] = str(data.get("reporter") or "Priya Menon").strip()
    data["assignee"] = str(data.get("assignee") or "you").strip()
    data["related_files"] = normalize_string_list(data.get("related_files"))
    data["expected_response_format"] = str(data.get("expected_response_format") or "").strip()
    data["editor_language"] = str(data.get("editor_language") or "").strip()
    data["starter_content"] = str(data.get("starter_content") or "").strip()

    issues = []
    for issue in data.get("issues") or []:
        item = dict(issue or {})
        item["title"] = str(item.get("title") or "Issue").strip()
        item["description"] = str(item.get("description") or "").strip()
        item["severity"] = normalize_severity(item.get("severity"))
        issues.append(item)
    data["issues"] = issues
    return data
