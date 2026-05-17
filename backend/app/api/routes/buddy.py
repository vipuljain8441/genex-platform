"""Buddy chat endpoint — hint-only Socratic tutor."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.agents import buddy as buddy_agent
from app.models.schemas import (
    ActivityEvent,
    BuddyEditTrace,
    BuddyRequest,
    BuddyResponse,
    BuddyTurn,
    ChallengeKind,
    EventKind,
)
from app.store import store

router = APIRouter(prefix="/buddy", tags=["buddy"])


@router.post("/ask", response_model=BuddyResponse)
async def ask_buddy(req: BuddyRequest) -> BuddyResponse:
    session = await store.get_session(req.session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(500, "assessment missing")

    challenge_id = req.challenge_id or session.current_challenge_id
    active_challenge = next(
        (challenge for challenge in assessment.candidate_challenges if challenge.id == challenge_id),
        None,
    )

    history = await store.get_buddy_history(req.session_id)
    session_events = await store.get_events(req.session_id)
    mode_override = (
        active_challenge.buddy_mode
        if active_challenge and getattr(active_challenge, "buddy_mode", None)
        else req.mode
    )
    enriched = BuddyRequest(
        **{**req.model_dump(), "history": history, "mode": mode_override}
    )

    await store.append_buddy_turn(
        req.session_id,
        BuddyTurn(
            role="user",
            content=req.question,
            challenge_id=challenge_id,
            open_file=req.open_file,
            selection=req.selection,
            metadata={
                "workspace_file_count": len(req.workspace or {}),
            },
        ),
    )
    await store.append_event(
        ActivityEvent(
            session_id=req.session_id,
            kind=EventKind.BUDDY_QUERY,
            file_path=req.open_file,
            payload={
                "question_len": len(req.question),
                "challenge_id": challenge_id,
                "challenge_kind": active_challenge.kind.value if active_challenge else "",
            },
        )
    )

    if active_challenge and active_challenge.kind in {ChallengeKind.THEORY, ChallengeKind.OBJECTIVE}:
        response = BuddyResponse(
            hint=(
                "Buddy is disabled for theoretical and objective challenges. "
                "These parts are meant to be answered independently, so please complete them on your own."
            ),
            hint_level="nudge",
            blocked=True,
            edits=[],
        )
        await store.append_buddy_turn(
            req.session_id,
            BuddyTurn(
                role="buddy",
                content=response.hint,
                at=datetime.now(timezone.utc),
                challenge_id=challenge_id,
                open_file=req.open_file,
                blocked=response.blocked,
                hint_level=response.hint_level,
                edits=[],
            ),
        )
        await store.append_event(
            ActivityEvent(
                session_id=req.session_id,
                kind=EventKind.BUDDY_HINT,
                file_path=req.open_file,
                payload={
                    "hint_level": response.hint_level,
                    "blocked": response.blocked,
                    "challenge_id": challenge_id,
                    "edit_count": 0,
                },
            )
        )
        return response

    response = await buddy_agent.run(
        enriched,
        active_challenge=active_challenge,
        session_events=session_events,
    )

    await store.append_buddy_turn(
        req.session_id,
        BuddyTurn(
            role="buddy",
            content=response.hint,
            at=datetime.now(timezone.utc),
            challenge_id=challenge_id,
            open_file=req.open_file,
            blocked=response.blocked,
            hint_level=response.hint_level,
            edits=[
                BuddyEditTrace(
                    file_path=edit.file_path,
                    rationale=edit.rationale,
                    new_content=edit.new_content,
                )
                for edit in response.edits
            ],
            metadata={
                "selection_length": len(req.selection or ""),
            },
        ),
    )
    await store.append_event(
        ActivityEvent(
            session_id=req.session_id,
            kind=EventKind.BUDDY_HINT,
            file_path=req.open_file,
            payload={
                "hint_level": response.hint_level,
                "blocked": response.blocked,
                "challenge_id": challenge_id,
                "edit_count": len(response.edits),
                "edit_targets": [edit.file_path for edit in response.edits],
            },
        )
    )
    return response


@router.get("/history/{session_id}", response_model=list[BuddyTurn])
async def history(session_id: str) -> list[BuddyTurn]:
    return await store.get_buddy_history(session_id)
