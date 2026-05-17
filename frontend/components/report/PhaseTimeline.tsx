"use client";

import { AlertTriangle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import type { PhaseSummary, PhaseLabel } from "@/lib/report-types";

const PHASE_LABEL: Record<PhaseLabel, string> = {
  exploration: "Exploration",
  planning: "Planning",
  execution: "Execution",
  verification: "Verification",
};

const PHASE_COLOR: Record<PhaseLabel, string> = {
  exploration: "bg-sky",
  planning: "bg-accent",
  execution: "bg-mint",
  verification: "bg-peach",
};

const PHASE_TEXT: Record<PhaseLabel, string> = {
  exploration: "text-sky",
  planning: "text-accent",
  execution: "text-mint",
  verification: "text-peach",
};

function fmtMin(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

export function PhaseTimeline({ phases }: { phases: PhaseSummary }) {
  const total =
    phases.time_in_exploration +
    phases.time_in_planning +
    phases.time_in_execution +
    phases.time_in_verification || 1;

  const segments = phases.phases.map((p) => ({
    phase: p.phase,
    pct: (p.duration_seconds / total) * 100,
    label: p.phase,
  }));

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
            7a · Session phase timeline
          </div>
          {phases.phase_sequence && (
            <div className="font-mono text-[11px] text-bone/55">
              {phases.phase_sequence}
            </div>
          )}
        </div>

        {phases.phases.length === 0 ? (
          <div className="text-sm text-bone/55">
            Session too short to classify into phases (need at least 60 seconds of activity).
          </div>
        ) : (
          <>
            <div className="flex h-8 rounded-lg overflow-hidden border border-black/[0.05]">
              {segments.map((s, i) => (
                <div
                  key={i}
                  className={`${PHASE_COLOR[s.phase]} flex items-center justify-center text-[10px] text-white`}
                  style={{ width: `${s.pct}%` }}
                  title={`${PHASE_LABEL[s.phase]} · ${fmtMin(phases.phases[i].duration_seconds)}`}
                >
                  {s.pct > 10 ? PHASE_LABEL[s.phase] : ""}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {(["exploration", "planning", "execution", "verification"] as PhaseLabel[]).map(
                (k) => {
                  const v = {
                    exploration: phases.time_in_exploration,
                    planning: phases.time_in_planning,
                    execution: phases.time_in_execution,
                    verification: phases.time_in_verification,
                  }[k];
                  return (
                    <div
                      key={k}
                      className="rounded-lg border border-black/[0.06] bg-ink-100/60 px-3 py-2"
                    >
                      <div className="text-[10px] uppercase tracking-wider text-bone/45">
                        {PHASE_LABEL[k]}
                      </div>
                      <div className={`font-display text-lg mt-0.5 ${PHASE_TEXT[k]}`}>
                        {fmtMin(v)}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5">
          {!phases.exploration_before_execution && phases.phases.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>Candidate started coding without an exploration phase.</span>
            </div>
          )}
          {!phases.has_verification_phase && phases.phases.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                No verification phase detected — candidate did not test or review before submitting.
              </span>
            </div>
          )}
        </div>

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            Phases are derived from 2-minute windows of activity. Exploration = file reads
            with few edits; Planning = think pauses + architectural AI prompts; Execution =
            sustained keystrokes and edits; Verification = terminal/commit activity. The
            sequence shows the candidate&apos;s workflow shape — senior engineers usually
            explore before executing and verify before submitting.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
