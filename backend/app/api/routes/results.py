"""Results endpoints — evaluation, heatmap, and the full reviewer report."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents import report_analyst
from app.models.schemas import EvaluationResult, ReportAnalysis
from app.services.heatmap import Heatmap, build_heatmap
from app.services.report import ReportData, ReportPreviewData, build_report, build_report_preview
from app.store import store

router = APIRouter(prefix="/results", tags=["results"])


class ResultsOut(BaseModel):
    evaluation: EvaluationResult | None
    heatmap: Heatmap


class ReportAnalysisIn(BaseModel):
    force_refresh: bool = False


async def _load_report_context(session_id: str) -> tuple[ReportData, EvaluationResult | None]:
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
    report = build_report(
        session=session,
        assessment=assessment,
        events=events,
        buddy_history=buddy_history,
        feedback=feedback,
        evaluation=evaluation,
        heatmap=heatmap,
    )
    return report, evaluation


@router.get("/{session_id}", response_model=ResultsOut)
async def get_results(session_id: str) -> ResultsOut:
    if not await store.get_session(session_id):
        raise HTTPException(404, "session not found")
    events = await store.get_events(session_id)
    return ResultsOut(
        evaluation=await store.get_evaluation(session_id),
        heatmap=build_heatmap(events),
    )


@router.get("/{session_id}/report-preview")
async def get_report_preview(session_id: str) -> ReportPreviewData:
    report, _evaluation = await _load_report_context(session_id)
    return build_report_preview(report)


@router.get("/{session_id}/report")
async def get_report(session_id: str) -> ReportData:
    report, _evaluation = await _load_report_context(session_id)
    return report


@router.get("/{session_id}/report-analysis")
async def get_report_analysis(session_id: str) -> ReportAnalysis | None:
    if not await store.get_session(session_id):
        raise HTTPException(404, "session not found")
    return await store.get_report_analysis(session_id)


@router.post("/{session_id}/report-analysis")
async def generate_report_analysis(
    session_id: str,
    body: ReportAnalysisIn | None = None,
) -> ReportAnalysis:
    if not await store.get_session(session_id):
        raise HTTPException(404, "session not found")
    force_refresh = body.force_refresh if body else False
    cached = await store.get_report_analysis(session_id)
    if cached is not None and not force_refresh:
        return cached
    report, evaluation = await _load_report_context(session_id)
    analysis = await report_analyst.run(session_id, report, evaluation)
    await store.put_report_analysis(analysis)
    return analysis
