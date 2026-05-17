"""Agent D — Bug Injector. Plants the requested defects into the golden code."""
from __future__ import annotations

import json
import logging

from app.core.llm import complete_json
from app.models.schemas import BugInjectionBrief, Codebase, CodeFile
from app.prompts.library import BUG_INJECTOR

log = logging.getLogger(__name__)

_MAX_FILE_CHARS = 1500   # enough for the model to understand and modify the file
_MAX_FILES = 8


def _compact_files(files: list[CodeFile]) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in files[:_MAX_FILES]
    ]


def _extract_files_list(data: dict) -> list[dict] | None:
    """Find the files list regardless of how the model wrapped the response."""
    # Try common top-level key names
    for key in ("files", "modified_files", "output_files", "codebase", "result"):
        val = data.get(key)
        if isinstance(val, list) and val:
            if isinstance(val[0], dict) and "path" in val[0]:
                return val

    # One level deep (model may have nested under a parent key)
    for v in data.values():
        if isinstance(v, dict):
            for key in ("files", "modified_files", "output_files"):
                val = v.get(key)
                if isinstance(val, list) and val and isinstance(val[0], dict) and "path" in val[0]:
                    return val

    # Last resort: look for any list whose items have {path, content}
    for v in data.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            if "path" in v[0] and "content" in v[0]:
                return v

    return None


async def run(golden: Codebase, brief: BugInjectionBrief) -> Codebase:
    user = (
        "Golden files (truncated to 1500 chars each):\n"
        f"{json.dumps(_compact_files(golden.files), indent=2)}\n\n"
        "Bug-injection brief:\n"
        f"{json.dumps(brief.model_dump(), indent=2)}\n\n"
        "Return the COMPLETE modified files JSON. Include all files — modified or not. "
        "Expand truncated content to the full original length before applying bugs. "
        'The response must be a JSON object with a top-level "files" key.'
    )
    data = await complete_json(BUG_INJECTOR, user, temperature=0.5, max_tokens=2500)

    files_raw = _extract_files_list(data)
    if not files_raw:
        log.error("bug_injector: no files list in LLM response. keys=%s", list(data.keys()))
        # Fall back to returning the golden codebase unmodified rather than crashing
        log.warning("bug_injector: falling back to golden codebase (no bugs injected)")
        return golden

    golden_by_path = {f.path: f for f in golden.files}
    files: list[CodeFile] = []
    for item in files_raw:
        if not isinstance(item, dict):
            continue
        path = item.get("path") or item.get("file_path")
        fallback = golden_by_path.get(str(path)) if path else None
        parsed = CodeFile.from_llm(item, fallback=fallback)
        if parsed and parsed.path:
            files.append(parsed)

    # Merge: keep golden content for files the injector didn't touch or truncated away
    injected_paths = {f.path for f in files}
    for gf in golden.files:
        if gf.path not in injected_paths:
            files.append(gf)

    return Codebase(
        artifact_kind=golden.artifact_kind,
        entry_point=golden.entry_point,
        setup_instructions=golden.setup_instructions,
        files=files,
    )
