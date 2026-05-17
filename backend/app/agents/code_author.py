"""Agent B — Code Author. Produces the "golden" artifact."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import ArtifactKind, Codebase, CodeFile, ExtractedContext, JobSpec, RoleFamily
from app.prompts.library import CODE_AUTHOR

# Keep job spec compact — strip fields the code author doesn't need
_JOB_FIELDS = {"title", "role_family", "seniority", "industry", "must_have_skills",
               "nice_to_have_skills", "jd_text"}

# LLMs often echo role_family (e.g. "frontend") into artifact_kind — map those safely.
_ROLE_DEFAULT_ARTIFACT: dict[str, ArtifactKind] = {
    "backend": ArtifactKind.CODE,
    "frontend": ArtifactKind.CODE,
    "fullstack": ArtifactKind.CODE,
    "data": ArtifactKind.CODE,
    "qa": ArtifactKind.TEST_SUITE,
    "devops": ArtifactKind.PIPELINE,
    "pm": ArtifactKind.SPEC,
    "design": ArtifactKind.DESIGN_DOC,
}


def _resolve_artifact_kind(raw: object, role_family: RoleFamily) -> ArtifactKind:
    if isinstance(raw, str):
        key = raw.strip().lower()
        try:
            return ArtifactKind(key)
        except ValueError:
            if key in _ROLE_DEFAULT_ARTIFACT:
                return _ROLE_DEFAULT_ARTIFACT[key]
    return _ROLE_DEFAULT_ARTIFACT.get(role_family.value, ArtifactKind.CODE)

# max_tokens budget: 4000 leaves room for input prompt under 15k TPM (gemma2-9b-it)
_MAX_OUTPUT_TOKENS = 4000


async def run(job: JobSpec, context: ExtractedContext, review_feedback: str = "") -> Codebase:
    job_compact = {k: v for k, v in job.model_dump().items() if k in _JOB_FIELDS}
    reviewer_section = (
        "Reviewer feedback from a prior generation attempt:\n"
        f"{review_feedback.strip()}\n\n"
        if review_feedback.strip()
        else ""
    )
    user = (
        "Job spec:\n"
        f"{json.dumps(job_compact, indent=2, default=str)}\n\n"
        "Extracted context:\n"
        f"{json.dumps(context.model_dump(), indent=2, default=str)}\n\n"
        f"{reviewer_section}"
        "Produce the golden artifact JSON described in the system prompt."
    )
    data = await complete_json(CODE_AUTHOR, user, temperature=0.6, max_tokens=_MAX_OUTPUT_TOKENS)
    raw_files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(raw_files, list):
        raise ValueError("code author response missing 'files' array")

    files: list[CodeFile] = []
    for item in raw_files:
        parsed = CodeFile.from_llm(item) if isinstance(item, dict) else None
        if parsed and parsed.path:
            files.append(parsed)
    if not files:
        raise ValueError("code author returned no valid files")

    return Codebase(
        artifact_kind=_resolve_artifact_kind(data.get("artifact_kind"), job.role_family),
        entry_point=data.get("entry_point"),
        setup_instructions=data.get("setup_instructions", ""),
        files=files,
    )
