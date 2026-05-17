"""Phase-1 orchestrator: runs the assessment generation pipeline.

For stability on local small-model setups, the live pipeline intentionally uses
the simpler path:
- GENERATED: Extractor -> CodeAuthor -> TicketAuthor -> LocalChallengeBuilder -> BugInjector
- GITHUB:    FetchRepo  -> StandardTicketAuthor -> LocalChallengeBuilder -> BugInjector

Reviewer and GitHub-specific ticketing agents remain available in the codebase
but are not part of the active flow right now.
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from app.agents import bug_injector, code_author, extractor, ticket_author
from app.models.schemas import (
    Assessment,
    AssessmentStatus,
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
    await store.put_assessment(a)
    source = a.job.codebase_source

    try:
        if source == CodebaseSource.GITHUB:
            await _run_github_pipeline(a)
        else:
            await _run_generated_pipeline(a)
        await _set_status(a, PipelineStage.READY, "Assessment ready")
    except Exception as exc:
        log.error("pipeline failed: %s\n%s", exc, traceback.format_exc())
        await _set_status(a, PipelineStage.FAILED, f"{type(exc).__name__}: {exc}")
        raise

    return a


async def _run_generated_pipeline(a: Assessment) -> None:
    job = a.job

    await _set_status(a, PipelineStage.EXTRACTING, "Reading job context")
    a.context = await extractor.run(job)
    log.info(
        "pipeline[%s]: extracted context tech_signals=%d sample_tickets=%d",
        a.id,
        len(a.context.tech_signals),
        len(a.context.sample_tickets),
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.AUTHORING, "Generating production-ready codebase")
    a.golden_codebase = await code_author.run(job, a.context)
    log.info(
        "pipeline[%s]: code author produced files=%d entry_point=%s",
        a.id,
        len(a.golden_codebase.files),
        a.golden_codebase.entry_point,
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Drafting candidate ticket & bug plan")
    brief, ticket = await ticket_author.run(job, a.context, a.golden_codebase)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    log.info(
        "pipeline[%s]: ticket author produced title=%r priority=%s defects=%d",
        a.id,
        a.candidate_ticket.title,
        a.candidate_ticket.priority,
        len(a.bug_brief.defects),
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.CHALLENGING, "Building candidate challenges")
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated=None)
    log.info("pipeline[%s]: local challenge plan produced challenges=%d", a.id, len(a.candidate_challenges))
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    try:
        a.buggy_codebase = await bug_injector.run(a.golden_codebase, brief)
    except Exception:
        log.exception("pipeline[%s]: bug injector failed — using golden codebase as fallback", a.id)
        a.buggy_codebase = a.golden_codebase
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
    a.context = ExtractedContext(
        sample_tickets=(
            [
                {
                    "key": f"GH-{gh.issue_number}",
                    "title": gh.issue_title,
                    "type": "feature",
                    "summary": (gh.issue_body or "")[:280],
                }
            ]
            if gh.issue_title
            else []
        ),
        tech_signals=job.must_have_skills + job.nice_to_have_skills,
        domain_summary=f"Codebase from github.com/{owner}/{repo}. {job.jd_text[:300]}",
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Creating candidate ticket from the fetched codebase")
    brief, ticket = await ticket_author.run(job, a.context, golden)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    log.info(
        "pipeline[%s]: github path ticket produced title=%r priority=%s defects=%d",
        a.id,
        a.candidate_ticket.title,
        a.candidate_ticket.priority,
        len(a.bug_brief.defects),
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.CHALLENGING, "Building candidate challenges")
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated=None)
    log.info("pipeline[%s]: github local challenge plan produced challenges=%d", a.id, len(a.candidate_challenges))
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    try:
        a.buggy_codebase = await bug_injector.run(golden, brief)
    except Exception:
        log.exception("pipeline[%s]: bug injector failed — using golden codebase as fallback", a.id)
        a.buggy_codebase = golden
    await store.put_assessment(a)
