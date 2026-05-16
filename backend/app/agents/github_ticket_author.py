"""Agent for GitHub path: adapt a real GitHub issue into an assessment ticket + bug brief."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import (
    BugInjectionBrief,
    CandidateTicket,
    Codebase,
    GitHubSource,
    JobSpec,
)
from app.prompts.library import GITHUB_TICKET_AUTHOR


async def run(
    job: JobSpec, golden: Codebase, gh: GitHubSource
) -> tuple[BugInjectionBrief, CandidateTicket]:
    issue_ctx = ""
    if gh.issue_number and gh.issue_title:
        issue_ctx = (
            f"GitHub Issue #{gh.issue_number}: {gh.issue_title}\n\n"
            f"{gh.issue_body or 'No description provided.'}"
        )
    else:
        issue_ctx = (
            "No specific issue was selected. Create an appropriate ticket "
            "based on the codebase and job spec."
        )

    file_summaries = [
        {"path": f.path, "language": f.language, "preview": f.content[:600]}
        for f in golden.files[:8]
    ]

    user = (
        "Job spec:\n"
        f"{json.dumps(job.model_dump(), indent=2, default=str)}\n\n"
        "GitHub Issue:\n"
        f"{issue_ctx}\n\n"
        "Codebase files (first 400 chars each):\n"
        f"{json.dumps(file_summaries, indent=2)}\n\n"
        "Produce the JSON described in the system prompt."
    )
    data = await complete_json(GITHUB_TICKET_AUTHOR, user, temperature=0.6, max_tokens=3000)
    brief = BugInjectionBrief(**data["bug_brief"])
    ticket = CandidateTicket(**data["candidate_ticket"])
    return brief, ticket
