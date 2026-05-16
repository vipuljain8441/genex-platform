"""Agent B — Code Author. Produces the "golden" artifact."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import ArtifactKind, Codebase, CodeFile, ExtractedContext, JobSpec
from app.prompts.library import CODE_AUTHOR

# Keep job spec compact — strip fields the code author doesn't need
_JOB_FIELDS = {"title", "role_family", "seniority", "industry", "must_have_skills",
               "nice_to_have_skills", "jd_text"}

# max_tokens budget: 4000 leaves room for input prompt under 15k TPM (gemma2-9b-it)
_MAX_OUTPUT_TOKENS = 4000


async def run(job: JobSpec, context: ExtractedContext) -> Codebase:
    job_compact = {k: v for k, v in job.model_dump().items() if k in _JOB_FIELDS}
    user = (
        "Job spec:\n"
        f"{json.dumps(job_compact, indent=2, default=str)}\n\n"
        "Extracted context:\n"
        f"{json.dumps(context.model_dump(), indent=2, default=str)}\n\n"
        "Produce the golden artifact JSON described in the system prompt."
    )
    data = await complete_json(CODE_AUTHOR, user, temperature=0.6, max_tokens=_MAX_OUTPUT_TOKENS)
    files = [CodeFile(**f) for f in data["files"]]
    return Codebase(
        artifact_kind=ArtifactKind(data.get("artifact_kind", "code")),
        entry_point=data.get("entry_point"),
        setup_instructions=data.get("setup_instructions", ""),
        files=files,
    )
