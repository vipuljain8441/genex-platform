"""Sandbox management: provision, sync, commit, diff, SQL runner."""
from __future__ import annotations

from difflib import SequenceMatcher

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import ActivityEvent, EventKind
from app.services import sandbox
from app.store import store

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class ProvisionOut(BaseModel):
    url: str
    session_id: str


class SyncOut(BaseModel):
    synced: int
    changed_files: list[dict] = []


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


def _merge_changed_ranges(ranges: list[dict[str, int | str]]) -> list[dict[str, int | str]]:
    merged: list[dict[str, int | str]] = []
    for item in ranges:
        if not merged:
            merged.append(item)
            continue
        prev = merged[-1]
        prev_end = int(prev["end_line"])
        current_start = int(item["start_line"])
        if str(prev["change_type"]) == str(item["change_type"]) and current_start <= prev_end + 1:
            prev["end_line"] = max(prev_end, int(item["end_line"]))
            continue
        merged.append(item)
    return merged


def _summarize_line_diff(old_text: str, new_text: str) -> dict[str, object]:
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    matcher = SequenceMatcher(a=old_lines, b=new_lines)
    changed_ranges: list[dict[str, int | str]] = []
    added_lines = 0
    removed_lines = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag in {"replace", "insert"}:
            added_lines += max(j2 - j1, 0)
        if tag in {"replace", "delete"}:
            removed_lines += max(i2 - i1, 0)
        start_line = j1 + 1 if (j1 < len(new_lines) or j2 > j1) else max(len(new_lines), 1)
        end_line = max(j2, start_line)
        changed_ranges.append(
            {
                "start_line": start_line,
                "end_line": end_line,
                "change_type": tag,
            }
        )
    return {
        "added_lines": added_lines,
        "removed_lines": removed_lines,
        "changed_ranges": _merge_changed_ranges(changed_ranges),
        "previous_line_count": len(old_lines),
        "new_line_count": len(new_lines),
        "char_delta": len(new_text) - len(old_text),
    }


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
    changed_files: list[dict[str, object]] = []
    if files:
        previous_files = dict(session.current_files)
        for path in sorted(set(previous_files) | set(files)):
            old_text = previous_files.get(path, "")
            new_text = files.get(path, "")
            if old_text == new_text:
                continue
            diff_summary = _summarize_line_diff(old_text, new_text)
            changed_file = {
                "file_path": path,
                **diff_summary,
            }
            changed_files.append(changed_file)
            await store.append_event(
                ActivityEvent(
                    session_id=session.id,
                    kind=EventKind.CODE_SYNC,
                    file_path=path,
                    payload={
                        "source": "sandbox_sync",
                        **diff_summary,
                    },
                )
            )
        session.current_files = files
        await store.put_session(session)
    return SyncOut(synced=len(files), changed_files=changed_files)


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
