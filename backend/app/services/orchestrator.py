"""Phase-1 orchestrator: runs Extractor → CodeAuthor → TicketAuthor → BugInjector.

Operates on an EXISTING Assessment object (created and stored by the API route)
so the ID returned to the client and the ID the pipeline updates are the same.
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from app.agents import bug_injector, code_author, extractor, ticket_author
from app.models.schemas import Assessment, AssessmentStatus, PipelineStage
from app.store.memory import store

log = logging.getLogger(__name__)


def _set_status(a: Assessment, stage: PipelineStage, detail: str = "") -> None:
    a.status = AssessmentStatus(
        stage=stage, detail=detail, updated_at=datetime.now(timezone.utc)
    )
    store.put_assessment(a)


async def build_assessment(a: Assessment) -> Assessment:
    """Run the full Phase-1 pipeline on an existing Assessment."""
    store.put_assessment(a)
    job = a.job

    try:
        _set_status(a, PipelineStage.EXTRACTING, "Reading PM tool / recruiter context")
        a.context = await extractor.run(job)
        store.put_assessment(a)

        _set_status(a, PipelineStage.AUTHORING, "Writing the golden artifact")
        a.golden_codebase = await code_author.run(job, a.context)
        store.put_assessment(a)

        _set_status(a, PipelineStage.TICKETING, "Drafting candidate ticket")
        brief, ticket = await ticket_author.run(job, a.golden_codebase)
        a.bug_brief = brief
        a.candidate_ticket = ticket
        store.put_assessment(a)

        _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
        a.buggy_codebase = await bug_injector.run(a.golden_codebase, brief)
        store.put_assessment(a)

        _set_status(a, PipelineStage.READY, "Assessment ready")
    except Exception as e:
        log.error("pipeline failed: %s\n%s", e, traceback.format_exc())
        _set_status(a, PipelineStage.FAILED, f"{type(e).__name__}: {e}")
        raise

    return a
