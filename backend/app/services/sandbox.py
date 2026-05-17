"""Sandbox session management — delegates all file I/O to the sync server
running inside the code-server container (port 8081).

The sync server owns the filesystem, git, and SQLite operations. The backend
only needs to speak HTTP to it.
"""
from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0)


def _sync_url(path: str) -> str:
    base = settings.sandbox_sync_url.rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def _is_connectivity_error(exc: Exception) -> bool:
    return isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout))


async def provision(session_id: str, files: dict[str, str]) -> str:
    """Write files into the sandbox and return the code-server workspace URL."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.put(
                _sync_url(f"sync/{session_id}"),
                json={"files": files},
            )
            resp.raise_for_status()
            data = resp.json()
            log.info("sandbox: provisioned %d files for %s", data.get("count", 0), session_id)
    except httpx.ConnectError as exc:
        sync_url = settings.sandbox_sync_url
        raise RuntimeError(
            f"Cannot reach sandbox sync server at {sync_url}. "
            "Run it locally with: "
            f"SESSIONS_ROOT={settings.sandbox_sessions_dir} "
            "python3 .devcontainer/sandbox-sync-server.py"
        ) from exc

    folder_path = f"{settings.resolved_vscode_root.rstrip('/')}/{session_id}"
    encoded_folder = quote(folder_path, safe="/")
    log.info("sandbox: opening code-server folder %s for %s", folder_path, session_id)
    return f"{settings.sandbox_url}/?folder={encoded_folder}"


async def read_files(session_id: str) -> dict[str, str]:
    """Return the current files in the sandbox session."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_sync_url(f"sync/{session_id}"))
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            return resp.json().get("files", {})
    except Exception as exc:
        if _is_connectivity_error(exc):
            log.warning(
                "sandbox: sync server unavailable during read for %s at %s",
                session_id,
                settings.sandbox_sync_url,
            )
            return {}
        raise


async def commit(session_id: str, message: str = "") -> bool:
    """Commit a snapshot of the current sandbox state. Returns True if changes found."""
    msg = message or "chore: candidate checkpoint"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _sync_url(f"commit/{session_id}"),
                json={"message": msg},
            )
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return resp.json().get("committed", False)
    except Exception as exc:
        if _is_connectivity_error(exc):
            log.warning(
                "sandbox: sync server unavailable during commit for %s at %s",
                session_id,
                settings.sandbox_sync_url,
            )
            return False
        raise


async def diff(session_id: str) -> str:
    """Return the full git diff from the initial commit to the current state."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_sync_url(f"diff/{session_id}"))
            if resp.status_code == 404:
                return ""
            resp.raise_for_status()
            return resp.json().get("diff", "")
    except Exception as exc:
        if _is_connectivity_error(exc):
            log.warning(
                "sandbox: sync server unavailable during diff for %s at %s",
                session_id,
                settings.sandbox_sync_url,
            )
            return ""
        raise


async def diff_stat(session_id: str) -> str:
    """Return a compact --stat diff for display."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_sync_url(f"diff/{session_id}"))
            if resp.status_code == 404:
                return "(session not found)"
            resp.raise_for_status()
            return resp.json().get("stat", "(no changes)")
    except Exception as exc:
        if _is_connectivity_error(exc):
            log.warning(
                "sandbox: sync server unavailable during diff-stat for %s at %s",
                session_id,
                settings.sandbox_sync_url,
            )
            return "(sandbox unavailable)"
        raise


async def run_sql(session_id: str, query: str) -> dict:
    """Execute SQL in the session's SQLite database and return rows/columns/error."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            _sync_url(f"sql/{session_id}"),
            json={"query": query},
        )
        resp.raise_for_status()
        return resp.json()


async def destroy(session_id: str) -> None:
    """Remove the sandbox session directory."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.delete(_sync_url(f"sync/{session_id}"))
            if resp.status_code not in (200, 404):
                resp.raise_for_status()
            log.info("sandbox: destroyed session %s", session_id)
    except Exception as exc:
        if _is_connectivity_error(exc):
            log.warning(
                "sandbox: sync server unavailable during destroy for %s at %s",
                session_id,
                settings.sandbox_sync_url,
            )
            return
        raise
