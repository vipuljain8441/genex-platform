"use client";

import { Card, CardBody } from "@/components/ui/Card";
import type { FocusPatternSummary } from "@/lib/report-types";

const PANEL_LABEL: Record<string, string> = {
  editor: "Editor",
  tickets: "Tickets",
  ai: "AI",
  terminal: "Terminal",
  git: "Git",
  strategy: "Strategy",
  unknown: "Unknown",
};

function fmt(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-ink-100/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-bone/45">{label}</div>
      <div className="font-display text-lg text-bone mt-0.5">{value}</div>
    </div>
  );
}

export function PanelFlow({ data }: { data: FocusPatternSummary }) {
  const panelEntries = Object.entries(data.panel_time)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalPanelSeconds = panelEntries.reduce((acc, [, s]) => acc + s, 0) || 1;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          7f · Panel flow
        </div>

        {panelEntries.length === 0 && data.transitions.length === 0 ? (
          <div className="text-sm text-bone/55">No panel-focus events recorded for this session.</div>
        ) : (
          <>
            {panelEntries.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-bone/55">Time per panel</div>
                {panelEntries.map(([panel, seconds]) => {
                  const pct = (seconds / totalPanelSeconds) * 100;
                  return (
                    <div key={panel}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-bone/75">{PANEL_LABEL[panel] || panel}</span>
                        <span className="font-mono text-bone/55">{fmt(seconds)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Ticket re-reads" value={data.ticket_rereads} />
              <Stat label="Longest editor stretch" value={fmt(data.longest_editor_stretch_seconds)} />
              <Stat label="Window blurs" value={data.window_blur_count} />
              <Stat label="Time off-tab" value={fmt(data.window_blur_total_seconds)} />
            </div>

            {data.transitions.length > 0 && (
              <div>
                <div className="text-xs text-bone/55 mb-2">Most common panel transitions</div>
                <div className="space-y-1 text-xs">
                  {data.transitions.slice(0, 6).map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md bg-ink-100/60 px-2.5 py-1.5"
                    >
                      <span className="text-bone/75">
                        {PANEL_LABEL[t.from] || t.from}
                        <span className="text-bone/40 mx-1.5">→</span>
                        {PANEL_LABEL[t.to] || t.to}
                      </span>
                      <span className="font-mono text-bone/55">{t.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            The panel transition counts are the candidate&apos;s workflow fingerprint. Frequent
            Editor → Ticket transitions show a candidate who re-reads requirements before coding.
            Frequent AI → Editor without going back to the ticket can mean confident execution —
            or skipped context. Window blurs may be reading documentation or may be a distraction;
            duration is the differentiator.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
