#!/usr/bin/env python3
"""
GenEx sandbox sync server.

Runs inside the code-server container on port 8081.
The GenEx backend (running anywhere) calls this API to:
  - Write session files    PUT  /sync/{session_id}
  - Read session files     GET  /sync/{session_id}
  - Delete session         DELETE /sync/{session_id}
  - Git commit snapshot    POST /commit/{session_id}
  - Git diff               GET  /diff/{session_id}
  - Run SQL query          POST /sql/{session_id}
  - Execute commands       POST /exec/{session_id}
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SESSIONS_ROOT = Path(os.getenv("SESSIONS_ROOT", "/home/coder/sessions"))
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".idea", ".venv", ".genex", ".genex-terminal"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
RUN_TIMEOUT_SECONDS = 10
RUN_OUTPUT_CAP = 8000

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Candidate",
    "GIT_AUTHOR_EMAIL": "candidate@genex.dev",
    "GIT_COMMITTER_NAME": "GenEx",
    "GIT_COMMITTER_EMAIL": "system@genex.dev",
}

VSCODE_SETTINGS = {
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 2000,
    "editor.fontSize": 14,
    "editor.minimap.enabled": False,
    "git.enableSmartCommit": True,
    "workbench.startupEditor": "none",
    "window.restoreWindows": "none",
}

WORKSPACE_TEMPLATE = {
    "folders": [{"path": "."}],
    "settings": {
        "workbench.startupEditor": "none",
        "files.autoSave": "afterDelay",
        "files.autoSaveDelay": 2000,
        "window.restoreWindows": "none",
    },
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _should_skip(rel: Path) -> bool:
    return any(p in SKIP_DIRS or p in SKIP_FILES for p in rel.parts)


def _safe_chmod(path: Path, mode: int) -> None:
    try:
        path.chmod(mode)
    except Exception:
        pass


def _ensure_tree_permissions(session_dir: Path) -> None:
    """Keep session roots editor-writable across local and Docker runs.

    Some deployments create session folders through a different user or an older
    container. VS Code then opens the folder successfully but cannot save files.
    We normalize permissions aggressively here so the candidate workspace stays
    writable even when the underlying host path was pre-created elsewhere.
    """
    if session_dir.exists():
        _safe_chmod(session_dir, 0o777)
    for child in session_dir.rglob("*"):
        if child.is_dir():
            _safe_chmod(child, 0o777)
        else:
            _safe_chmod(child, 0o666)


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True,
        env=GIT_ENV, timeout=10,
    )


def _detect_schema_file(files: dict[str, str]) -> str | None:
    for candidate in ("schema.sql", "setup.sql", "init.sql"):
        if candidate in files:
            return candidate
    return None


def _detect_seed_file(files: dict[str, str]) -> str | None:
    for candidate in ("seed.sql", "sample_data.sql", "fixtures.sql"):
        if candidate in files:
            return candidate
    return None


def _suggest_commands(files: dict[str, str]) -> list[str]:
    commands = [
        "pwd",
        "ls",
        "sqlite3 database.db '.tables'",
        "sqlite3 database.db 'SELECT name FROM sqlite_master WHERE type=\"table\";'",
    ]
    normalized = set(files)
    if "requirements.txt" in normalized:
        commands.append("pip install -r requirements.txt")
    if "package.json" in normalized:
        commands.extend(["npm install", "npm test"])
        package_text = files.get("package.json", "")
        if '"dev"' in package_text:
            commands.append("npm run dev")
        if '"build"' in package_text:
            commands.append("npm run build")
    for entrypoint in ("main.py", "app.py", "server.py"):
        if entrypoint in normalized:
            commands.append(f"python3 {entrypoint}")
            break
    for entrypoint in ("index.ts", "main.ts", "server.ts", "index.tsx", "main.tsx"):
        if entrypoint in normalized:
            commands.append(f"tsx {entrypoint}")
            break
    return commands[:8]


def _write_sandbox_guide(session_dir: Path, files: dict[str, str]) -> None:
    schema_file = _detect_schema_file(files)
    seed_file = _detect_seed_file(files)
    guide_dir = session_dir / ".genex"
    guide_dir.mkdir(parents=True, exist_ok=True)
    commands = _suggest_commands(files)
    schema_note = schema_file or "none"
    seed_note = seed_file or "none"
    guide = (
        "# GenEx Sandbox Guide\n\n"
        "This workspace is isolated to your assessment session.\n\n"
        "## What is available\n"
        "- VS Code editor inside the sandbox\n"
        "- Integrated terminal with Python, Node.js, TypeScript, Git, and SQLite\n"
        "- Session-local SQLite database at `database.db`\n"
        f"- Schema source: `{schema_note}`\n"
        f"- Seed source: `{seed_note}`\n\n"
        "## Useful commands\n"
        + "\n".join(f"- `{command}`" for command in commands)
        + "\n\n## Notes\n"
        "- Changes stay inside your assessment workspace.\n"
        "- Use the terminal to run code, inspect files, and query the SQLite database.\n"
        "- If a schema file exists, the database is created automatically when the sandbox starts.\n"
    )
    (guide_dir / "SANDBOX.md").write_text(guide, encoding="utf-8")
    (guide_dir / "manifest.json").write_text(
        json.dumps(
            {
                "workspace_root": str(session_dir),
                "database": {
                    "engine": "sqlite",
                    "path": "database.db",
                    "schema_file": schema_file,
                    "seed_file": seed_file,
                },
                "commands": commands,
                "guide_path": ".genex/SANDBOX.md",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _ensure_sqlite_database(session_dir: Path, files: dict[str, str]) -> None:
    db_path = session_dir / "database.db"
    schema_file = _detect_schema_file(files)
    seed_file = _detect_seed_file(files)
    created = False
    if not db_path.exists():
        sqlite3.connect(str(db_path)).close()
        created = True
    if not created:
        return
    try:
        conn = sqlite3.connect(str(db_path))
        if schema_file:
            conn.executescript(files[schema_file])
        if seed_file:
            conn.executescript(files[seed_file])
        conn.commit()
        conn.close()
        print(f"[sync] SQLite database ready for {session_dir.name}")
    except sqlite3.Error as exc:
        print(f"[sync] SQL init error: {exc}")


def _write_files(session_dir: Path, files: dict[str, str]) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    _safe_chmod(session_dir, 0o777)

    for rel_path, content in files.items():
        fp = session_dir / rel_path.lstrip("/")
        fp.parent.mkdir(parents=True, exist_ok=True)
        _safe_chmod(fp.parent, 0o777)
        try:
            fp.write_text(content, encoding="utf-8")
            _safe_chmod(fp, 0o666)
        except Exception as exc:
            print(f"[sync] write error {rel_path}: {exc}")

    # .vscode/settings.json
    vscode_dir = session_dir / ".vscode"
    vscode_dir.mkdir(exist_ok=True)
    settings_path = vscode_dir / "settings.json"
    if not settings_path.exists():
        settings_path.write_text(json.dumps(VSCODE_SETTINGS, indent=2))

    # .genex.code-workspace (locks VS Code to this folder)
    ws_file = session_dir / ".genex.code-workspace"
    if not ws_file.exists():
        ws_file.write_text(json.dumps(WORKSPACE_TEMPLATE, indent=2))

    _ensure_sqlite_database(session_dir, files)
    _write_sandbox_guide(session_dir, files)

    # Git init + initial commit
    if not (session_dir / ".git").exists():
        _git(["init", "--initial-branch=main"], session_dir)
        _git(["add", "-A"], session_dir)
        _git(["commit", "-m", "chore: initial assessment state", "--allow-empty"], session_dir)
        print(f"[sync] git repo initialized for {session_dir.name}")

    _ensure_tree_permissions(session_dir)


def _read_files(session_dir: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for fp in session_dir.rglob("*"):
        if not fp.is_file():
            continue
        rel = fp.relative_to(session_dir)
        if _should_skip(rel):
            continue
        try:
            result[str(rel)] = fp.read_text(encoding="utf-8")
        except Exception:
            pass
    return result


def _commit_snapshot(session_dir: Path, message: str) -> bool:
    status = _git(["status", "--porcelain"], session_dir)
    if not status.stdout.strip():
        return False
    _git(["add", "-A"], session_dir)
    result = _git(["commit", "-m", message], session_dir)
    return result.returncode == 0


def _get_diff(session_dir: Path) -> tuple[str, str]:
    try:
        _git(["add", "-A"], session_dir)
        first = _git(["rev-list", "--max-parents=0", "HEAD"], session_dir).stdout.strip()
        if not first:
            _git(["reset", "HEAD"], session_dir)
            return "", "(no commits)"
        diff_out = _git(["diff", "--cached", first], session_dir).stdout[:40_000]
        stat_out = _git(["diff", "--stat", "--cached", first], session_dir).stdout
        _git(["reset", "HEAD"], session_dir)
        return diff_out, stat_out or "(no changes)"
    except Exception as exc:
        return "", f"(diff unavailable: {exc})"


def _run_sql(session_dir: Path, query: str) -> dict:
    db_path = session_dir / "database.db"
    if not db_path.exists():
        sqlite3.connect(str(db_path)).close()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(query.strip())
        conn.commit()
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = [dict(r) for r in cur.fetchmany(500)]
            return {"columns": cols, "rows": rows, "rowcount": len(rows), "error": None}
        return {"columns": [], "rows": [], "rowcount": cur.rowcount, "error": None}
    except sqlite3.Error as exc:
        return {"columns": [], "rows": [], "rowcount": 0, "error": str(exc)}
    finally:
        conn.close()


def _command_env(session_dir: Path) -> dict[str, str]:
    return {
        **os.environ,
        "HOME": str(session_dir),
        "GENEX_SESSION_ROOT": str(session_dir),
        "GENEX_SESSION_ID": session_dir.name,
        "PYTHONUNBUFFERED": "1",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    }


def _run_command(
    session_dir: Path,
    argv: list[str],
    *,
    command: str = "",
    timeout_seconds: int = RUN_TIMEOUT_SECONDS,
    output_cap: int = RUN_OUTPUT_CAP,
) -> dict[str, object]:
    cleaned = [str(part) for part in argv if str(part).strip()]
    display_command = command.strip() or " ".join(cleaned)
    if not cleaned:
        return {
            "stdout": "",
            "stderr": "No command provided.",
            "exit_code": -1,
            "duration_ms": 0,
            "command": display_command,
            "timed_out": False,
            "unsupported": True,
        }

    env = _command_env(session_dir)
    if shutil.which(cleaned[0], path=env.get("PATH")) is None:
        return {
            "stdout": "",
            "stderr": f"Runtime '{cleaned[0]}' not found on PATH.",
            "exit_code": -1,
            "duration_ms": 0,
            "command": display_command,
            "timed_out": False,
            "unsupported": True,
        }

    started = time.monotonic()
    try:
        proc = subprocess.run(
            cleaned,
            cwd=session_dir,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env=env,
        )
        stdout = proc.stdout
        stderr = proc.stderr
        exit_code = proc.returncode
        timed_out = False
        unsupported = False
    except FileNotFoundError as exc:
        stdout = ""
        stderr = f"Failed to start runtime: {exc}"
        exit_code = -1
        timed_out = False
        unsupported = True
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"")
        stderr = (exc.stderr or b"")
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        stderr = f"{stderr}\n--- timed out after {timeout_seconds}s ---\n".strip()
        exit_code = -1
        timed_out = True
        unsupported = False

    duration_ms = int((time.monotonic() - started) * 1000)
    return {
        "stdout": str(stdout)[:output_cap],
        "stderr": str(stderr)[:output_cap],
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "command": display_command,
        "timed_out": timed_out,
        "unsupported": unsupported,
    }


# ── HTTP handler ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _ok(self, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code: int, msg: str) -> None:
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parts(self) -> list[str]:
        return self.path.strip("/").split("/", 2)

    # PUT /sync/{session_id}
    def do_PUT(self) -> None:
        parts = self._parts()
        if len(parts) < 2 or parts[0] != "sync":
            self._err(400, "bad path"); return
        session_id = parts[1]
        body = self._body()
        files = body.get("files", {})
        sd = SESSIONS_ROOT / session_id
        try:
            _write_files(sd, files)
            print(f"[sync] provisioned {len(files)} files for {session_id}")
            self._ok({"ok": True, "count": len(files), "session_id": session_id})
        except Exception as exc:
            self._err(500, str(exc))

    # GET /sync/{session_id}   or   GET /diff/{session_id}   or   GET /health
    def do_GET(self) -> None:
        parts = self._parts()
        if parts and parts[0] == "health":
            self._ok({"status": "ok", "sessions": len(list(SESSIONS_ROOT.iterdir())) if SESSIONS_ROOT.exists() else 0})
            return
        if len(parts) < 2:
            self._err(400, "bad path"); return
        op, session_id = parts[0], parts[1]
        sd = SESSIONS_ROOT / session_id

        if op == "sync":
            if not sd.exists():
                self._err(404, "session not found"); return
            self._ok({"files": _read_files(sd), "session_id": session_id})

        elif op == "diff":
            if not sd.exists():
                self._err(404, "session not found"); return
            full, stat = _get_diff(sd)
            self._ok({"diff": full, "stat": stat})

        elif op == "health":
            self._ok({"status": "ok", "sessions": len(list(SESSIONS_ROOT.iterdir())) if SESSIONS_ROOT.exists() else 0})

        else:
            self._err(404, "not found")

    # POST /commit/{session_id}   or   POST /sql/{session_id}   or   POST /exec/{session_id}
    def do_POST(self) -> None:
        parts = self._parts()
        if len(parts) < 2:
            self._err(400, "bad path"); return
        op, session_id = parts[0], parts[1]
        sd = SESSIONS_ROOT / session_id
        body = self._body()

        if op == "commit":
            if not sd.exists():
                self._err(404, "session not found"); return
            msg = body.get("message", "chore: candidate checkpoint")
            committed = _commit_snapshot(sd, msg)
            self._ok({"committed": committed, "session_id": session_id})

        elif op == "sql":
            if not sd.exists():
                self._err(404, "session not found"); return
            query = body.get("query", "")
            if not query.strip():
                self._err(400, "empty query"); return
            self._ok(_run_sql(sd, query))

        elif op == "exec":
            if not sd.exists():
                self._err(404, "session not found"); return
            argv = body.get("argv", [])
            if not isinstance(argv, list):
                self._err(400, "argv must be a list"); return
            command = str(body.get("command", "") or "")
            timeout_seconds = int(body.get("timeout_seconds", RUN_TIMEOUT_SECONDS) or RUN_TIMEOUT_SECONDS)
            output_cap = int(body.get("output_cap", RUN_OUTPUT_CAP) or RUN_OUTPUT_CAP)
            self._ok(
                _run_command(
                    sd,
                    [str(part) for part in argv],
                    command=command,
                    timeout_seconds=max(1, timeout_seconds),
                    output_cap=max(256, output_cap),
                )
            )

        else:
            self._err(404, "not found")

    # DELETE /sync/{session_id}
    def do_DELETE(self) -> None:
        parts = self._parts()
        if len(parts) < 2 or parts[0] != "sync":
            self._err(400, "bad path"); return
        session_id = parts[1]
        sd = SESSIONS_ROOT / session_id
        if sd.exists():
            shutil.rmtree(str(sd), ignore_errors=True)
        self._ok({"destroyed": True, "session_id": session_id})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[sync] {self.address_string()} - {fmt % args}")


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    _safe_chmod(SESSIONS_ROOT, 0o777)
    port = int(os.getenv("SYNC_PORT", "8081"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"[sync] GenEx sandbox sync server on :{port}")
    print(f"[sync] sessions root: {SESSIONS_ROOT}")
    server.serve_forever()
