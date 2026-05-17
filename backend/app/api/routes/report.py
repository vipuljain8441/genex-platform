"""Reviewer report aliases — stable report contract + event stream."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import Assessment, CandidateSession, EvaluationResult
from app.services.heatmap import build_heatmap
from app.services.report import ReportData, build_report
from app.store import store

router = APIRouter(prefix="/report", tags=["report"])


class ReportEnvelope(BaseModel):
    session: CandidateSession
    assessment: Assessment
    evaluation: EvaluationResult | None
    shadow_event_count: int
    analytics: dict
    report: dict


@router.get("/{session_id}")
async def get_report_envelope(session_id: str) -> ReportEnvelope:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(404, "assessment not found")
    events = await store.get_events(session_id)
    buddy_history = await store.get_buddy_history(session_id)
    feedback = await store.list_feedback_for_session(session_id)
    evaluation = await store.get_evaluation(session_id)
    heatmap = build_heatmap(events)
    report: ReportData = build_report(
        session=session,
        assessment=assessment,
        events=events,
        buddy_history=buddy_history,
        feedback=feedback,
        evaluation=evaluation,
        heatmap=heatmap,
    )
    return ReportEnvelope(
        session=session,
        assessment=assessment,
        evaluation=evaluation,
        shadow_event_count=len(events),
        analytics=report["behaviour_analytics"],
        report=report,
    )


@router.get("/{session_id}/events")
async def get_report_events(session_id: str) -> list[dict]:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    events = await store.get_events(session_id)
    return [event.model_dump(mode="json") for event in events]
