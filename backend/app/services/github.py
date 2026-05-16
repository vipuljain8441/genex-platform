"""GitHub public API integration — fetch repo files and issues for assessment seeding."""
from __future__ import annotations

import base64
import logging
import re
from typing import Any

import httpx

from app.models.schemas import ArtifactKind, Codebase, CodeFile

log = logging.getLogger(__name__)

_GITHUB_API = "https://api.github.com"
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "GenEx-Assessment-Platform/1.0",
}

# Extensions we recognise as code worth including in the codebase
_CODE_EXTS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".kt",
    ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".swift", ".scala",
    ".sh", ".bash", ".zsh", ".yaml", ".yml", ".toml", ".json",
    ".md", ".sql", ".graphql", ".proto",
}

# Paths to always skip
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist",
    "build", ".next", "vendor", "coverage", ".pytest_cache",
}

_MAX_FILES = 20
_MAX_FILE_BYTES = 30_000


def parse_github_url(url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL. Raises ValueError on bad input."""
    url = url.strip().rstrip("/")
    m = re.search(r"github\.com/([^/]+)/([^/?\s#]+)", url)
    if not m:
        raise ValueError(f"Not a recognisable GitHub URL: {url!r}")
    owner, repo = m.group(1), m.group(2)
    repo = repo.removesuffix(".git")
    return owner, repo


def _ext(path: str) -> str:
    dot = path.rfind(".")
    return path[dot:].lower() if dot != -1 else ""


def _is_code_file(path: str) -> bool:
    if _ext(path) not in _CODE_EXTS:
        return False
    parts = path.split("/")
    return not any(p in _SKIP_DIRS for p in parts)


async def _get(client: httpx.AsyncClient, path: str) -> Any:
    r = await client.get(f"{_GITHUB_API}{path}", headers=_HEADERS, timeout=15, follow_redirects=True)
    if r.status_code == 404:
        raise ValueError(f"GitHub resource not found: {path}")
    r.raise_for_status()
    return r.json()


async def fetch_repo_info(owner: str, repo: str) -> dict:
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/repos/{owner}/{repo}")
    return {
        "full_name": data.get("full_name", f"{owner}/{repo}"),
        "description": data.get("description") or "",
        "default_branch": data.get("default_branch", "main"),
        "language": data.get("language") or "",
        "topics": data.get("topics", []),
        "stargazers_count": data.get("stargazers_count", 0),
    }


async def fetch_issues(owner: str, repo: str, state: str = "open") -> list[dict]:
    """Return up to 30 issues (excluding pull requests)."""
    async with httpx.AsyncClient() as client:
        data = await _get(
            client,
            f"/repos/{owner}/{repo}/issues?state={state}&per_page=30&sort=updated",
        )
    return [
        {
            "number": i["number"],
            "title": i["title"],
            "body": (i.get("body") or "")[:1500],
            "labels": [lbl["name"] for lbl in i.get("labels", [])],
            "state": i["state"],
        }
        for i in data
        if not i.get("pull_request")  # exclude PRs
    ]


async def build_codebase_from_github(
    owner: str, repo: str, branch: str = "main"
) -> Codebase:
    """Fetch a public repo's tree and download code files to build a Codebase."""
    async with httpx.AsyncClient() as client:
        tree_data = await _get(
            client,
            f"/repos/{owner}/{repo}/git/trees/{branch}?recursive=1",
        )

    blobs = [
        item for item in tree_data.get("tree", [])
        if item.get("type") == "blob" and _is_code_file(item["path"])
        and (item.get("size") or 0) <= _MAX_FILE_BYTES
    ]

    # Prefer entry-point candidates and limit total files
    def _priority(path: str) -> int:
        name = path.split("/")[-1].lower()
        if name in {"readme.md", "main.py", "app.py", "index.ts", "index.js", "main.go"}:
            return 0
        if name.startswith("main") or name.startswith("app") or name.startswith("index"):
            return 1
        if "test" in name:
            return 3
        return 2

    blobs.sort(key=lambda b: (_priority(b["path"]), b["path"]))
    selected = blobs[:_MAX_FILES]

    files: list[CodeFile] = []
    async with httpx.AsyncClient() as client:
        for blob in selected:
            try:
                content_data = await _get(
                    client,
                    f"/repos/{owner}/{repo}/contents/{blob['path']}?ref={branch}",
                )
                raw = content_data.get("content", "")
                encoding = content_data.get("encoding", "base64")
                if encoding == "base64":
                    text = base64.b64decode(raw.replace("\n", "")).decode("utf-8", errors="replace")
                else:
                    text = raw
                lang = _detect_language(blob["path"])
                files.append(CodeFile(path=blob["path"], language=lang, content=text))
            except Exception as e:
                log.warning("Skipping %s: %s", blob["path"], e)

    if not files:
        raise ValueError(f"No code files found in {owner}/{repo}@{branch}")

    entry = _guess_entry(files)
    return Codebase(
        artifact_kind=ArtifactKind.CODE,
        entry_point=entry,
        files=files,
        setup_instructions=f"See README for setup. Fetched from github.com/{owner}/{repo}@{branch}.",
    )


def _guess_entry(files: list[CodeFile]) -> str | None:
    candidates = ["main.py", "app.py", "index.ts", "index.js", "main.go", "server.py"]
    for c in candidates:
        for f in files:
            if f.path.endswith(c) or f.path == c:
                return f.path
    return files[0].path if files else None


_LANG_MAP = {
    ".py": "python", ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".go": "go",
    ".rs": "rust", ".java": "java", ".kt": "kotlin",
    ".rb": "ruby", ".php": "php", ".cs": "csharp",
    ".cpp": "cpp", ".c": "c", ".h": "c",
    ".swift": "swift", ".scala": "scala",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".json": "json", ".sql": "sql",
    ".graphql": "graphql", ".proto": "protobuf",
    ".md": "markdown",
}


def _detect_language(path: str) -> str:
    return _LANG_MAP.get(_ext(path), "plaintext")
