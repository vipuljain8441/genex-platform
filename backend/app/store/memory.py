"""In-memory async store with a pub/sub channel for live updates.

Swap this for a Postgres-backed adapter by implementing the same surface.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import AsyncIterator

from app.models.schemas import (
    ActivityEvent,
    Assessment,
    BuddyTurn,
    CandidateSession,
    EvaluationResult,
    Invite,
)


class Store:
    def __init__(self) -> None:
        self.assessments: dict[str, Assessment] = {}
        self.sessions: dict[str, CandidateSession] = {}
        self.events: dict[str, list[ActivityEvent]] = defaultdict(list)
        self.buddy_history: dict[str, list[BuddyTurn]] = defaultdict(list)
        self.evaluations: dict[str, EvaluationResult] = {}
        self.invites: dict[str, Invite] = {}  # token → invite
        self.invites_by_assessment: dict[str, list[str]] = defaultdict(list)

        self._assessment_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._session_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)

    # ── Assessments ───────────────────────────────────────────────────────
    def put_assessment(self, assessment: Assessment) -> None:
        self.assessments[assessment.id] = assessment
        self._publish_assessment(assessment)

    def get_assessment(self, assessment_id: str) -> Assessment | None:
        return self.assessments.get(assessment_id)

    def list_assessments(self) -> list[Assessment]:
        return list(self.assessments.values())

    # ── Sessions ──────────────────────────────────────────────────────────
    def put_session(self, session: CandidateSession) -> None:
        self.sessions[session.id] = session

    def get_session(self, session_id: str) -> CandidateSession | None:
        return self.sessions.get(session_id)

    # ── Events ────────────────────────────────────────────────────────────
    def append_event(self, event: ActivityEvent) -> None:
        self.events[event.session_id].append(event)
        self._publish_event(event)

    def get_events(self, session_id: str) -> list[ActivityEvent]:
        return list(self.events.get(session_id, []))

    # ── Buddy ─────────────────────────────────────────────────────────────
    def append_buddy_turn(self, session_id: str, turn: BuddyTurn) -> None:
        self.buddy_history[session_id].append(turn)

    def get_buddy_history(self, session_id: str) -> list[BuddyTurn]:
        return list(self.buddy_history.get(session_id, []))

    # ── Evaluation ────────────────────────────────────────────────────────
    def put_evaluation(self, result: EvaluationResult) -> None:
        self.evaluations[result.session_id] = result

    def get_evaluation(self, session_id: str) -> EvaluationResult | None:
        return self.evaluations.get(session_id)

    # ── Invites ───────────────────────────────────────────────────────────
    def put_invite(self, invite: Invite) -> None:
        self.invites[invite.token] = invite
        if invite.token not in self.invites_by_assessment[invite.assessment_id]:
            self.invites_by_assessment[invite.assessment_id].append(invite.token)

    def get_invite(self, token: str) -> Invite | None:
        return self.invites.get(token)

    def list_invites_for_assessment(self, assessment_id: str) -> list[Invite]:
        return [
            self.invites[t]
            for t in self.invites_by_assessment.get(assessment_id, [])
            if t in self.invites
        ]

    # ── Pub/sub ───────────────────────────────────────────────────────────
    def _publish_assessment(self, assessment: Assessment) -> None:
        for q in list(self._assessment_subs.get(assessment.id, [])):
            q.put_nowait(assessment)

    def _publish_event(self, event: ActivityEvent) -> None:
        for q in list(self._session_subs.get(event.session_id, [])):
            q.put_nowait(event)

    async def subscribe_assessment(self, assessment_id: str) -> AsyncIterator[Assessment]:
        q: asyncio.Queue = asyncio.Queue()
        self._assessment_subs[assessment_id].append(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._assessment_subs[assessment_id].remove(q)

    async def subscribe_session(self, session_id: str) -> AsyncIterator[ActivityEvent]:
        q: asyncio.Queue = asyncio.Queue()
        self._session_subs[session_id].append(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._session_subs[session_id].remove(q)


store = Store()
