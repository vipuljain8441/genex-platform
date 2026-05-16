"""Jira Cloud integration for backlog-driven assessment seeding."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

_FIELDS = [
    "summary",
    "description",
    "labels",
    "components",
    "issuetype",
    "priority",
    "status",
    "project",
    "updated",
]


def normalize_jira_base_url(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    if not cleaned:
        raise ValueError("Jira site URL is required")
    if "://" not in cleaned:
        cleaned = f"https://{cleaned}"

    parsed = urlparse(cleaned)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Enter a valid Jira site URL, for example https://your-team.atlassian.net")

    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")


def _adf_to_text(value: Any) -> str:
    """Flatten Atlassian Document Format nodes into plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [_adf_to_text(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    if not isinstance(value, dict):
        return str(value).strip()

    node_type = value.get("type", "")
    content = value.get("content", [])

    if node_type == "text":
        return value.get("text", "")
    if node_type == "hardBreak":
        return "\n"
    if node_type == "mention":
        attrs = value.get("attrs") or {}
        return attrs.get("text") or attrs.get("displayName") or ""

    if node_type in {"paragraph", "heading"}:
        return "".join(_adf_to_text(item) for item in content).strip()
    if node_type in {"bulletList", "orderedList"}:
        lines = [_adf_to_text(item) for item in content]
        return "\n".join(line for line in lines if line).strip()
    if node_type == "listItem":
        text = "\n".join(_adf_to_text(item) for item in content).strip()
        return f"- {text}" if text else ""
    if node_type in {"codeBlock", "blockquote"}:
        return "\n".join(_adf_to_text(item) for item in content).strip()
    if node_type == "table":
        rows = [_adf_to_text(item) for item in content]
        return "\n".join(row for row in rows if row).strip()
    if node_type == "tableRow":
        cols = [_adf_to_text(item) for item in content]
        return " | ".join(col for col in cols if col).strip()
    if node_type in {"tableCell", "tableHeader"}:
        return " ".join(_adf_to_text(item) for item in content).strip()

    return "\n".join(_adf_to_text(item) for item in content).strip()


def _issue_digest(issue: dict[str, Any]) -> dict[str, Any]:
    fields = issue.get("fields") or {}
    summary = (fields.get("summary") or "").strip()
    description = _adf_to_text(fields.get("description"))
    components = [
        comp.get("name", "").strip()
        for comp in fields.get("components") or []
        if comp.get("name")
    ]
    labels = [label.strip() for label in fields.get("labels") or [] if label.strip()]
    issue_type = ((fields.get("issuetype") or {}).get("name") or "").strip()
    priority = ((fields.get("priority") or {}).get("name") or "").strip()
    status = ((fields.get("status") or {}).get("name") or "").strip()
    project = ((fields.get("project") or {}).get("key") or "").strip()

    summary_text = description or summary
    if len(summary_text) > 1600:
        summary_text = f"{summary_text[:1597]}..."

    return {
        "key": issue.get("key", ""),
        "title": summary,
        "summary": summary_text,
        "status": status,
        "issue_type": issue_type,
        "priority": priority,
        "labels": labels,
        "components": components,
        "project": project,
        "updated": fields.get("updated") or "",
    }


async def fetch_jira_backlog(
    base_url: str,
    user_email: str,
    api_token: str,
    *,
    project_key: str = "",
    jql: str = "",
    max_issues: int = 12,
) -> list[dict[str, Any]]:
    site = normalize_jira_base_url(base_url)
    email = user_email.strip()
    token = api_token.strip()
    if not email or not token:
        raise ValueError("Jira email and API token are required")

    query = jql.strip()
    if not query:
        project = project_key.strip().upper()
        if not project:
            raise ValueError("Provide either a Jira project key or a JQL query")
        query = f'project = "{project}" ORDER BY updated DESC'

    enhanced_payload = {
        "jql": query,
        "maxResults": max(1, min(max_issues, 25)),
        "fields": _FIELDS,
    }
    legacy_payload = {
        **enhanced_payload,
        "startAt": 0,
    }

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        resp = await client.post(
            f"{site}/rest/api/3/search/jql",
            auth=(email, token),
            headers=headers,
            json=enhanced_payload,
        )
        if resp.status_code in {404, 405, 410}:
            # Some tenants lag on the enhanced endpoint while others have
            # already removed the legacy endpoint. Try both to stay compatible.
            legacy = await client.post(
                f"{site}/rest/api/3/search",
                auth=(email, token),
                headers=headers,
                json=legacy_payload,
            )
            if legacy.is_success or legacy.status_code not in {404, 405}:
                resp = legacy

    if resp.status_code == 400:
        try:
            data = resp.json()
        except Exception:
            data = {}
        errors = data.get("errors") or {}
        error_pairs = [f"{k}: {v}" for k, v in errors.items() if v]
        details = "; ".join((data.get("errorMessages") or []) + error_pairs) or "Invalid JQL or Jira request."
        raise ValueError(details)
    if resp.status_code == 401:
        raise ValueError("Jira authentication failed. Check the site URL, email, and API token.")
    if resp.status_code == 403:
        raise ValueError("Authenticated with Jira, but this account cannot access the requested backlog.")
    if resp.status_code == 404:
        raise ValueError("Jira site/API path not found. Check the Jira site URL.")
    if resp.status_code == 410:
        raise ValueError(
            "This Jira site has removed the legacy issue-search endpoint. "
            "The app now expects the enhanced JQL search API; restart the backend and try again."
        )

    resp.raise_for_status()
    data = resp.json()

    issues = [_issue_digest(issue) for issue in data.get("issues") or []]
    return [issue for issue in issues if issue["title"] or issue["summary"]]
