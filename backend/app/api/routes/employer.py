"""Employer-side endpoints: create an assessment, watch the pipeline live, invite candidates."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.llm import complete_json
from app.models.schemas import Assessment, Invite, JobSpec, PipelineStage, RecruiterContext
from app.prompts.library import JD_ANALYST, JIRA_BACKLOG_ANALYST
from app.services.email import invite_url as build_invite_url, send_invite_email
from app.services.github import fetch_issues, fetch_repo_info, parse_github_url
from app.services.jira import fetch_jira_backlog
from app.services.orchestrator import build_assessment
from app.store import store

log = logging.getLogger(__name__)
router = APIRouter(prefix="/employer", tags=["employer"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_str_list(values: list[str] | None) -> list[str]:
    return [v.strip() for v in values or [] if v and v.strip()]


# ── Jira integration ─────────────────────────────────────────────────────────

class JiraAnalyzeIn(BaseModel):
    base_url: str
    user_email: str
    api_token: str
    project_key: str = ""
    jql: str = ""
    max_issues: int = 12
    title: str = ""
    jd_text: str = ""
    industry: str = ""
    role_family_hint: str = ""
    seniority_hint: str = "mid"


class JiraIssueOut(BaseModel):
    key: str
    title: str
    summary: str
    status: str
    issue_type: str
    priority: str
    labels: list[str]
    components: list[str]
    project: str
    updated: str


class JiraAnalysisOut(BaseModel):
    suggested_title: str
    suggested_role_family: str
    suggested_seniority: str
    suggested_industry: str
    problem_summary: str
    must_have_skills: list[str]
    nice_to_have_skills: list[str]
    generated_jd: str
    recruiter_context: RecruiterContext
    issues: list[JiraIssueOut]
    source_summary: str = ""


@router.post("/jira/analyze", response_model=JiraAnalysisOut)
async def analyze_jira_backlog(body: JiraAnalyzeIn) -> JiraAnalysisOut:
    """Fetch a Jira backlog slice and turn it into hiring input for the pipeline."""
    try:
        issues = await fetch_jira_backlog(
            body.base_url,
            body.user_email,
            body.api_token,
            project_key=body.project_key,
            jql=body.jql,
            max_issues=body.max_issues,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Jira API error: {e}")

    if not issues:
        raise HTTPException(400, "No Jira issues matched that request.")

    user = (
        "Employer intake draft:\n"
        f"{json.dumps({
            'title': body.title,
            'jd_text': body.jd_text,
            'industry': body.industry,
            'role_family_hint': body.role_family_hint,
            'seniority_hint': body.seniority_hint,
        }, indent=2)}\n\n"
        "Jira backlog slice:\n"
        f"{json.dumps(issues, indent=2)}\n\n"
        "Return the strict JSON described in the system prompt."
    )

    try:
        data = await complete_json(
            JIRA_BACKLOG_ANALYST,
            user,
            temperature=0.3,
            max_tokens=2500,
        )
    except Exception as e:
        raise HTTPException(502, f"Backlog analysis failed: {e}")

    recruiter_context = RecruiterContext(**(data.get("recruiter_context") or {}))
    suggested_title = (data.get("suggested_title") or body.title or "Software Engineer").strip()
    suggested_role_family = (data.get("suggested_role_family") or body.role_family_hint or "backend").strip()
    suggested_seniority = (data.get("suggested_seniority") or body.seniority_hint or "mid").strip()
    suggested_industry = (data.get("suggested_industry") or body.industry).strip()
    problem_summary = (data.get("problem_summary") or recruiter_context.domain_summary).strip()
    generated_jd = (data.get("generated_jd") or body.jd_text).strip()

    return JiraAnalysisOut(
        suggested_title=suggested_title,
        suggested_role_family=suggested_role_family,
        suggested_seniority=suggested_seniority,
        suggested_industry=suggested_industry,
        problem_summary=problem_summary,
        must_have_skills=_clean_str_list(data.get("must_have_skills")),
        nice_to_have_skills=_clean_str_list(data.get("nice_to_have_skills")),
        generated_jd=generated_jd,
        recruiter_context=recruiter_context,
        issues=[JiraIssueOut(**issue) for issue in issues],
        source_summary=f"Analyzed {len(issues)} Jira issues from the employer backlog.",
    )


# ── JD analysis ──────────────────────────────────────────────────────────────

class JDAnalyzeIn(BaseModel):
    jd_text: str


class JDAnalysisOut(BaseModel):
    suggested_title: str
    suggested_role_family: str
    suggested_seniority: str
    suggested_industry: str
    problem_summary: str
    must_have_skills: list[str]
    nice_to_have_skills: list[str]
    generated_jd: str
    recruiter_context: RecruiterContext


@router.post("/jd/analyze", response_model=JDAnalysisOut)
async def analyze_jd(body: JDAnalyzeIn) -> JDAnalysisOut:
    """Parse a raw job description and extract structured hiring data for the pipeline."""
    if not body.jd_text or len(body.jd_text.strip()) < 30:
        raise HTTPException(400, "Job description is too short to analyze.")

    user = (
        "Job description text:\n"
        f"{body.jd_text.strip()}\n\n"
        "Extract the structured hiring profile described in the system prompt. Return strict JSON only."
    )

    try:
        data = await complete_json(JD_ANALYST, user, temperature=0.3, max_tokens=2000)
    except Exception as e:
        raise HTTPException(502, f"JD analysis failed: {e}")

    recruiter_context = RecruiterContext(**(data.get("recruiter_context") or {}))
    return JDAnalysisOut(
        suggested_title=(data.get("suggested_title") or "Software Engineer").strip(),
        suggested_role_family=(data.get("suggested_role_family") or "backend").strip(),
        suggested_seniority=(data.get("suggested_seniority") or "mid").strip(),
        suggested_industry=(data.get("suggested_industry") or "").strip(),
        problem_summary=(data.get("problem_summary") or recruiter_context.domain_summary).strip(),
        must_have_skills=_clean_str_list(data.get("must_have_skills")),
        nice_to_have_skills=_clean_str_list(data.get("nice_to_have_skills")),
        generated_jd=(data.get("generated_jd") or body.jd_text).strip(),
        recruiter_context=recruiter_context,
    )


# ── GitHub integration ───────────────────────────────────────────────────────

class GitHubInfoOut(BaseModel):
    full_name: str
    description: str
    default_branch: str
    language: str
    topics: list[str]
    issues: list[dict]


class GitHubValidateIn(BaseModel):
    repo_url: str


@router.post("/github/info", response_model=GitHubInfoOut)
async def github_repo_info(body: GitHubValidateIn) -> GitHubInfoOut:
    """Validate a GitHub URL and return repo metadata + open issues."""
    try:
        owner, repo = parse_github_url(body.repo_url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    try:
        info, issues = await asyncio.gather(
            fetch_repo_info(owner, repo),
            fetch_issues(owner, repo),
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"GitHub API error: {e}")

    return GitHubInfoOut(
        full_name=info["full_name"],
        description=info["description"],
        default_branch=info["default_branch"],
        language=info["language"],
        topics=info["topics"],
        issues=issues,
    )


@router.post("/assessments", response_model=Assessment)
async def create_assessment(job: JobSpec) -> Assessment:
    """Kick off the Phase-1 pipeline. The assessment is created and stored
    synchronously so the client can immediately fetch it. The pipeline runs in
    the background and updates the SAME assessment object."""
    assessment = Assessment(job=job)
    await store.put_assessment(assessment)

    async def _run() -> None:
        try:
            await build_assessment(assessment)
        except Exception:
            log.exception("background pipeline failed for %s", assessment.id)

    asyncio.create_task(_run())
    return assessment


@router.get("/assessments", response_model=list[Assessment])
async def list_assessments() -> list[Assessment]:
    return await store.list_assessments()


@router.get("/assessments/{assessment_id}", response_model=Assessment)
async def get_assessment(assessment_id: str) -> Assessment:
    a = await store.get_assessment(assessment_id)
    if not a:
        raise HTTPException(404, "assessment not found")
    return a


@router.websocket("/assessments/{assessment_id}/stream")
async def stream_assessment(ws: WebSocket, assessment_id: str) -> None:
    await ws.accept()
    try:
        initial = await store.get_assessment(assessment_id)
        if initial:
            await ws.send_text(initial.model_dump_json())
        async for update in store.subscribe_assessment(assessment_id):
            await ws.send_text(update.model_dump_json())
    except WebSocketDisconnect:
        return
    except Exception as e:
        log.warning("stream closed: %s", e)
        try:
            await ws.close()
        except WebSocketDisconnect:
            return


# ── Invites ─────────────────────────────────────────────────────────────────

class CreateInvitesIn(BaseModel):
    emails: list[str]
    candidate_name: str = ""  # optional shared name (for single-candidate invites)


class InviteOut(BaseModel):
    id: str
    assessment_id: str
    candidate_email: str
    candidate_name: str
    token: str
    invite_url: str
    invited_at: datetime
    accepted_at: datetime | None
    status: str
    email_sent: bool
    email_error: str | None
    session_id: str | None


def _to_out(invite: Invite) -> InviteOut:
    return InviteOut(
        id=invite.id,
        assessment_id=invite.assessment_id,
        candidate_email=invite.candidate_email,
        candidate_name=invite.candidate_name,
        token=invite.token,
        invite_url=build_invite_url(invite),
        invited_at=invite.invited_at,
        accepted_at=invite.accepted_at,
        status=invite.status,
        email_sent=invite.email_sent,
        email_error=invite.email_error,
        session_id=invite.session_id,
    )


@router.post("/assessments/{assessment_id}/invites", response_model=list[InviteOut])
async def create_invites(assessment_id: str, body: CreateInvitesIn) -> list[InviteOut]:
    assessment = await store.get_assessment(assessment_id)
    if not assessment:
        raise HTTPException(404, "assessment not found")
    if assessment.status.stage != PipelineStage.READY:
        raise HTTPException(400, "assessment is not ready — wait for the pipeline to finish")

    # Dedupe + validate
    seen: set[str] = set()
    valid: list[str] = []
    invalid: list[str] = []
    for raw in body.emails:
        e = raw.strip().lower()
        if not e:
            continue
        if not _EMAIL_RE.match(e):
            invalid.append(e)
            continue
        if e in seen:
            continue
        seen.add(e)
        valid.append(e)

    if not valid:
        raise HTTPException(
            400,
            "no valid emails provided" + (f"; invalid: {invalid}" if invalid else ""),
        )

    # Create + send (in parallel). Email failure is non-fatal.
    invites: list[Invite] = [
        Invite(
            assessment_id=assessment_id,
            candidate_email=e,
            candidate_name=body.candidate_name.strip(),
        )
        for e in valid
    ]
    send_results = await asyncio.gather(
        *(send_invite_email(inv, assessment) for inv in invites),
        return_exceptions=True,
    )
    for inv, res in zip(invites, send_results):
        if isinstance(res, Exception):
            inv.email_sent = False
            inv.email_error = f"{type(res).__name__}: {res}"
        else:
            ok, err = res
            inv.email_sent = ok
            inv.email_error = err
        await store.put_invite(inv)

    return [_to_out(i) for i in invites]


@router.get("/assessments/{assessment_id}/invites", response_model=list[InviteOut])
async def list_invites(assessment_id: str) -> list[InviteOut]:
    if not await store.get_assessment(assessment_id):
        raise HTTPException(404, "assessment not found")
    invites = await store.list_invites_for_assessment(assessment_id)
    return [_to_out(i) for i in invites]
