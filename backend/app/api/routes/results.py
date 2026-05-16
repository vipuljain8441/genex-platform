"""Results endpoints — evaluation + heatmap."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import EvaluationResult
from app.services.heatmap import Heatmap, build_heatmap
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
