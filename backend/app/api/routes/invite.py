"""Candidate-facing invite endpoints.

Flow:
1. Employer creates an invite via /api/employer/assessments/{aid}/invites (sends email).
2. Candidate clicks the link → frontend calls GET /api/invites/{token} to render the welcome page.
3. Candidate clicks "Start" → frontend calls POST /api/invites/{token}/accept which creates
   a CandidateSession and binds it to the invite.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import (
    ActivityEvent,
    CandidateSession,
    EventKind,
    PipelineStage,
)
from app.store import store

router = APIRouter(prefix="/invites", tags=["invites"])


class AssessmentMini(BaseModel):
    id: str
    title: str
    role_family: str
    duration_minutes: int
    ready: bool


class InviteView(BaseModel):
    token: str
    status: Literal["pending", "accepted", "expired"]
    candidate_email: str
    candidate_name: str
    session_id: str | None
    assessment: AssessmentMini


@router.get("/{token}", response_model=InviteView)
async def get_invite(token: str) -> InviteView:
    invite = await store.get_invite(token)
    if not invite:
        raise HTTPException(404, "invite not found")
    assessment = await store.get_assessment(invite.assessment_id)
    if not assessment:
        raise HTTPException(404, "assessment not found")
    return InviteView(
        token=invite.token,
        status=invite.status,
        candidate_email=invite.candidate_email,
        candidate_name=invite.candidate_name,
        session_id=invite.session_id,
        assessment=AssessmentMini(
            id=assessment.id,
            title=assessment.job.title,
            role_family=assessment.job.role_family.value,
            duration_minutes=assessment.job.duration_minutes,
            ready=assessment.status.stage == PipelineStage.READY,
        ),
    )


class AcceptIn(BaseModel):
    candidate_name: str = ""


class AcceptOut(BaseModel):
    session_id: str
    assessment_id: str


@router.post("/{token}/accept", response_model=AcceptOut)
async def accept_invite(token: str, body: AcceptIn) -> AcceptOut:
    invite = await store.get_invite(token)
    if not invite:
        raise HTTPException(404, "invite not found")
    assessment = await store.get_assessment(invite.assessment_id)
    if not assessment or not assessment.buggy_codebase:
        raise HTTPException(400, "assessment is not ready yet")

    # Idempotent — if the candidate already accepted, return the existing session.
    if invite.session_id and await store.get_session(invite.session_id):
        return AcceptOut(session_id=invite.session_id, assessment_id=assessment.id)

    name = (
        body.candidate_name.strip()
        or invite.candidate_name.strip()
        or invite.candidate_email.split("@")[0]
    )
    session = CandidateSession(
        assessment_id=assessment.id,
        candidate_name=name,
        current_files={f.path: f.content for f in assessment.buggy_codebase.files},
    )
    await store.put_session(session)
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.FILE_OPEN,
        file_path=assessment.buggy_codebase.entry_point or assessment.buggy_codebase.files[0].path,
    ))

    invite.accepted_at = datetime.now(timezone.utc)
    invite.session_id = session.id
    await store.put_invite(invite)

    return AcceptOut(session_id=session.id, assessment_id=assessment.id)
