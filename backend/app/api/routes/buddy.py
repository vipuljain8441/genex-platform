"""Buddy chat endpoint — hint-only Socratic tutor."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.agents import buddy as buddy_agent
from app.models.schemas import (
    ActivityEvent,
    BuddyRequest,
    BuddyResponse,
    BuddyTurn,
    EventKind,
)
from app.store import store

router = APIRouter(prefix="/buddy", tags=["buddy"])


@router.post("/ask", response_model=BuddyResponse)
async def ask_buddy(req: BuddyRequest) -> BuddyResponse:
    if not await store.get_session(req.session_id):
        raise HTTPException(404, "session not found")

    history = await store.get_buddy_history(req.session_id)
    enriched = BuddyRequest(**{**req.model_dump(), "history": history})

    await store.append_buddy_turn(
        req.session_id, BuddyTurn(role="user", content=req.question)
    )
    await store.append_event(
        ActivityEvent(
            session_id=req.session_id,
            kind=EventKind.BUDDY_QUERY,
            file_path=req.open_file,
            payload={"question_len": len(req.question)},
        )
    )

    response = await buddy_agent.run(enriched)

    await store.append_buddy_turn(
        req.session_id,
        BuddyTurn(role="buddy", content=response.hint, at=datetime.now(timezone.utc)),
    )
    await store.append_event(
        ActivityEvent(
            session_id=req.session_id,
            kind=EventKind.BUDDY_HINT,
            file_path=req.open_file,
            payload={"hint_level": response.hint_level, "blocked": response.blocked},
        )
    )
    return response


@router.get("/history/{session_id}", response_model=list[BuddyTurn])
async def history(session_id: str) -> list[BuddyTurn]:
    return await store.get_buddy_history(session_id)
