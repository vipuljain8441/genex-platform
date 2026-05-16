"""Agent C — Ticket Author. Emits bug-injection brief + candidate-facing ticket."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import (
    BugInjectionBrief,
    CandidateTicket,
    Codebase,
    JobSpec,
)
from app.prompts.library import TICKET_AUTHOR

_MAX_FILE_CHARS = 800   # keep total input well under 15k TPM
_MAX_FILES = 6


def _compact_files(codebase: Codebase) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in codebase.files[:_MAX_FILES]
    ]


async def run(
    job: JobSpec, golden: Codebase
) -> tuple[BugInjectionBrief, CandidateTicket]:
    job_compact = {
        "title": job.title,
        "role_family": job.role_family,
        "seniority": job.seniority,
        "industry": job.industry,
        "must_have_skills": job.must_have_skills,
        "jd_text": job.jd_text[:300],
    }
    user = (
        "Job spec:\n"
        f"{json.dumps(job_compact, indent=2, default=str)}\n\n"
        "Golden artifact files (first 800 chars each):\n"
        f"{json.dumps(_compact_files(golden), indent=2)}\n\n"
        "Produce the JSON described in the system prompt."
    )
    data = await complete_json(TICKET_AUTHOR, user, temperature=0.6, max_tokens=2000)
    brief = BugInjectionBrief(**data["bug_brief"])
    ticket = CandidateTicket(**data["candidate_ticket"])
    return brief, ticket
