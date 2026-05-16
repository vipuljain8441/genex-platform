"""Agent D — Bug Injector. Plants the requested defects into the golden code."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import BugInjectionBrief, Codebase, CodeFile
from app.prompts.library import BUG_INJECTOR


async def run(golden: Codebase, brief: BugInjectionBrief) -> Codebase:
    user = (
        "Golden files:\n"
        f"{json.dumps([f.model_dump() for f in golden.files], indent=2)}\n\n"
        "Bug-injection brief:\n"
        f"{json.dumps(brief.model_dump(), indent=2)}\n\n"
        "Return the modified files JSON as instructed."
    )
    data = await complete_json(BUG_INJECTOR, user, temperature=0.5, max_tokens=6000)
    files = [CodeFile(**f) for f in data["files"]]
    return Codebase(
        artifact_kind=golden.artifact_kind,
        entry_point=golden.entry_point,
        setup_instructions=golden.setup_instructions,
        files=files,
    )
