"""Agent D — Bug Injector. Plants the requested defects into the golden code."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from app.core.llm import complete_json
from app.models.schemas import BugInjectionBrief, Codebase, CodeFile
from app.prompts.library import BUG_INJECTOR

log = logging.getLogger(__name__)

_MAX_FILE_CHARS = 1500   # enough for the model to understand and modify the file
_MAX_FILES = 8
_MAX_TARGET_FILES = 4
_MAX_CONTEXT_FILES = 5


def _compact_files(files: list[CodeFile]) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in files[:_MAX_FILES]
    ]


def _normalize_path_like(value: object) -> str:
    return str(value or "").strip().replace("\\", "/").lower()


def _pick_target_files(golden: Codebase, brief: BugInjectionBrief) -> list[CodeFile]:
    """Best-effort match of defect location hints to likely source files."""
    golden_by_path = {file.path: file for file in golden.files}
    normalized_paths = {_normalize_path_like(path): path for path in golden_by_path}
    selected: list[CodeFile] = []
    seen: set[str] = set()

    for defect in brief.defects:
        if not isinstance(defect, dict):
            continue
        hint = _normalize_path_like(defect.get("location_hint"))
        if not hint:
            continue

        matched_path: str | None = None

        for normalized, original in normalized_paths.items():
            if normalized in hint or hint in normalized:
                matched_path = original
                break

        if matched_path is None:
            hint_name = Path(hint.split("/", 1)[0] if "/" not in hint else hint).name
            for original in golden_by_path:
                if Path(original).name.lower() == hint_name.lower():
                    matched_path = original
                    break

        if matched_path and matched_path not in seen:
            seen.add(matched_path)
            selected.append(golden_by_path[matched_path])
        if len(selected) >= _MAX_TARGET_FILES:
            break

    if selected:
        return selected

    return golden.files[: min(_MAX_TARGET_FILES, len(golden.files))]


def _is_file_dict(d: object) -> bool:
    """A real CodeFile dict must have path, content, and language — not just path."""
    return isinstance(d, dict) and "path" in d and "content" in d and "language" in d


def _extract_files_list(data: dict) -> list[dict] | None:
    """Find the files list regardless of how the model wrapped the response."""
    # Primary: common top-level key names — require all three CodeFile fields
    for key in ("files", "modified_files", "output_files", "codebase", "result"):
        val = data.get(key)
        if isinstance(val, list) and val and _is_file_dict(val[0]):
            return val

    # One level deep (model may have nested under a parent key)
    for v in data.values():
        if isinstance(v, dict):
            for key in ("files", "modified_files", "output_files"):
                val = v.get(key)
                if isinstance(val, list) and val and _is_file_dict(val[0]):
                    return val

    # Last resort: any list whose first item looks like a complete CodeFile
    for v in data.values():
        if isinstance(v, list) and v and _is_file_dict(v[0]):
            return v

    return None


async def run(golden: Codebase, brief: BugInjectionBrief) -> Codebase:
    target_files = _pick_target_files(golden, brief)
    target_paths = {file.path for file in target_files}
    context_files = [file for file in golden.files if file.path not in target_paths][: _MAX_CONTEXT_FILES]
    user = (
        "Target files to modify (complete content, modify only if the brief requires it):\n"
        f"{json.dumps([file.model_dump(mode='json') for file in target_files], indent=2)}\n\n"
        "Additional codebase context (truncated, read-only context):\n"
        f"{json.dumps(_compact_files(context_files), indent=2)}\n\n"
        "Bug-injection brief:\n"
        f"{json.dumps(brief.model_dump(), indent=2)}\n\n"
        "Return ONLY the files that you changed. "
        "Do not echo untouched files. "
        "Every returned file must contain the COMPLETE final file content. "
        'The response must be a JSON object with a top-level "modified_files" key.'
    )
    data = await complete_json(BUG_INJECTOR, user, temperature=0.4, max_tokens=3200)

    files_raw = _extract_files_list(data)
    if not files_raw:
        log.error("bug_injector: no valid files list in LLM response. keys=%s", list(data.keys()))
        log.warning("bug_injector: falling back to golden codebase (no bugs injected)")
        return golden

    golden_by_path = {f.path: f for f in golden.files}
    modified_files: list[CodeFile] = []
    for item in files_raw:
        if not isinstance(item, dict):
            continue
        path = item.get("path") or item.get("file_path")
        fallback = golden_by_path.get(str(path)) if path else None
        parsed = CodeFile.from_llm(item, fallback=fallback)
        if parsed and parsed.path:
            if parsed.path not in target_paths and parsed.path not in golden_by_path:
                log.warning("bug_injector: ignoring unexpected file outside target set: %s", parsed.path)
                continue
            modified_files.append(parsed)

    if not modified_files:
        log.warning("bug_injector: all returned file dicts were invalid — falling back to golden codebase")
        return golden

    merged_files: list[CodeFile] = []
    modified_by_path = {file.path: file for file in modified_files}
    for golden_file in golden.files:
        merged_files.append(modified_by_path.get(golden_file.path, golden_file))

    for path, file in modified_by_path.items():
        if path not in golden_by_path:
            merged_files.append(file)

    return Codebase(
        artifact_kind=golden.artifact_kind,
        entry_point=golden.entry_point,
        setup_instructions=golden.setup_instructions,
        files=merged_files,
    )
