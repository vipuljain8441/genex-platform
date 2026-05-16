# Single Sandbox Environment

Last reviewed: 2026-05-16

## Goal

Run GenEx inside one containerized development environment with:

- bind-mounted source code for real-time editing
- Postgres for persistent storage
- a local OpenAI-compatible Ollama endpoint for the agent pipeline and Buddy
- VS Code Dev Containers support

## Stack

- `workspace`
  - the container you attach to from VS Code
  - bind-mounts the repo so file edits are instant in both directions
  - exposes ports `3000` and `8000`

- `postgres`
  - persistent app storage
  - exposed on `5432`

- `ollama`
  - local Ollama server
  - recommended small model: `qwen2.5-coder:0.5b`
  - exposed externally on `11434`, internally at `http://ollama:11434/v1`

## Why bind mounts

The repo is mounted into `/workspace`, so changes made:

- in the browser-based editor
- from VS Code attached to the container
- from terminals running inside the container

all hit the same live files immediately.

## Dev Containers flow

1. Open the repo in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. VS Code attaches to the `workspace` service from `docker-compose.yml`.
4. `.devcontainer/post-create.sh` installs backend and frontend dependencies.
5. Start the app processes inside the workspace container:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
npm run dev -- --hostname 0.0.0.0 --port 3000
```

## Self-hosted VS Code / code-server

If you run VS Code itself in Docker, mount the same repo path into that
container too. The essential rule is:

- the editor container and the app workspace container must see the same files

If you only mount the code into one of them, live editing will feel broken.

## Compose notes

- Start the full stack:

```bash
docker-compose up --build workspace postgres ollama
```

- If you want only the workspace + Postgres first:

```bash
docker compose up --build workspace postgres
```

## App configuration inside the sandbox

Backend env defaults in compose:

- `STORE_BACKEND=postgres`
- `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/genex`
- `LLM_PROVIDER=openai_compatible`
- `LLM_API_BASE=http://ollama:11434/v1`
- `LLM_API_KEY=ollama`
- `LLM_MODEL=qwen2.5-coder:0.5b`

## First-time model pull

After the `ollama` container is running, pull the model once:

```bash
docker-compose exec ollama ollama pull qwen2.5-coder:0.5b
```

Then verify it:

```bash
curl http://localhost:11434/v1/models \
  -H "Authorization: Bearer ollama"
```
