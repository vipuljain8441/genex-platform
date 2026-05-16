"use client";

import { api } from "./api";

/**
 * Batches activity events client-side and flushes them every 1.5s.
 * Heavy events (every keystroke) get debounced into a single "edit" event
 * per file per flush window so we don't drown the server.
 */
class Monitor {
  private queue: {
    session_id: string;
    kind: string;
    file_path?: string | null;
    payload?: Record<string, unknown>;
  }[] = [];
  private editAccum: Map<string, number> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentSession: string | null = null;

  start(session_id: string) {
    this.currentSession = session_id;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), 1500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  edit(file_path: string, deltaChars: number) {
    const cur = this.editAccum.get(file_path) || 0;
    this.editAccum.set(file_path, cur + deltaChars);
  }

  event(kind: string, file_path?: string | null, payload?: Record<string, unknown>) {
    if (!this.currentSession) return;
    this.queue.push({
      session_id: this.currentSession,
      kind,
      file_path: file_path ?? null,
      payload: payload ?? {},
    });
  }

  private flush() {
    if (!this.currentSession) return;
    for (const [path, delta] of this.editAccum.entries()) {
      this.queue.push({
        session_id: this.currentSession,
        kind: "edit",
        file_path: path,
        payload: { delta_chars: delta },
      });
    }
    this.editAccum.clear();
    const batch = this.queue.splice(0, this.queue.length);
    for (const ev of batch) {
      api.recordEvent(ev).catch(() => {/* swallow — best-effort */});
    }
  }
}

export const monitor = new Monitor();
