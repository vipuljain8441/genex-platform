"""GenEx FastAPI entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import buddy, candidate, employer, invite, monitor, results, sandbox
from app.core.config import settings
from app.store import store

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.startup()
    try:
        yield
    finally:
        await store.shutdown()


app = FastAPI(
    title="GenEx Assessment Platform",
    description="Agentic technical assessment platform for SkillBrew",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(employer.router, prefix="/api")
app.include_router(candidate.router, prefix="/api")
app.include_router(buddy.router, prefix="/api")
app.include_router(monitor.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(invite.router, prefix="/api")
app.include_router(sandbox.router, prefix="/api")
