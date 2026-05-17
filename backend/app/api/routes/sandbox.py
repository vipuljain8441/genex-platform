"""Sandbox management: provision, sync, commit, diff, SQL runner."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import sandbox
from app.store import store

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class ProvisionOut(BaseModel):
    url: str
    session_id: str


class SyncOut(BaseModel):
    synced: int


class CommitOut(BaseModel):
    committed: bool
    session_id: str


class DiffOut(BaseModel):
    diff: str
    stat: str


class SQLIn(BaseModel):
    query: str


class SQLOut(BaseModel):
    columns: list[str]
    rows: list[dict]
    rowcount: int
    error: str | None


@router.post("/provision/{session_id}", response_model=ProvisionOut)
async def provision_sandbox(session_id: str) -> ProvisionOut:
    """Write session files to the sandbox volume, init git + SQL DB. Returns VS Code URL."""
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    url = await sandbox.provision(session_id, session.current_files)
    return ProvisionOut(url=url, session_id=session_id)


@router.post("/sync/{session_id}", response_model=SyncOut)
async def sync_sandbox(session_id: str) -> SyncOut:
    """Read candidate-edited files from the sandbox back into the session store."""
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    files = await sandbox.read_files(session_id)
    if files:
        session.current_files = files
        await store.put_session(session)
    return SyncOut(synced=len(files))


@router.post("/commit/{session_id}", response_model=CommitOut)
async def commit_sandbox(session_id: str, message: str = "") -> CommitOut:
    """Commit the current sandbox state as a git snapshot for change tracking."""
    committed = await sandbox.commit(session_id, message)
    return CommitOut(committed=committed, session_id=session_id)


@router.get("/diff/{session_id}", response_model=DiffOut)
async def get_diff(session_id: str) -> DiffOut:
    """Return full diff and stat from initial commit to current sandbox state."""
    full = await sandbox.diff(session_id)
    stat = await sandbox.diff_stat(session_id)
    return DiffOut(diff=full, stat=stat)


@router.post("/sql/{session_id}", response_model=SQLOut)
async def run_sql(session_id: str, body: SQLIn) -> SQLOut:
    """Execute a SQL query against the session's SQLite database."""
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    if not body.query.strip():
        raise HTTPException(400, "query cannot be empty")
    result = await sandbox.run_sql(session_id, body.query)
    return SQLOut(**result)


@router.delete("/destroy/{session_id}")
async def destroy_sandbox(session_id: str) -> dict[str, str]:
    """Remove the sandbox directory for a completed session."""
    await sandbox.destroy(session_id)
    return {"status": "destroyed"}
