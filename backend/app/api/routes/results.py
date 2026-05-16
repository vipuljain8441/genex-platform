"""Results endpoints — evaluation + heatmap."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import EvaluationResult
from app.services.heatmap import Heatmap, build_heatmap
from app.store.memory import store

router = APIRouter(prefix="/results", tags=["results"])


class ResultsOut(BaseModel):
    evaluation: EvaluationResult | None
    heatmap: Heatmap


@router.get("/{session_id}", response_model=ResultsOut)
async def get_results(session_id: str) -> ResultsOut:
    if not store.get_session(session_id):
        raise HTTPException(404, "session not found")
    return ResultsOut(
        evaluation=store.get_evaluation(session_id),
        heatmap=build_heatmap(store.get_events(session_id)),
    )
