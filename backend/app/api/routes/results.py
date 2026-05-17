"""Results endpoints — evaluation, heatmap, and the full reviewer report."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import EvaluationResult
from app.services.heatmap import Heatmap, build_heatmap
from app.services.report import ReportData, build_report
from app.store import store

router = APIRouter(prefix="/results", tags=["results"])


class ResultsOut(BaseModel):
    evaluation: EvaluationResult | None
    heatmap: Heatmap


@router.get("/{session_id}", response_model=ResultsOut)
async def get_results(session_id: str) -> ResultsOut:
    if not await store.get_session(session_id):
        raise HTTPException(404, "session not found")
    events = await store.get_events(session_id)
    return ResultsOut(
        evaluation=await store.get_evaluation(session_id),
        heatmap=build_heatmap(events),
    )


@router.get("/{session_id}/report")
async def get_report(session_id: str) -> ReportData:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(404, "assessment not found")
    events = await store.get_events(session_id)
    buddy_history = await store.get_buddy_history(session_id)
    evaluation = await store.get_evaluation(session_id)
    heatmap = build_heatmap(events)
    return build_report(
        session=session,
        assessment=assessment,
        events=events,
        buddy_history=buddy_history,
        evaluation=evaluation,
        heatmap=heatmap,
    )
