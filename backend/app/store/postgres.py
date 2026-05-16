"""Postgres-backed store with in-process pub/sub for a single sandbox runtime.

This persists all core assessment state in Postgres while keeping lightweight
asyncio queues for live WebSocket updates within the current process.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any, AsyncIterator

import asyncpg

from app.models.schemas import (
    ActivityEvent,
    Assessment,
    BuddyTurn,
    CandidateSession,
    EvaluationResult,
    Invite,
)


def _dump(model: Any) -> str:
    return json.dumps(model.model_dump(mode="json"))


def _load(payload: Any) -> dict[str, Any]:
    if isinstance(payload, str):
        return json.loads(payload)
    return payload


class PostgresStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self._pool: asyncpg.Pool | None = None
        self._assessment_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._session_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def startup(self) -> None:
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=8)
        await self._init_schema()

    async def shutdown(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _require_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Postgres store not started")
        return self._pool

    async def _init_schema(self) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                create table if not exists assessments (
                    id text primary key,
                    created_at timestamptz not null,
                    data jsonb not null
                );

                create table if not exists sessions (
                    id text primary key,
                    assessment_id text not null,
                    started_at timestamptz not null,
                    data jsonb not null
                );
                create index if not exists sessions_assessment_idx
                    on sessions (assessment_id, started_at desc);

                create table if not exists events (
                    id text primary key,
                    session_id text not null,
                    kind text not null,
                    at timestamptz not null,
                    file_path text null,
                    data jsonb not null
                );
                create index if not exists events_session_at_idx
                    on events (session_id, at);

                create table if not exists buddy_turns (
                    session_id text not null,
                    at timestamptz not null,
                    data jsonb not null
                );
                create index if not exists buddy_turns_session_at_idx
                    on buddy_turns (session_id, at);

                create table if not exists evaluations (
                    session_id text primary key,
                    generated_at timestamptz not null,
                    data jsonb not null
                );

                create table if not exists invites (
                    token text primary key,
                    id text not null unique,
                    assessment_id text not null,
                    invited_at timestamptz not null,
                    data jsonb not null
                );
                create index if not exists invites_assessment_invited_idx
                    on invites (assessment_id, invited_at desc);
                """
            )

    # ── Assessments ───────────────────────────────────────────────────────
    async def put_assessment(self, assessment: Assessment) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into assessments (id, created_at, data)
                values ($1, $2, $3::jsonb)
                on conflict (id) do update set
                    created_at = excluded.created_at,
                    data = excluded.data
                """,
                assessment.id,
                assessment.created_at,
                _dump(assessment),
            )
        self._publish_assessment(assessment)

    async def get_assessment(self, assessment_id: str) -> Assessment | None:
        pool = self._require_pool()
        row = await pool.fetchrow(
            "select data from assessments where id = $1",
            assessment_id,
        )
        if row is None:
            return None
        return Assessment(**_load(row["data"]))

    async def list_assessments(self) -> list[Assessment]:
        pool = self._require_pool()
        rows = await pool.fetch(
            "select data from assessments order by created_at desc",
        )
        return [Assessment(**_load(row["data"])) for row in rows]

    # ── Sessions ──────────────────────────────────────────────────────────
    async def put_session(self, session: CandidateSession) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into sessions (id, assessment_id, started_at, data)
                values ($1, $2, $3, $4::jsonb)
                on conflict (id) do update set
                    assessment_id = excluded.assessment_id,
                    started_at = excluded.started_at,
                    data = excluded.data
                """,
                session.id,
                session.assessment_id,
                session.started_at,
                _dump(session),
            )

    async def get_session(self, session_id: str) -> CandidateSession | None:
        pool = self._require_pool()
        row = await pool.fetchrow(
            "select data from sessions where id = $1",
            session_id,
        )
        if row is None:
            return None
        return CandidateSession(**_load(row["data"]))

    # ── Events ────────────────────────────────────────────────────────────
    async def append_event(self, event: ActivityEvent) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into events (id, session_id, kind, at, file_path, data)
                values ($1, $2, $3, $4, $5, $6::jsonb)
                on conflict (id) do nothing
                """,
                event.id,
                event.session_id,
                event.kind.value,
                event.at,
                event.file_path,
                _dump(event),
            )
        self._publish_event(event)

    async def get_events(self, session_id: str) -> list[ActivityEvent]:
        pool = self._require_pool()
        rows = await pool.fetch(
            "select data from events where session_id = $1 order by at asc",
            session_id,
        )
        return [ActivityEvent(**_load(row["data"])) for row in rows]

    # ── Buddy ─────────────────────────────────────────────────────────────
    async def append_buddy_turn(self, session_id: str, turn: BuddyTurn) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into buddy_turns (session_id, at, data)
                values ($1, $2, $3::jsonb)
                """,
                session_id,
                turn.at,
                _dump(turn),
            )

    async def get_buddy_history(self, session_id: str) -> list[BuddyTurn]:
        pool = self._require_pool()
        rows = await pool.fetch(
            "select data from buddy_turns where session_id = $1 order by at asc",
            session_id,
        )
        return [BuddyTurn(**_load(row["data"])) for row in rows]

    # ── Evaluation ────────────────────────────────────────────────────────
    async def put_evaluation(self, result: EvaluationResult) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into evaluations (session_id, generated_at, data)
                values ($1, $2, $3::jsonb)
                on conflict (session_id) do update set
                    generated_at = excluded.generated_at,
                    data = excluded.data
                """,
                result.session_id,
                result.generated_at,
                _dump(result),
            )

    async def get_evaluation(self, session_id: str) -> EvaluationResult | None:
        pool = self._require_pool()
        row = await pool.fetchrow(
            "select data from evaluations where session_id = $1",
            session_id,
        )
        if row is None:
            return None
        return EvaluationResult(**_load(row["data"]))

    # ── Invites ───────────────────────────────────────────────────────────
    async def put_invite(self, invite: Invite) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into invites (token, id, assessment_id, invited_at, data)
                values ($1, $2, $3, $4, $5::jsonb)
                on conflict (token) do update set
                    id = excluded.id,
                    assessment_id = excluded.assessment_id,
                    invited_at = excluded.invited_at,
                    data = excluded.data
                """,
                invite.token,
                invite.id,
                invite.assessment_id,
                invite.invited_at,
                _dump(invite),
            )

    async def get_invite(self, token: str) -> Invite | None:
        pool = self._require_pool()
        row = await pool.fetchrow(
            "select data from invites where token = $1",
            token,
        )
        if row is None:
            return None
        return Invite(**_load(row["data"]))

    async def list_invites_for_assessment(self, assessment_id: str) -> list[Invite]:
        pool = self._require_pool()
        rows = await pool.fetch(
            """
            select data from invites
            where assessment_id = $1
            order by invited_at desc
            """,
            assessment_id,
        )
        return [Invite(**_load(row["data"])) for row in rows]

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
