"use client";

import { monitor } from "./monitor";

// Activity categories that idle_start/idle_end events record as context for the
// preceding/following actions. Keep this aligned with the backend's
// `_interpret_idle` heuristic in services/behaviour.py.
export type ActivityKind = "editor" | "ai" | "terminal" | "ticket" | "git" | "submit" | "none";

export type PanelName = "editor" | "tickets" | "ai" | "terminal" | "git" | "strategy" | "explorer" | "search";

type SpecialKey = "undo" | "save" | "copy" | "paste" | "delete";

interface KeystrokeBucket {
  count: number;
  intervals: number[];
  pauses: number;
  special: Record<SpecialKey, number>;
  startedAt: number;
}

interface TicketTimer {
  ticketId: string;
  startTime: number;
  lastActivityTime: number;
  activeMs: number;
  idleMs: number;
  aiMs: number;
}

const IDLE_THRESHOLD_MS = 15_000;
const TICK_MS = 5_000;
const KEYSTROKE_FLUSH_MS = 10_000;

function emptyBucket(): KeystrokeBucket {
  return {
    count: 0,
    intervals: [],
    pauses: 0,
    special: { undo: 0, save: 0, copy: 0, paste: 0, delete: 0 },
    startedAt: Date.now(),
  };
}

class BehaviourTracker {
  private running = false;
  private lastActivityAt = 0;
  private lastEventType = "session_start";
  private currentActivity: ActivityKind = "none";
  private currentPanel: PanelName | null = null;
  private currentFile: string | null = null;
  private idleStartAt: number | null = null;
  private idleStartActivity: ActivityKind = "none";
  private idleStartFile: string | null = null;
  private bucket: KeystrokeBucket = emptyBucket();
  private bucketTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private ticketTimer: TicketTimer | null = null;
  private lastKeystrokeAt = 0;
  private pendingWindowBlurAt: number | null = null;

  start() {
    if (this.running) return;
    this.running = true;
    this.lastActivityAt = Date.now();
    this.idleTimer = setInterval(() => this.tickIdle(), TICK_MS);
    this.bucketTimer = setInterval(() => this.flushBucket(), KEYSTROKE_FLUSH_MS);

    if (typeof window !== "undefined") {
      window.addEventListener("blur", this.onWindowBlur);
      window.addEventListener("focus", this.onWindowFocus);
      document.addEventListener("mousedown", this.onMouseActivity, { passive: true });
      document.addEventListener("scroll", this.onMouseActivity, { passive: true, capture: true });
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.bucketTimer) clearInterval(this.bucketTimer);
    this.idleTimer = this.bucketTimer = null;
    this.flushBucket();
    this.closeTicket();
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", this.onWindowBlur);
      window.removeEventListener("focus", this.onWindowFocus);
      document.removeEventListener("mousedown", this.onMouseActivity);
      document.removeEventListener("scroll", this.onMouseActivity, { capture: true } as EventListenerOptions);
    }
  }

  // Called by any code path that represents the candidate doing something:
  // typing, clicking, scrolling, switching panels, prompting AI, etc.
  markActivity(kind: ActivityKind, eventType: string = "activity", file: string | null = null) {
    const now = Date.now();
    if (this.idleStartAt !== null) {
      const durationMs = now - this.idleStartAt;
      if (durationMs >= IDLE_THRESHOLD_MS) {
        const durationSec = Math.floor(durationMs / 1000);
        const tier =
          durationSec < 60 ? "think_pause" : durationSec < 300 ? "extended_idle" : "inactive";
        monitor.event("idle_end", this.currentFile, {
          duration_seconds: durationSec,
          tier,
          following_event_type: eventType,
          following_activity: kind,
        });
      }
      this.idleStartAt = null;
    }
    this.lastActivityAt = now;
    this.lastEventType = eventType;
    this.currentActivity = kind;
    if (file) this.currentFile = file;
    if (this.ticketTimer) this.ticketTimer.lastActivityTime = now;
  }

  setPanel(panel: PanelName, file: string | null = null) {
    if (panel === this.currentPanel) return;
    const previous = this.currentPanel;
    this.currentPanel = panel;
    if (file !== null) this.currentFile = file;
    monitor.event("panel_focus_change", file ?? this.currentFile, {
      panel,
      from_panel: previous ?? "none",
    });
    // Map panel to activity kind for idle context.
    const map: Record<PanelName, ActivityKind> = {
      editor: "editor",
      tickets: "ticket",
      ai: "ai",
      terminal: "terminal",
      git: "git",
      strategy: "none",
      explorer: "editor",
      search: "editor",
    };
    this.markActivity(map[panel], "panel_focus_change", file);
  }

  setTicket(ticketId: string | null) {
    if (this.ticketTimer && this.ticketTimer.ticketId === ticketId) return;
    this.closeTicket();
    if (ticketId) {
      this.ticketTimer = {
        ticketId,
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        activeMs: 0,
        idleMs: 0,
        aiMs: 0,
      };
      monitor.event("ticket_focus_start", null, { ticket_id: ticketId });
    }
  }

  recordKeystroke(special?: SpecialKey) {
    const now = Date.now();
    const interval = this.lastKeystrokeAt > 0 ? now - this.lastKeystrokeAt : 0;
    if (interval > 2000 && this.lastKeystrokeAt > 0) this.bucket.pauses += 1;
    this.bucket.intervals.push(interval);
    this.bucket.count += 1;
    this.lastKeystrokeAt = now;
    if (special) this.bucket.special[special] += 1;
    this.markActivity("editor", "keystroke", this.currentFile);
  }

  recordPaste(file: string, characterCount: number, contentHash: string) {
    monitor.event("content_paste", file, {
      file,
      character_count: characterCount,
      content_hash: contentHash,
      source_type: "clipboard",
    });
    this.bucket.special.paste += 1;
    this.markActivity("editor", "content_paste", file);
  }

  private onWindowBlur = () => {
    if (!this.running) return;
    this.pendingWindowBlurAt = Date.now();
    monitor.event("window_blur", this.currentFile, {
      active_panel: this.currentPanel,
    });
  };

  private onWindowFocus = () => {
    if (!this.running) return;
    const blurDur = this.pendingWindowBlurAt
      ? Math.floor((Date.now() - this.pendingWindowBlurAt) / 1000)
      : 0;
    this.pendingWindowBlurAt = null;
    monitor.event("window_focus", this.currentFile, {
      blur_duration_seconds: blurDur,
    });
    this.markActivity(this.currentActivity, "window_focus", this.currentFile);
  };

  private onMouseActivity = () => {
    this.markActivity(this.currentActivity, "mouse_or_scroll", this.currentFile);
  };

  private tickIdle() {
    const now = Date.now();
    const sinceActivity = now - this.lastActivityAt;

    if (sinceActivity >= IDLE_THRESHOLD_MS && this.idleStartAt === null) {
      this.idleStartAt = this.lastActivityAt + IDLE_THRESHOLD_MS;
      this.idleStartActivity = this.currentActivity;
      this.idleStartFile = this.currentFile;
      monitor.event("idle_start", this.idleStartFile, {
        preceding_event_type: this.lastEventType,
        preceding_activity: this.idleStartActivity,
        preceding_file: this.idleStartFile,
      });
    }

    if (!this.ticketTimer) return;
    const sinceTicketActivity = now - this.ticketTimer.lastActivityTime;
    if (sinceTicketActivity < 30_000) {
      this.ticketTimer.activeMs += TICK_MS;
    } else {
      this.ticketTimer.idleMs += TICK_MS;
    }
    if (this.currentActivity === "ai") {
      this.ticketTimer.aiMs += TICK_MS;
    }
  }

  private flushBucket() {
    if (this.bucket.count === 0) return;
    const totalMs = Date.now() - this.bucket.startedAt;
    const seconds = Math.max(totalMs / 1000, 1);
    const wpm = Math.round((this.bucket.count * 6) / seconds);
    let burstScore = 0;
    if (this.bucket.intervals.length > 1) {
      const mean =
        this.bucket.intervals.reduce((a, b) => a + b, 0) / this.bucket.intervals.length;
      const variance =
        this.bucket.intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        this.bucket.intervals.length;
      burstScore = Math.min(1, Math.sqrt(variance) / 500);
    }
    monitor.event("keystroke_bucket", this.currentFile, {
      count: this.bucket.count,
      wpm,
      burst_score: Number(burstScore.toFixed(3)),
      pause_count: this.bucket.pauses,
      special_keys: { ...this.bucket.special },
      active_file: this.currentFile,
    });
    this.bucket = emptyBucket();
  }

  private closeTicket() {
    if (!this.ticketTimer) return;
    const now = Date.now();
    const total = now - this.ticketTimer.startTime;
    monitor.event("ticket_focus_end", null, {
      ticket_id: this.ticketTimer.ticketId,
      duration_seconds: Math.floor(total / 1000),
      active_seconds: Math.floor(this.ticketTimer.activeMs / 1000),
      idle_seconds: Math.floor(this.ticketTimer.idleMs / 1000),
      ai_seconds: Math.floor(this.ticketTimer.aiMs / 1000),
    });
    this.ticketTimer = null;
  }
}

export const behaviourTracker = new BehaviourTracker();

// Browser-safe hash for content_paste payloads. Uses SubtleCrypto when
// available; falls back to a fast non-cryptographic mixer (only for dedup).
export async function hashContent(content: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      return Array.from(new Uint8Array(buf))
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // fall through
    }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
