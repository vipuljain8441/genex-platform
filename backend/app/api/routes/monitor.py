"""Activity-monitoring endpoints — capture every observation from the client."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.models.schemas import ActivityEvent, EventKind
from app.store import store
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["monitor"])


class EventIn(BaseModel):
    session_id: str
    kind: EventKind
    file_path: str | None = None
    payload: dict = Field(default_factory=dict)


class EventBatchIn(BaseModel):
    events: list[EventIn]


@router.post("/events", response_model=ActivityEvent)
async def record_event(body: EventIn) -> ActivityEvent:
    if not await store.get_session(body.session_id):
        raise HTTPException(404, "session not found")
    event = ActivityEvent(
        session_id=body.session_id,
        kind=body.kind,
        file_path=body.file_path,
        payload=body.payload,
    )
    await store.append_event(event)
    return event


@router.post("/events/batch", response_model=list[ActivityEvent])
async def record_events_batch(body: EventBatchIn) -> list[ActivityEvent]:
    if not body.events:
        return []

    out: list[ActivityEvent] = []
    seen_sessions: set[str] = set()
    for item in body.events:
        if item.session_id not in seen_sessions:
            if not await store.get_session(item.session_id):
                raise HTTPException(404, f"session not found: {item.session_id}")
            seen_sessions.add(item.session_id)
        event = ActivityEvent(
            session_id=item.session_id,
            kind=item.kind,
            file_path=item.file_path,
            payload=item.payload,
        )
        await store.append_event(event)
        out.append(event)
    return out


@router.get("/events/{session_id}", response_model=list[ActivityEvent])
async def list_events(session_id: str) -> list[ActivityEvent]:
    return await store.get_events(session_id)


@router.websocket("/sessions/{session_id}/stream")
async def stream(ws: WebSocket, session_id: str) -> None:
    """Live event stream — used by recruiter dashboards / observability."""
    await ws.accept()
    try:
        async for event in store.subscribe_session(session_id):
            await ws.send_text(event.model_dump_json())
    except WebSocketDisconnect:
        return
    except Exception as e:
        log.warning("monitor stream closed: %s", e)
        await ws.close()
