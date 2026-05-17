"use client";

import { Card, CardBody } from "@/components/ui/Card";
import type { IdleSummary, IdleTier } from "@/lib/report-types";

const TIER_LABEL: Record<IdleTier, string> = {
  think_pause: "Think pause",
  extended_idle: "Extended idle",
  inactive: "Inactive",
};

const TIER_BADGE: Record<IdleTier, string> = {
  think_pause: "bg-bone/10 text-bone/65",
  extended_idle: "bg-amber/15 text-amber",
  inactive: "bg-coral/15 text-coral",
};

function fmtDuration(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-ink-100/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-bone/45">{label}</div>
      <div className="font-display text-lg text-bone mt-0.5">{value}</div>
    </div>
  );
}

export function IdleAnalysis({ data }: { data: IdleSummary }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          7e · Idle analysis
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Total idle" value={fmtDuration(data.total_idle_seconds)} />
          <Stat label="Session %" value={`${data.idle_percentage}%`} />
          <Stat label="Think pauses" value={data.think_pause_count} />
          <Stat label="Inactive" value={data.inactive_count} />
        </div>

        {data.idle_after_ai_suggestion > 0 && (
          <div className="text-xs text-bone/65">
            <span className="font-mono text-accent">{data.idle_after_ai_suggestion}</span>{" "}
            idle period{data.idle_after_ai_suggestion === 1 ? "" : "s"} followed an AI suggestion —
            candidate was likely reviewing before applying.
          </div>
        )}

        {data.episodes.length === 0 ? (
          <div className="text-sm text-bone/55">
            No extended or inactive idle periods. Think pauses summarised above.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-bone/55">Notable idle periods (excludes think pauses)</div>
            {data.episodes.map((ep, i) => (
              <div
                key={i}
                className="rounded-lg border border-black/[0.06] p-3 text-xs"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TIER_BADGE[ep.tier]}`}
                    >
                      {TIER_LABEL[ep.tier]}
                    </span>
                    <span className="font-mono text-bone/55">{fmtTime(ep.at)}</span>
                  </div>
                  <span className="font-display text-base text-bone">{fmtDuration(ep.duration_seconds)}</span>
                </div>
                <div className="mt-1.5 text-bone/55">
                  After <span className="text-bone/75">{ep.preceding_activity}</span> · before{" "}
                  <span className="text-bone/75">{ep.following_activity}</span>
                </div>
                <div className="mt-1 text-bone/65 italic">{ep.note}</div>
              </div>
            ))}
          </div>
        )}

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            Idle is classified by duration: Think pause (15–60s, normal), Extended idle
            (1–5m, ambiguous), Inactive (&gt;5m, flag for attention). Context matters more
            than count — an idle period after an AI suggestion is review behaviour; idle
            mid-edit with no trigger could be confusion or distraction. Use these as
            recruiter context, not as a verdict.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
