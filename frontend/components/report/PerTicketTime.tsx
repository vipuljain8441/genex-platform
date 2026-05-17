"use client";

import { AlertCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import type { TicketTimeSummary } from "@/lib/report-types";

function fmt(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export function PerTicketTime({ tickets }: { tickets: TicketTimeSummary[] }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          7b · Per-ticket time
        </div>

        {tickets.length === 0 ? (
          <div className="text-sm text-bone/55">
            No per-ticket focus events recorded for this session.
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const total = Math.max(t.total_seconds, 1);
              const activePct = (t.active_seconds / total) * 100;
              const idlePct = (t.idle_seconds / total) * 100;
              const aiPct = (t.ai_seconds / total) * 100;
              return (
                <div key={t.ticket_id} className="rounded-lg border border-black/[0.06] p-3">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-bone/85 truncate" title={t.ticket_title}>
                        {t.ticket_title}
                      </div>
                      <div className="font-mono text-[10px] text-bone/45 mt-0.5">
                        {t.ticket_id} · {t.story_points || "—"} pts · {t.focus_periods} visit{t.focus_periods === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="font-display text-base text-bone">{fmt(t.total_seconds)}</div>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-black/[0.06]">
                    <div className="bg-mint h-full" style={{ width: `${activePct}%` }} />
                    <div className="bg-amber h-full" style={{ width: `${idlePct}%` }} />
                    <div className="bg-accent h-full" style={{ width: `${aiPct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-bone/55">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-mint" />Active {fmt(t.active_seconds)}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" />Idle {fmt(t.idle_seconds)}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" />AI {fmt(t.ai_seconds)}</span>
                  </div>
                  {t.stuck_flag && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Extended idle on this ticket — candidate may have been stuck.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            Time accumulates while the ticket is in focus (panel open or related files being
            edited). Active = recent keystroke/mouse activity; Idle = ticket in focus but no
            input for &gt;30s; AI = AI panel was open while this ticket was the active context.
            Compare time spent against story points to gauge prioritisation instinct.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
