"""Agent B — Code Author.

Produces a production-ready golden codebase. If the active LLM under-generates
or returns a clearly unusable artifact, we fall back to a local role-aware
scaffold so the rest of the assessment pipeline still has a solid base.
"""
from __future__ import annotations

import json
import logging
import re

from app.core.llm import complete_json
from app.models.schemas import ArtifactKind, Codebase, CodeFile, ExtractedContext, JobSpec, RoleFamily
from app.prompts.library import CODE_AUTHOR

log = logging.getLogger(__name__)

_JOB_FIELDS = {
    "title", "role_family", "seniority", "industry",
    "must_have_skills", "nice_to_have_skills", "jd_text",
}
_MAX_OUTPUT_TOKENS = 6000
_MIN_FILES_BY_SENIORITY = {
    "junior": 5,
    "mid": 6,
    "senior": 7,
    "staff": 8,
}


def _guess_entry_point(files: list[CodeFile]) -> str | None:
    if not files:
        return None
    preferred = ("main.py", "app.py", "index.ts", "index.js", "server.py", "main.go")
    for name in preferred:
        for file in files:
            if file.path.endswith(name):
                return file.path
    for file in files:
        if not (file.path.endswith(".md") or "test" in file.path.lower()):
            return file.path
    return files[0].path


def _parse_files(raw_files: list) -> list[CodeFile]:
    out: list[CodeFile] = []
    for entry in raw_files or []:
        if not isinstance(entry, dict):
            continue
        if "path" not in entry or "content" not in entry:
            continue
        entry = {**entry, "language": entry.get("language", "plaintext")}
        try:
            out.append(CodeFile(**entry))
        except Exception as exc:
            log.warning("code_author: skipping invalid file %r: %s", entry.get("path"), exc)
    return out


def _slug(text: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return cleaned or fallback


def _domain_terms(job: JobSpec, context: ExtractedContext) -> tuple[str, str, str]:
    text = " ".join(
        [
            job.title,
            job.industry,
            job.jd_text,
            context.domain_summary,
            " ".join(context.tech_signals),
        ]
    ).lower()
    if any(token in text for token in ("patient", "clinical", "care", "health")):
        return "care operations", "appointment", "appointments"
    if any(token in text for token in ("ledger", "bank", "risk", "trade", "fintech", "finance")):
        return "financial operations", "ledger entry", "ledger entries"
    if any(token in text for token in ("deploy", "incident", "pipeline", "platform", "infra")):
        return "platform delivery", "deployment", "deployments"
    if any(token in text for token in ("warehouse", "analytics", "dataset", "etl", "report")):
        return "data operations", "job run", "job runs"
    if any(token in text for token in ("catalog", "inventory", "checkout", "commerce")):
        return "commerce operations", "catalog item", "catalog items"
    return "product operations", "work item", "work items"


def _readme(job: JobSpec, context: ExtractedContext, run_steps: str, file_map: list[str]) -> str:
    domain_label, singular, _ = _domain_terms(job, context)
    return (
        f"# {job.title} Assessment Service\n\n"
        f"This scaffold models a realistic slice of {domain_label} work. "
        f"It manages {singular}s with validation, business rules, and a small but testable module layout.\n\n"
        "## Key modules\n"
        + "\n".join(f"- `{path}`" for path in file_map)
        + "\n\n## Local run\n"
        f"{run_steps}\n"
        "\n## Notes\n"
        "- The codebase is intentionally structured like an inherited team project.\n"
        "- Business rules live outside transport/UI files so assessment tasks can span multiple layers.\n"
    )


def _find_file(files: list[CodeFile], path: str) -> CodeFile | None:
    target = path.lower()
    for file in files:
        if file.path.lower() == target:
            return file
    return None


def _upsert_file(files: list[CodeFile], path: str, language: str, content: str) -> None:
    existing = _find_file(files, path)
    if existing:
        existing.language = language
        existing.content = content
        return
    files.append(CodeFile(path=path, language=language, content=content))


def _has_suffix(files: list[CodeFile], *suffixes: str) -> bool:
    lowered = tuple(suffix.lower() for suffix in suffixes)
    return any(file.path.lower().endswith(lowered) for file in files)


def _has_prefix(files: list[CodeFile], prefix: str) -> bool:
    target = prefix.lower()
    return any(file.path.lower().startswith(target) for file in files)


def _python_requirements(job: JobSpec, files: list[CodeFile]) -> str:
    role = job.role_family.value if hasattr(job.role_family, "value") else str(job.role_family)
    requirements = ["pytest"]
    file_text = "\n".join(file.content.lower() for file in files[:12])
    if role in {"backend", "qa"} or "fastapi" in file_text:
        requirements = ["fastapi", "uvicorn", "pytest", "httpx"]
    elif "pandas" in file_text:
        requirements = ["pandas", "pytest"]
    elif "numpy" in file_text:
        requirements = ["numpy", "pytest"]
    return "\n".join(dict.fromkeys(requirements)) + "\n"


def _frontend_package_json(job: JobSpec, *, fullstack: bool) -> str:
    title = _slug(job.title, "assessment-app")
    scripts = (
        '    "dev": "concurrently \\"npm run dev:api\\" \\"npm run dev:web\\"",\n'
        '    "dev:api": "tsx watch backend/server.ts",\n'
        '    "dev:web": "vite --config vite.config.ts --host 0.0.0.0 --port 3000",\n'
        '    "build": "vite build --config vite.config.ts",\n'
        '    "test": "vitest run"\n'
        if fullstack
        else '    "dev": "vite --host 0.0.0.0 --port 3000",\n'
             '    "build": "vite build",\n'
             '    "test": "vitest run"\n'
    )
    dependencies = (
        '    "express": "^4.21.2",\n'
        '    "react": "^18.3.1",\n'
        '    "react-dom": "^18.3.1"\n'
        if fullstack
        else '    "react": "^18.3.1",\n'
             '    "react-dom": "^18.3.1"\n'
    )
    dev_dependencies = (
        '    "@types/express": "^5.0.3",\n'
        '    "@types/node": "^22.15.30",\n'
        '    "@types/react": "^18.3.12",\n'
        '    "@types/react-dom": "^18.3.1",\n'
        '    "@vitejs/plugin-react": "^4.3.4",\n'
        '    "concurrently": "^9.1.2",\n'
        '    "tsx": "^4.19.4",\n'
        '    "typescript": "^5.8.3",\n'
        '    "vite": "^5.4.10",\n'
        '    "vitest": "^2.1.8"\n'
        if fullstack
        else '    "@types/react": "^18.3.12",\n'
             '    "@types/react-dom": "^18.3.1",\n'
             '    "@vitejs/plugin-react": "^4.3.4",\n'
             '    "jsdom": "^25.0.1",\n'
             '    "typescript": "^5.8.3",\n'
             '    "vite": "^5.4.10",\n'
             '    "vitest": "^2.1.8"\n'
    )
    return (
        "{\n"
        f'  "name": "{title}",\n'
        '  "private": true,\n'
        '  "version": "0.1.0",\n'
        '  "type": "module",\n'
        '  "scripts": {\n'
        f"{scripts}"
        "  },\n"
        '  "dependencies": {\n'
        f"{dependencies}"
        "  },\n"
        '  "devDependencies": {\n'
        f"{dev_dependencies}"
        "  }\n"
        "}\n"
    )


def _typescript_tsconfig(fullstack: bool) -> str:
    include = '["src", "tests", "vite.config.ts"]' if not fullstack else '["backend", "frontend/src", "shared", "tests", "vite.config.ts"]'
    return (
        "{\n"
        '  "compilerOptions": {\n'
        '    "target": "ES2020",\n'
        '    "useDefineForClassFields": true,\n'
        '    "lib": ["ES2020", "DOM", "DOM.Iterable"],\n'
        '    "module": "ESNext",\n'
        '    "skipLibCheck": true,\n'
        '    "moduleResolution": "Bundler",\n'
        '    "allowImportingTsExtensions": true,\n'
        '    "resolveJsonModule": true,\n'
        '    "isolatedModules": true,\n'
        '    "noEmit": true,\n'
        '    "jsx": "react-jsx",\n'
        '    "strict": true\n'
        "  },\n"
        f'  "include": {include}\n'
        "}\n"
    )


def _vite_config(fullstack: bool) -> str:
    if fullstack:
        return (
            "import { defineConfig } from 'vite';\n"
            "import react from '@vitejs/plugin-react';\n\n"
            "export default defineConfig({\n"
            "  root: 'frontend',\n"
            "  plugins: [react()],\n"
            "  server: {\n"
            "    proxy: {\n"
            "      '/api': 'http://localhost:3001',\n"
            "      '/health': 'http://localhost:3001',\n"
            "    },\n"
            "  },\n"
            "  test: {\n"
            "    environment: 'node',\n"
            "  },\n"
            "});\n"
        )
    return (
        "import { defineConfig } from 'vite';\n"
        "import react from '@vitejs/plugin-react';\n\n"
        "export default defineConfig({\n"
        "  plugins: [react()],\n"
        "  test: {\n"
        "    environment: 'node',\n"
        "  },\n"
        "});\n"
    )


def _index_html(title: str) -> str:
    return (
        "<!doctype html>\n"
        "<html lang=\"en\">\n"
        "  <head>\n"
        "    <meta charset=\"UTF-8\" />\n"
        "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n"
        f"    <title>{title}</title>\n"
        "  </head>\n"
        "  <body>\n"
        "    <div id=\"root\"></div>\n"
        "    <script type=\"module\" src=\"/src/main.tsx\"></script>\n"
        "  </body>\n"
        "</html>\n"
    )


def _main_tsx(import_path: str) -> str:
    return (
        "import React from 'react';\n"
        "import ReactDOM from 'react-dom/client';\n\n"
        f"import App from '{import_path}';\n\n"
        "ReactDOM.createRoot(document.getElementById('root')!).render(\n"
        "  <React.StrictMode>\n"
        "    <App />\n"
        "  </React.StrictMode>,\n"
        ");\n"
    )


def _normalize_runtime_metadata(
    job: JobSpec,
    files: list[CodeFile],
    setup_instructions: str,
) -> tuple[list[CodeFile], str]:
    has_python = _has_suffix(files, ".py")
    has_node = _has_suffix(files, ".ts", ".tsx", ".js", ".jsx")
    has_react = _has_suffix(files, ".tsx", ".jsx")
    has_fullstack_frontend = _has_prefix(files, "frontend/")
    fullstack = has_fullstack_frontend and _has_prefix(files, "backend/")

    if has_python and not _has_suffix(files, "requirements.txt", "pyproject.toml"):
        _upsert_file(files, "requirements.txt", "text", _python_requirements(job, files))
    if has_python and _find_file(files, "pipeline/main.py") and "__main__" not in (_find_file(files, "pipeline/main.py") or CodeFile(path="", language="", content="")).content:
        main_file = _find_file(files, "pipeline/main.py")
        if main_file:
            main_file.content = (
                main_file.content.rstrip()
                + "\n\n\nif __name__ == '__main__':\n"
                "    print(run_pipeline())\n"
            )

    if has_node and not _find_file(files, "package.json"):
        _upsert_file(files, "package.json", "json", _frontend_package_json(job, fullstack=fullstack))
    if has_node and _has_suffix(files, ".ts", ".tsx") and not _find_file(files, "tsconfig.json"):
        _upsert_file(files, "tsconfig.json", "json", _typescript_tsconfig(fullstack))
    if has_react:
        root_prefix = "frontend/" if has_fullstack_frontend else ""
        main_path = f"{root_prefix}src/main.tsx"
        index_path = f"{root_prefix}index.html"
        if not _find_file(files, main_path):
            _upsert_file(files, main_path, "typescript", _main_tsx("./App"))
        if not _find_file(files, index_path):
            _upsert_file(files, index_path, "html", _index_html(job.title))
        if not _find_file(files, "vite.config.ts"):
            _upsert_file(files, "vite.config.ts", "typescript", _vite_config(fullstack))

    instructions = setup_instructions.strip()
    if instructions:
        return files, instructions
    if fullstack:
        return files, "1. `npm install`\n2. `npm run dev`\n3. `npm test`"
    if has_react or has_node:
        return files, "1. `npm install`\n2. `npm run dev`\n3. `npm test`"
    if has_python:
        if _find_file(files, "pipeline/main.py"):
            return files, "1. `pip install -r requirements.txt`\n2. `python -m pipeline.main`\n3. `pytest`"
        return files, "1. `pip install -r requirements.txt`\n2. `uvicorn app.main:app --reload`\n3. `pytest`"
    return files, instructions


def _python_backend_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    domain_label, singular, plural = _domain_terms(job, context)
    module = _slug(singular.replace(" ", "_"), "work_item")
    plural_var = plural.replace(" ", "_")
    files = [
        CodeFile(path="requirements.txt", language="text", content="fastapi\nuvicorn\npytest\nhttpx\n"),
        CodeFile(
            path="app/main.py",
            language="python",
            content=(
                "from fastapi import FastAPI\n\n"
                "from app.middleware import RequestMetricsMiddleware\n"
                "from app.routes import router\n"
                "from app.settings import Settings\n\n"
                "settings = Settings()\n"
                "app = FastAPI(title=settings.service_name)\n"
                "app.add_middleware(RequestMetricsMiddleware)\n"
                "app.include_router(router, prefix='/api/v1')\n\n"
                "@app.get('/health')\n"
                "def healthcheck() -> dict[str, str]:\n"
                "    return {'status': 'ok', 'service': settings.service_name}\n"
            ),
        ),
        CodeFile(
            path="app/routes.py",
            language="python",
            content=(
                "from fastapi import APIRouter, HTTPException, status\n\n"
                f"from app.models import {module.title().replace('_', '')}Create, {module.title().replace('_', '')}Record\n"
                f"from app.services import {module.title().replace('_', '')}Service, service\n\n"
                "router = APIRouter(tags=['assessment'])\n\n"
                "@router.get('/items', response_model=list[" + module.title().replace('_', '') + "Record])\n"
                "def list_items() -> list[" + module.title().replace('_', '') + "Record]:\n"
                "    return service.list_items()\n\n"
                "@router.post('/items', response_model=" + module.title().replace('_', '') + "Record, status_code=status.HTTP_201_CREATED)\n"
                "def create_item(payload: " + module.title().replace('_', '') + "Create) -> " + module.title().replace('_', '') + "Record:\n"
                "    try:\n"
                "        return service.create_item(payload)\n"
                "    except ValueError as exc:\n"
                "        raise HTTPException(status_code=400, detail=str(exc)) from exc\n"
            ),
        ),
        CodeFile(
            path="app/services.py",
            language="python",
            content=(
                "from __future__ import annotations\n\n"
                "from datetime import UTC, datetime\n\n"
                f"from app.models import {module.title().replace('_', '')}Create, {module.title().replace('_', '')}Record\n"
                f"from app.repository import {module.title().replace('_', '')}Repository\n\n"
                "class " + module.title().replace('_', '') + "Service:\n"
                "    def __init__(self, repository: " + module.title().replace('_', '') + "Repository) -> None:\n"
                "        self.repository = repository\n\n"
                "    def list_items(self) -> list[" + module.title().replace('_', '') + "Record]:\n"
                "        return self.repository.list_items()\n\n"
                "    def create_item(self, payload: " + module.title().replace('_', '') + "Create) -> " + module.title().replace('_', '') + "Record:\n"
                f"        if payload.name.lower().startswith('test-'):\n"
                f"            raise ValueError('Reserved {singular} names cannot start with test-')\n"
                "        if payload.priority > 5:\n"
                "            raise ValueError('Priority must stay within the team operating range.')\n"
                "        record = " + module.title().replace('_', '') + "Record(\n"
                "            id=f'itm-{int(datetime.now(UTC).timestamp())}',\n"
                "            name=payload.name,\n"
                "            owner=payload.owner,\n"
                "            priority=payload.priority,\n"
                "            status='queued',\n"
                "        )\n"
                "        return self.repository.save(record)\n\n"
                "service = " + module.title().replace('_', '') + "Service(repository=" + module.title().replace('_', '') + "Repository())\n"
            ),
        ),
        CodeFile(
            path="app/models.py",
            language="python",
            content=(
                "from pydantic import BaseModel, Field\n\n"
                "class " + module.title().replace('_', '') + "Create(BaseModel):\n"
                f"    name: str = Field(min_length=3, description='Human readable {singular} label')\n"
                "    owner: str = Field(min_length=3)\n"
                "    priority: int = Field(default=3, ge=1, le=5)\n\n"
                "class " + module.title().replace('_', '') + "Record(" + module.title().replace('_', '') + "Create):\n"
                "    id: str\n"
                "    status: str\n"
            ),
        ),
        CodeFile(
            path="app/repository.py",
            language="python",
            content=(
                "from __future__ import annotations\n\n"
                f"from app.models import {module.title().replace('_', '')}Record\n\n"
                "class " + module.title().replace('_', '') + "Repository:\n"
                "    def __init__(self) -> None:\n"
                "        self._items: list[" + module.title().replace('_', '') + "Record] = []\n\n"
                "    def list_items(self) -> list[" + module.title().replace('_', '') + "Record]:\n"
                "        return list(self._items)\n\n"
                "    def save(self, record: " + module.title().replace('_', '') + "Record) -> " + module.title().replace('_', '') + "Record:\n"
                "        self._items = [existing for existing in self._items if existing.id != record.id]\n"
                "        self._items.append(record)\n"
                "        return record\n"
            ),
        ),
        CodeFile(
            path="app/settings.py",
            language="python",
            content=(
                "from pydantic import BaseModel\n\n"
                "class Settings(BaseModel):\n"
                f"    service_name: str = '{job.title}'\n"
                f"    domain_label: str = '{domain_label}'\n"
                "    enable_request_metrics: bool = True\n"
            ),
        ),
        CodeFile(
            path="app/middleware.py",
            language="python",
            content=(
                "from __future__ import annotations\n\n"
                "import time\n\n"
                "from starlette.middleware.base import BaseHTTPMiddleware\n"
                "from starlette.requests import Request\n\n"
                "class RequestMetricsMiddleware(BaseHTTPMiddleware):\n"
                "    async def dispatch(self, request: Request, call_next):\n"
                "        started = time.perf_counter()\n"
                "        response = await call_next(request)\n"
                "        response.headers['x-request-duration-ms'] = str(int((time.perf_counter() - started) * 1000))\n"
                "        return response\n"
            ),
        ),
        CodeFile(
            path="tests/test_app.py",
            language="python",
            content=(
                "from fastapi.testclient import TestClient\n\n"
                "from app.main import app\n\n"
                "client = TestClient(app)\n\n"
                "def test_healthcheck() -> None:\n"
                "    response = client.get('/health')\n"
                "    assert response.status_code == 200\n"
                "    assert response.json()['status'] == 'ok'\n\n"
                "def test_create_item_rejects_reserved_prefix() -> None:\n"
                "    response = client.post('/api/v1/items', json={'name': 'test-hidden', 'owner': 'ops', 'priority': 2})\n"
                "    assert response.status_code == 400\n\n"
                "def test_create_item_persists_record() -> None:\n"
                "    response = client.post('/api/v1/items', json={'name': 'stabilize-flow', 'owner': 'platform', 'priority': 3})\n"
                "    assert response.status_code == 201\n"
                "    listing = client.get('/api/v1/items')\n"
                "    assert listing.status_code == 200\n"
                "    assert len(listing.json()) >= 1\n"
            ),
        ),
    ]
    readme_paths = [file.path for file in files]
    files.append(
        CodeFile(
            path="README.md",
            language="markdown",
            content=_readme(
                job,
                context,
                "1. `pip install -r requirements.txt`\n2. `uvicorn app.main:app --reload`\n3. `pytest`",
                readme_paths,
            ),
        )
    )
    return files


def _typescript_frontend_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    domain_label, singular, plural = _domain_terms(job, context)
    files = [
        CodeFile(path="package.json", language="json", content=_frontend_package_json(job, fullstack=False)),
        CodeFile(path="tsconfig.json", language="json", content=_typescript_tsconfig(False)),
        CodeFile(path="vite.config.ts", language="typescript", content=_vite_config(False)),
        CodeFile(path="index.html", language="html", content=_index_html(job.title)),
        CodeFile(path="src/main.tsx", language="typescript", content=_main_tsx("./App")),
        CodeFile(
            path="src/App.tsx",
            language="typescript",
            content=(
                "import { useAssessmentState } from './state/useAssessmentState';\n"
                "import { WorkQueue } from './components/WorkQueue';\n\n"
                "export default function App() {\n"
                "  const { items, addItem, selectedOwner, setSelectedOwner } = useAssessmentState();\n"
                "  return (\n"
                "    <main>\n"
                f"      <h1>{job.title}</h1>\n"
                f"      <p>Operational view for {domain_label}.</p>\n"
                "      <label>\n"
                "        Owner\n"
                "        <input value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)} />\n"
                "      </label>\n"
                "      <button onClick={() => addItem()}>Create draft item</button>\n"
                "      <WorkQueue items={items} />\n"
                "    </main>\n"
                "  );\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="src/components/WorkQueue.tsx",
            language="typescript",
            content=(
                "import type { WorkItem } from '../types';\n\n"
                "export function WorkQueue({ items }: { items: WorkItem[] }) {\n"
                "  return (\n"
                "    <section>\n"
                f"      <h2>Active {plural}</h2>\n"
                "      <ul>\n"
                "        {items.map((item) => (\n"
                "          <li key={item.id}>\n"
                "            <strong>{item.name}</strong> - {item.owner} - {item.status}\n"
                "          </li>\n"
                "        ))}\n"
                "      </ul>\n"
                "    </section>\n"
                "  );\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="src/hooks/useDraftCreator.ts",
            language="typescript",
            content=(
                "import type { WorkItem } from '../types';\n\n"
                "export function createDraftItem(owner: string, total: number): WorkItem {\n"
                "  if (!owner.trim()) {\n"
                "    throw new Error('Owner is required before creating a draft item.');\n"
                "  }\n"
                "  return {\n"
                "    id: `itm-${total + 1}`,\n"
                "    name: `draft-${total + 1}`,\n"
                "    owner,\n"
                "    status: 'queued',\n"
                "  };\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="src/state/useAssessmentState.ts",
            language="typescript",
            content=(
                "import { useState } from 'react';\n\n"
                "import { createDraftItem } from '../hooks/useDraftCreator';\n"
                "import type { WorkItem } from '../types';\n\n"
                "export function useAssessmentState() {\n"
                "  const [selectedOwner, setSelectedOwner] = useState('platform');\n"
                "  const [items, setItems] = useState<WorkItem[]>([]);\n\n"
                "  function addItem() {\n"
                "    setItems((current) => [...current, createDraftItem(selectedOwner, current.length)]);\n"
                "  }\n\n"
                "  return { items, addItem, selectedOwner, setSelectedOwner };\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="src/types.ts",
            language="typescript",
            content=(
                "export type WorkItem = {\n"
                "  id: string;\n"
                "  name: string;\n"
                "  owner: string;\n"
                "  status: 'queued' | 'active' | 'done';\n"
                "};\n"
            ),
        ),
        CodeFile(
            path="src/config.ts",
            language="typescript",
            content=(
                "export const appConfig = {\n"
                f"  title: '{job.title}',\n"
                f"  domainLabel: '{domain_label}',\n"
                "  maxVisibleItems: 20,\n"
                "};\n"
            ),
        ),
        CodeFile(
            path="src/__tests__/App.test.tsx",
            language="typescript",
            content=(
                "import { describe, expect, it } from 'vitest';\n"
                "import { createDraftItem } from '../hooks/useDraftCreator';\n\n"
                "describe('createDraftItem', () => {\n"
                "  it('creates a queued item for a valid owner', () => {\n"
                "    const item = createDraftItem('platform', 1);\n"
                "    expect(item.status).toBe('queued');\n"
                "  });\n\n"
                "  it('rejects blank owners', () => {\n"
                "    expect(() => createDraftItem('', 1)).toThrowError();\n"
                "  });\n"
                "});\n"
            ),
        ),
    ]
    readme_paths = [file.path for file in files]
    files.append(
        CodeFile(
            path="README.md",
            language="markdown",
            content=_readme(
                job,
                context,
                "1. `npm install`\n2. `npm run dev`\n3. `npm test`",
                readme_paths,
            ),
        )
    )
    return files


def _typescript_fullstack_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    domain_label, singular, plural = _domain_terms(job, context)
    files = [
        CodeFile(path="package.json", language="json", content=_frontend_package_json(job, fullstack=True)),
        CodeFile(path="tsconfig.json", language="json", content=_typescript_tsconfig(True)),
        CodeFile(path="vite.config.ts", language="typescript", content=_vite_config(True)),
        CodeFile(path="frontend/index.html", language="html", content=_index_html(job.title)),
        CodeFile(path="frontend/src/main.tsx", language="typescript", content=_main_tsx("./App")),
        CodeFile(
            path="backend/server.ts",
            language="typescript",
            content=(
                "import express from 'express';\n"
                "import { createItem, listItems } from './service';\n\n"
                "const app = express();\n"
                "const port = Number(process.env.PORT || 3001);\n"
                "app.use(express.json());\n\n"
                "app.get('/health', (_req, res) => res.json({ status: 'ok' }));\n"
                "app.get('/api/items', (_req, res) => res.json(listItems()));\n"
                "app.post('/api/items', (req, res) => {\n"
                "  try {\n"
                "    res.status(201).json(createItem(req.body));\n"
                "  } catch (error) {\n"
                "    res.status(400).json({ detail: error instanceof Error ? error.message : 'Unknown error' });\n"
                "  }\n"
                "});\n\n"
                "app.listen(port, () => {\n"
                "  console.log(`api listening on ${port}`);\n"
                "});\n"
            ),
        ),
        CodeFile(
            path="backend/service.ts",
            language="typescript",
            content=(
                "import { repository } from './store';\n"
                "import type { WorkItem, WorkItemInput } from '../shared/types';\n\n"
                "export function listItems(): WorkItem[] {\n"
                "  return repository.list();\n"
                "}\n\n"
                "export function createItem(payload: WorkItemInput): WorkItem {\n"
                "  if (!payload.owner?.trim()) {\n"
                "    throw new Error('Owner is required.');\n"
                "  }\n"
                "  return repository.save({\n"
                "    id: `itm-${Date.now()}`,\n"
                "    name: payload.name,\n"
                "    owner: payload.owner,\n"
                "    status: 'queued',\n"
                "  });\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="backend/store.ts",
            language="typescript",
            content=(
                "import type { WorkItem } from '../shared/types';\n\n"
                "class WorkRepository {\n"
                "  private items: WorkItem[] = [];\n\n"
                "  list(): WorkItem[] {\n"
                "    return [...this.items];\n"
                "  }\n\n"
                "  save(item: WorkItem): WorkItem {\n"
                "    this.items = this.items.filter((existing) => existing.id !== item.id);\n"
                "    this.items.push(item);\n"
                "    return item;\n"
                "  }\n"
                "}\n\n"
                "export const repository = new WorkRepository();\n"
            ),
        ),
        CodeFile(
            path="frontend/src/App.tsx",
            language="typescript",
            content=(
                "import { useEffect, useState } from 'react';\n"
                "import type { WorkItem } from '../../shared/types';\n\n"
                "export default function App() {\n"
                "  const [items, setItems] = useState<WorkItem[]>([]);\n"
                "  useEffect(() => {\n"
                "    fetch('/api/items').then((response) => response.json()).then(setItems);\n"
                "  }, []);\n"
                "  return (\n"
                "    <main>\n"
                f"      <h1>{job.title}</h1>\n"
                f"      <p>Operations surface for {domain_label}.</p>\n"
                "      <ul>{items.map((item) => <li key={item.id}>{item.name} - {item.status}</li>)}</ul>\n"
                "    </main>\n"
                "  );\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="frontend/src/api.ts",
            language="typescript",
            content=(
                "export async function createItem(payload: { name: string; owner: string }) {\n"
                "  const response = await fetch('/api/items', {\n"
                "    method: 'POST',\n"
                "    headers: { 'content-type': 'application/json' },\n"
                "    body: JSON.stringify(payload),\n"
                "  });\n"
                "  if (!response.ok) {\n"
                "    throw new Error('Failed to create item');\n"
                "  }\n"
                "  return response.json();\n"
                "}\n"
            ),
        ),
        CodeFile(
            path="shared/types.ts",
            language="typescript",
            content=(
                "export type WorkItem = {\n"
                "  id: string;\n"
                "  name: string;\n"
                "  owner: string;\n"
                "  status: 'queued' | 'active' | 'done';\n"
                "};\n\n"
                "export type WorkItemInput = {\n"
                "  name: string;\n"
                "  owner: string;\n"
                "};\n"
            ),
        ),
        CodeFile(
            path="tests/service.test.ts",
            language="typescript",
            content=(
                "import { describe, expect, it } from 'vitest';\n"
                "import { createItem } from '../backend/service';\n\n"
                "describe('createItem', () => {\n"
                "  it('creates an item for valid input', () => {\n"
                "    const created = createItem({ name: 'sync-release', owner: 'platform' });\n"
                "    expect(created.status).toBe('queued');\n"
                "  });\n\n"
                "  it('rejects missing owners', () => {\n"
                "    expect(() => createItem({ name: 'sync-release', owner: '' })).toThrowError();\n"
                "  });\n"
                "});\n"
            ),
        ),
    ]
    readme_paths = [file.path for file in files]
    files.append(
        CodeFile(
            path="README.md",
            language="markdown",
            content=_readme(
                job,
                context,
                "1. `npm install`\n2. `npm run dev`\n3. `npm test`",
                readme_paths,
            ),
        )
    )
    return files


def _data_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    domain_label, singular, plural = _domain_terms(job, context)
    files = [
        CodeFile(path="requirements.txt", language="text", content="pytest\n"),
        CodeFile(path="pipeline/main.py", language="python", content="from pipeline.transform import normalize_records\nfrom pipeline.load import load_records\nfrom pipeline.extract import read_source\n\n\ndef run_pipeline() -> int:\n    rows = read_source()\n    normalized = normalize_records(rows)\n    return load_records(normalized)\n\n\nif __name__ == '__main__':\n    print(run_pipeline())\n"),
        CodeFile(path="pipeline/extract.py", language="python", content=f"def read_source() -> list[dict[str, str]]:\n    return [{{'id': 'row-1', 'name': 'daily-{singular.replace(' ', '-')}', 'owner': 'analytics'}}]\n"),
        CodeFile(path="pipeline/transform.py", language="python", content="def normalize_records(rows: list[dict[str, str]]) -> list[dict[str, str]]:\n    normalized: list[dict[str, str]] = []\n    for row in rows:\n        normalized.append({'id': row['id'], 'name': row['name'].strip().lower(), 'owner': row['owner'].strip().lower()})\n    return normalized\n"),
        CodeFile(path="pipeline/load.py", language="python", content="from pipeline.models import LoadSummary\n\n\ndef load_records(rows: list[dict[str, str]]) -> int:\n    summary = LoadSummary(processed=len(rows), duplicates=0)\n    return summary.processed - summary.duplicates\n"),
        CodeFile(path="pipeline/models.py", language="python", content="from dataclasses import dataclass\n\n\n@dataclass(slots=True)\nclass LoadSummary:\n    processed: int\n    duplicates: int\n"),
        CodeFile(path="pipeline/settings.py", language="python", content=f"SERVICE_NAME = '{job.title}'\nDOMAIN_LABEL = '{domain_label}'\n"),
        CodeFile(path="tests/test_pipeline.py", language="python", content="from pipeline.main import run_pipeline\n\n\ndef test_run_pipeline_returns_count() -> None:\n    assert run_pipeline() == 1\n"),
    ]
    readme_paths = [file.path for file in files]
    files.append(CodeFile(path="README.md", language="markdown", content=_readme(job, context, "1. `pip install -r requirements.txt`\n2. `python -m pipeline.main`\n3. `pytest`", readme_paths)))
    return files


def _devops_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    readme_paths = [
        "Dockerfile",
        ".github/workflows/ci.yml",
        "deploy/deploy.sh",
        "infra/main.tf",
        "monitoring/alerts.yaml",
        "scripts/verify.sh",
        "config/service.env.example",
    ]
    files = [
        CodeFile(path="Dockerfile", language="dockerfile", content="FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD [\"python\", \"-m\", \"http.server\", \"8080\"]\n"),
        CodeFile(path=".github/workflows/ci.yml", language="yaml", content="name: ci\non: [push]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/verify.sh\n"),
        CodeFile(path="deploy/deploy.sh", language="bash", content="#!/usr/bin/env bash\nset -euo pipefail\necho 'Deploying assessment service'\n"),
        CodeFile(path="infra/main.tf", language="terraform", content="terraform {\n  required_version = \">= 1.6.0\"\n}\n\nvariable \"service_name\" {\n  type = string\n}\n"),
        CodeFile(path="monitoring/alerts.yaml", language="yaml", content="alerts:\n  - name: high-error-rate\n    expr: rate(http_requests_total{status=~\"5..\"}[5m]) > 0.05\n"),
        CodeFile(path="scripts/verify.sh", language="bash", content="#!/usr/bin/env bash\nset -euo pipefail\necho 'lint placeholder'\necho 'test placeholder'\n"),
        CodeFile(path="config/service.env.example", language="dotenv", content=f"SERVICE_NAME={job.title}\nENVIRONMENT=development\n"),
        CodeFile(path="README.md", language="markdown", content=_readme(job, context, "1. `bash scripts/verify.sh`\n2. `bash deploy/deploy.sh`", readme_paths)),
    ]
    return files


def _docs_only_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    readme_paths = ["docs/spec.md", "docs/brief.md", "docs/acceptance.md", "docs/risks.md", "docs/metrics.md"]
    files = [
        CodeFile(path="docs/spec.md", language="markdown", content=f"# {job.title}\n\n{context.domain_summary or job.jd_text}\n"),
        CodeFile(path="docs/brief.md", language="markdown", content="## Stakeholders\n- Hiring manager\n- Delivery lead\n- Candidate\n"),
        CodeFile(path="docs/acceptance.md", language="markdown", content="## Acceptance\n- Clear scope\n- Measurable outcomes\n- Delivery risks called out\n"),
        CodeFile(path="docs/risks.md", language="markdown", content="## Risks\n- Ambiguous ownership\n- Weak rollout plan\n- Missing observability\n"),
        CodeFile(path="docs/metrics.md", language="markdown", content="## Metrics\n- Lead time\n- Reliability\n- Candidate signal quality\n"),
        CodeFile(path="README.md", language="markdown", content=_readme(job, context, "Open the docs folder and review the spec set.", readme_paths)),
    ]
    return files


def _fallback_files(job: JobSpec, context: ExtractedContext) -> list[CodeFile]:
    role = job.role_family.value if hasattr(job.role_family, "value") else str(job.role_family)
    if role == "backend" or role == "qa":
        return _python_backend_files(job, context)
    if role == "frontend":
        return _typescript_frontend_files(job, context)
    if role == "fullstack":
        return _typescript_fullstack_files(job, context)
    if role == "data":
        return _data_files(job, context)
    if role == "devops":
        return _devops_files(job, context)
    return _docs_only_files(job, context)


def _needs_fallback(files: list[CodeFile], expected_min: int) -> bool:
    if len(files) < expected_min:
        return True
    lowered = [file.path.lower() for file in files]
    has_readme = any(path.endswith("readme.md") for path in lowered)
    has_test = any("test" in path or "spec" in path for path in lowered)
    has_python = any(path.endswith(".py") for path in lowered)
    has_node = any(path.endswith((".ts", ".tsx", ".js", ".jsx")) for path in lowered)
    has_requirements = any(path.endswith(("requirements.txt", "pyproject.toml")) for path in lowered)
    has_package_json = any(path.endswith("package.json") for path in lowered)
    if has_python and not has_requirements:
        return True
    if has_node and not has_package_json:
        return True
    return not has_readme or not has_test


def _build_fallback_codebase(job: JobSpec, context: ExtractedContext, reason: str) -> Codebase:
    files = _fallback_files(job, context)
    files, setup_instructions = _normalize_runtime_metadata(job, files, "")
    log.warning("code_author: using local scaffold fallback because %s", reason)
    return Codebase(
        artifact_kind=ArtifactKind.CODE,
        entry_point=_guess_entry_point(files),
        setup_instructions=setup_instructions,
        files=files,
    )


async def run(job: JobSpec, context: ExtractedContext, review_feedback: str = "") -> Codebase:
    job_compact = {k: v for k, v in job.model_dump().items() if k in _JOB_FIELDS}
    sections = [
        "Job spec:\n" + json.dumps(job_compact, indent=2, default=str),
        "Extracted context:\n" + json.dumps(context.model_dump(), indent=2, default=str),
    ]
    if review_feedback.strip():
        sections.append(f"Reviewer feedback to correct on this retry:\n{review_feedback.strip()}")
    sections.append("Produce the production-ready codebase JSON described in the system prompt.")
    user = "\n\n".join(sections)

    seniority = job.seniority.value if hasattr(job.seniority, "value") else str(job.seniority)
    expected_min = _MIN_FILES_BY_SENIORITY.get(seniority, 4)

    try:
        data = await complete_json(CODE_AUTHOR, user, temperature=0.6, max_tokens=_MAX_OUTPUT_TOKENS)
    except Exception as exc:
        log.warning("code_author: model generation failed, switching to local scaffold: %s", exc)
        return _build_fallback_codebase(job, context, "model generation failed")

    files = _parse_files(data.get("files") or [])
    if not files:
        return _build_fallback_codebase(job, context, "no valid files returned")

    files, setup_instructions = _normalize_runtime_metadata(
        job,
        files,
        data.get("setup_instructions", ""),
    )

    if _needs_fallback(files, expected_min):
        return _build_fallback_codebase(
            job,
            context,
            f"only {len(files)} files generated (expected >= {expected_min})",
        )

    entry_point = data.get("entry_point") or _guess_entry_point(files)
    artifact_kind = data.get("artifact_kind", "code")
    try:
        artifact_kind_enum = ArtifactKind(artifact_kind)
    except ValueError:
        log.warning("code_author: unknown artifact_kind %r, defaulting to 'code'", artifact_kind)
        artifact_kind_enum = ArtifactKind.CODE

    return Codebase(
        artifact_kind=artifact_kind_enum,
        entry_point=entry_point,
        setup_instructions=setup_instructions,
        files=files,
    )
