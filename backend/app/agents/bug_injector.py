"""Agent D — Bug Injector. Plants the requested defects into the golden code."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import BugInjectionBrief, Codebase, CodeFile
from app.prompts.library import BUG_INJECTOR

_MAX_FILE_CHARS = 1500   # enough for the model to understand and modify the file
_MAX_FILES = 8


def _compact_files(files: list[CodeFile]) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in files[:_MAX_FILES]
    ]


async def run(golden: Codebase, brief: BugInjectionBrief) -> Codebase:
    user = (
        "Golden files (truncated to 1500 chars each):\n"
        f"{json.dumps(_compact_files(golden.files), indent=2)}\n\n"
        "Bug-injection brief:\n"
        f"{json.dumps(brief.model_dump(), indent=2)}\n\n"
        "Return the COMPLETE modified files JSON. Include all files — modified or not. "
        "Expand truncated content to the full original length before applying bugs."
    )
    data = await complete_json(BUG_INJECTOR, user, temperature=0.5, max_tokens=2500)
    files = [CodeFile(**f) for f in data["files"]]

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
