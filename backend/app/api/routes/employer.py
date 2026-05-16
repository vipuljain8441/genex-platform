"""Employer-side endpoints: create an assessment, watch the pipeline live, invite candidates."""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.models.schemas import Assessment, Invite, JobSpec, PipelineStage
from app.services.email import invite_url as build_invite_url, send_invite_email
from app.services.orchestrator import build_assessment
from app.store.memory import store

log = logging.getLogger(__name__)
router = APIRouter(prefix="/employer", tags=["employer"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/assessments", response_model=Assessment)
async def create_assessment(job: JobSpec) -> Assessment:
    """Kick off the Phase-1 pipeline. The assessment is created and stored
    synchronously so the client can immediately fetch it. The pipeline runs in
    the background and updates the SAME assessment object."""
    assessment = Assessment(job=job)
    store.put_assessment(assessment)

    async def _run() -> None:
        try:
            await build_assessment(assessment)
        except Exception:
            log.exception("background pipeline failed for %s", assessment.id)

    asyncio.create_task(_run())
    return assessment


@router.get("/assessments", response_model=list[Assessment])
async def list_assessments() -> list[Assessment]:
    return store.list_assessments()


@router.get("/assessments/{assessment_id}", response_model=Assessment)
async def get_assessment(assessment_id: str) -> Assessment:
    a = store.get_assessment(assessment_id)
    if not a:
        raise HTTPException(404, "assessment not found")
    return a


@router.websocket("/assessments/{assessment_id}/stream")
async def stream_assessment(ws: WebSocket, assessment_id: str) -> None:
    await ws.accept()
    initial = store.get_assessment(assessment_id)
    if initial:
        await ws.send_text(initial.model_dump_json())
    try:
        async for update in store.subscribe_assessment(assessment_id):
            await ws.send_text(update.model_dump_json())
    except WebSocketDisconnect:
        return
    except Exception as e:
        log.warning("stream closed: %s", e)
        await ws.close()


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
    assessment = store.get_assessment(assessment_id)
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
        store.put_invite(inv)

    return [_to_out(i) for i in invites]


@router.get("/assessments/{assessment_id}/invites", response_model=list[InviteOut])
async def list_invites(assessment_id: str) -> list[InviteOut]:
    if not store.get_assessment(assessment_id):
        raise HTTPException(404, "assessment not found")
    return [_to_out(i) for i in store.list_invites_for_assessment(assessment_id)]
