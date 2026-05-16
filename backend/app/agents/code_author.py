"""Agent B — Code Author. Produces the "golden" artifact."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import ArtifactKind, Codebase, CodeFile, ExtractedContext, JobSpec
from app.prompts.library import CODE_AUTHOR


async def run(job: JobSpec, context: ExtractedContext) -> Codebase:
    user = (
        "Job spec:\n"
        f"{json.dumps(job.model_dump(), indent=2, default=str)}\n\n"
        "Extracted context:\n"
        f"{json.dumps(context.model_dump(), indent=2, default=str)}\n\n"
        "Produce the golden artifact JSON described in the system prompt."
    )
    data = await complete_json(CODE_AUTHOR, user, temperature=0.6, max_tokens=6000)
    files = [CodeFile(**f) for f in data["files"]]
    return Codebase(
        artifact_kind=ArtifactKind(data.get("artifact_kind", "code")),
        entry_point=data.get("entry_point"),
        setup_instructions=data.get("setup_instructions", ""),
        files=files,
    )
