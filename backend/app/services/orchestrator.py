"""Phase-1 orchestrator: runs the assessment generation pipeline.

Two paths:
- GENERATED: Extractor → CodeAuthor → TicketAuthor → BugInjector
- GITHUB: FetchRepo → GitHubTicketAuthor → BugInjector
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from app.agents import bug_injector, challenge_architect, code_author, extractor, ticket_author
from app.agents import github_ticket_author
from app.models.schemas import (
    Assessment,
    AssessmentStatus,
    Codebase,
    CodebaseSource,
    ExtractedContext,
    PipelineStage,
)
from app.services.challenges import build_candidate_challenges
from app.services.github import build_codebase_from_github, parse_github_url
from app.store import store

log = logging.getLogger(__name__)


async def _set_status(a: Assessment, stage: PipelineStage, detail: str = "") -> None:
    a.status = AssessmentStatus(
        stage=stage, detail=detail, updated_at=datetime.now(timezone.utc)
    )
    await store.put_assessment(a)


async def build_assessment(a: Assessment) -> Assessment:
    """Run the full Phase-1 pipeline on an existing Assessment."""
    await store.put_assessment(a)

    source = a.job.codebase_source

    try:
        if source == CodebaseSource.GITHUB:
            await _run_github_pipeline(a)
        else:
            await _run_generated_pipeline(a)

        await _set_status(a, PipelineStage.READY, "Assessment ready")
    except Exception as e:
        log.error("pipeline failed: %s\n%s", e, traceback.format_exc())
        await _set_status(a, PipelineStage.FAILED, f"{type(e).__name__}: {e}")
        raise

    return a


async def _run_generated_pipeline(a: Assessment) -> None:
    job = a.job

    await _set_status(a, PipelineStage.EXTRACTING, "Reading PM tool / recruiter context")
    a.context = await extractor.run(job)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.AUTHORING, "Generating production-ready codebase")
    a.golden_codebase = await code_author.run(job, a.context)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Drafting candidate ticket & bug plan")
    brief, ticket = await ticket_author.run(job, a.golden_codebase)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    await _set_status(a, PipelineStage.CHALLENGING, "Designing the multi-challenge assessment")
    try:
        generated_challenges = await challenge_architect.run(job, a.golden_codebase, brief, ticket)
    except Exception:
        generated_challenges = []
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated_challenges)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    a.buggy_codebase = await bug_injector.run(a.golden_codebase, brief)
    await store.put_assessment(a)


async def _run_github_pipeline(a: Assessment) -> None:
    job = a.job
    gh = job.github_source
    if not gh:
        raise ValueError("codebase_source=github but github_source is missing")

    await _set_status(a, PipelineStage.FETCHING, f"Fetching repo {gh.repo_url}")
    owner, repo = parse_github_url(gh.repo_url)
    golden = await build_codebase_from_github(owner, repo, gh.branch)
    a.golden_codebase = golden
    # Synthesise a minimal extracted context from the job spec so evaluator has signals
    a.context = ExtractedContext(
        sample_tickets=[],
        tech_signals=job.must_have_skills + job.nice_to_have_skills,
        domain_summary=f"Codebase from github.com/{owner}/{repo}. {job.jd_text[:300]}",
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Creating ticket from GitHub issue")
    brief, ticket = await github_ticket_author.run(job, golden, gh)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    await _set_status(a, PipelineStage.CHALLENGING, "Designing the multi-challenge assessment")
    try:
        generated_challenges = await challenge_architect.run(job, golden, brief, ticket)
    except Exception:
        generated_challenges = []
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated_challenges)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    a.buggy_codebase = await bug_injector.run(golden, brief)
    await store.put_assessment(a)
