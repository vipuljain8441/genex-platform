"""Aggregates ActivityEvents into a 2-D heatmap (file × time-bucket) for the
results page, plus a per-file timeline."""
from __future__ import annotations

from datetime import datetime
from typing import TypedDict

from app.models.schemas import ActivityEvent

# Weight per event kind — edits matter more than file-opens for "intensity".
_WEIGHTS = {
    "edit": 3.0,
    "run": 4.0,
    "terminal_command": 3.5,
    "buddy_query": 2.0,
    "buddy_hint": 1.0,
    "file_open": 1.0,
    "file_switch": 1.0,
    "search_query": 1.5,
    "search_result_open": 1.5,
    "challenge_switch": 0.75,
    "challenge_response": 1.5,
    "selection_change": 0.5,
    "cursor_move": 0.25,
    "panel_switch": 0.5,
    "idle": -0.5,
    "submit": 5.0,
}


class HeatmapCell(TypedDict):
    file_path: str
    bucket: int
    intensity: float
    events: int


class Heatmap(TypedDict):
    buckets: int
    bucket_seconds: int
    files: list[str]
    cells: list[HeatmapCell]
    started_at: str
    ended_at: str
    totals_by_kind: dict[str, int]


def build_heatmap(events: list[ActivityEvent], bucket_count: int = 20) -> Heatmap:
    if not events:
        now = datetime.utcnow().isoformat()
        return Heatmap(
            buckets=bucket_count,
            bucket_seconds=0,
            files=[],
            cells=[],
            started_at=now,
            ended_at=now,
            totals_by_kind={},
        )

    sorted_events = sorted(events, key=lambda e: e.at)
    start = sorted_events[0].at
    end = sorted_events[-1].at
    duration = max((end - start).total_seconds(), 1)
    bucket_seconds = max(int(duration / bucket_count), 1)

    files = sorted({e.file_path for e in sorted_events if e.file_path})
    if not files:
        files = ["(no-file)"]

    grid: dict[tuple[str, int], dict[str, float]] = {}
    totals: dict[str, int] = {}
    for e in sorted_events:
        totals[e.kind.value] = totals.get(e.kind.value, 0) + 1
        key_file = e.file_path or "(no-file)"
        offset = (e.at - start).total_seconds()
        bucket = min(int(offset // bucket_seconds), bucket_count - 1)
        cell = grid.setdefault((key_file, bucket), {"intensity": 0.0, "events": 0.0})
        cell["intensity"] += _WEIGHTS.get(e.kind.value, 1.0)
        cell["events"] += 1

    cells: list[HeatmapCell] = []
    for (file_path, bucket), v in grid.items():
        cells.append(
            HeatmapCell(
                file_path=file_path,
                bucket=bucket,
                intensity=round(max(v["intensity"], 0.0), 2),
                events=int(v["events"]),
            )
        )

    return Heatmap(
        buckets=bucket_count,
        bucket_seconds=bucket_seconds,
        files=files,
        cells=cells,
        started_at=start.isoformat(),
        ended_at=end.isoformat(),
        totals_by_kind=totals,
    )
