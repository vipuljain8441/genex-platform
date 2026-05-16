from __future__ import annotations

from app.core.config import settings
from app.store.base import Store
from app.store.memory import MemoryStore
from app.store.postgres import PostgresStore


def _build_store() -> Store:
    backend = settings.store_backend.lower()
    if backend == "postgres":
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required when STORE_BACKEND=postgres")
        return PostgresStore(settings.database_url)
    return MemoryStore()


store = _build_store()
