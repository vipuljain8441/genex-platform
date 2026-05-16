"use client";

import { api, type ActivityEventInput } from "./api";

export type MonitorEvent = ActivityEventInput & {
  client_at: string;
};

type MonitorListener = (event: MonitorEvent) => void;

/**
 * Batches activity events client-side and flushes them every 1.5s.
 * Heavy events (every keystroke) get debounced into a single "edit" event
 * per file per flush window so we don't drown the server.
 */
class Monitor {
  private queue: ActivityEventInput[] = [];
  private editAccum: Map<string, number> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentSession: string | null = null;
  private listeners: Set<MonitorListener> = new Set();

  start(session_id: string) {
    this.currentSession = session_id;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.flush(), 1500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
    this.currentSession = null;
  }

  edit(file_path: string, deltaChars: number) {
    const cur = this.editAccum.get(file_path) || 0;
    this.editAccum.set(file_path, cur + deltaChars);
  }

  event(kind: string, file_path?: string | null, payload?: Record<string, unknown>) {
    if (!this.currentSession) return;
    const event: MonitorEvent = {
      session_id: this.currentSession,
      kind,
      file_path: file_path ?? null,
      payload: payload ?? {},
      client_at: new Date().toISOString(),
    };
    this.queue.push({
      session_id: event.session_id,
      kind: event.kind,
      file_path: event.file_path,
      payload: event.payload,
    });
    this.emit(event);
  }

  subscribe(listener: MonitorListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MonitorEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private flush() {
    if (!this.currentSession) return;
    for (const [path, delta] of this.editAccum.entries()) {
      const event: MonitorEvent = {
        session_id: this.currentSession,
        kind: "edit",
        file_path: path,
        payload: { delta_chars: delta },
        client_at: new Date().toISOString(),
      };
      this.queue.push({
        session_id: event.session_id,
        kind: event.kind,
        file_path: event.file_path,
        payload: event.payload,
      });
      this.emit(event);
    }
    this.editAccum.clear();
    const batch = this.queue.splice(0, this.queue.length);
    if (batch.length === 0) return;
    api.recordEvents(batch).catch(() => {/* swallow — best-effort */});
  }
}

export const monitor = new Monitor();
