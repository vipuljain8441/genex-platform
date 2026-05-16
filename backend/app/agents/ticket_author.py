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


async def run(
    job: JobSpec, golden: Codebase
) -> tuple[BugInjectionBrief, CandidateTicket]:
    user = (
        "Job spec:\n"
        f"{json.dumps(job.model_dump(), indent=2, default=str)}\n\n"
        "Golden artifact files:\n"
        f"{json.dumps([f.model_dump() for f in golden.files], indent=2)}\n\n"
        "Produce the JSON described in the system prompt."
    )
    data = await complete_json(TICKET_AUTHOR, user, temperature=0.6, max_tokens=3000)
    brief = BugInjectionBrief(**data["bug_brief"])
    ticket = CandidateTicket(**data["candidate_ticket"])
    return brief, ticket
