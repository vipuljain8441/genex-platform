"use client";

import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  ListChecks,
  Lock,
  Sparkles,
} from "lucide-react";
import type { CandidateChallenge, ChallengeResponse } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function ChallengeOverview({
  challenges,
  activeChallengeId,
  responses,
  onOpenChallenge,
}: {
  challenges: CandidateChallenge[];
  activeChallengeId: string | null;
  responses: Record<string, ChallengeResponse>;
  onOpenChallenge: (challengeId: string) => void;
}) {
  const completedCount = challenges.filter(
    (challenge) => responses[challenge.id]?.status === "completed"
  ).length;
  const inProgressCount = challenges.filter(
    (challenge) => responses[challenge.id]?.status === "in_progress"
  ).length;
  const pendingCount = Math.max(challenges.length - completedCount - inProgressCount, 0);
  const progressPct = challenges.length ? (completedCount / challenges.length) * 100 : 0;

  if (challenges.length === 0) {
    return (
      <div className="h-full grid place-items-center px-6 text-center text-bone/50">
        No challenges are available for this assessment yet.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(202,138,4,0.08),_transparent_35%),linear-gradient(180deg,_#f8f4ea_0%,_#f4efe4_100%)]">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-8 md:py-10 space-y-6">
        <section className="rounded-[28px] border border-black/[0.06] bg-white/90 p-6 shadow-card backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                Assessment overview
              </div>
              <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-bone md:text-4xl">
                Review every challenge before opening the workspace
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-bone/68 md:text-[15px]">
                Start from the challenge list, check the issues inside each task, and open them one by one.
                Coding and SQL challenges open their related workspace, while theory and objective tasks open their own focused response view.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 self-stretch lg:w-[360px]">
              <SummaryCard label="Solved" value={completedCount} tone="success" />
              <SummaryCard label="In progress" value={inProgressCount} tone="warm" />
              <SummaryCard label="Unsolved" value={pendingCount} tone="neutral" />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-black/[0.06] bg-[#fcfaf4] p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-bone/50">
              <span className="inline-flex items-center gap-2 uppercase tracking-[0.2em]">
                <ListChecks className="h-3.5 w-3.5" />
                Overall progress
              </span>
              <span className="font-mono text-bone/65">
                {completedCount}/{challenges.length} complete
              </span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-deep transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {challenges.map((challenge, idx) => {
            const response = responses[challenge.id];
            const status = response?.status || "pending";
            const isActive = challenge.id === activeChallengeId;
            const buttonLabel = isActive && status !== "pending" ? "Resume challenge" : "Open challenge";

            return (
              <article
                key={challenge.id}
                className={cn(
                  "rounded-[26px] border bg-white/92 p-5 shadow-card transition",
                  isActive ? "border-accent/30 shadow-glow" : "border-black/[0.06]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono uppercase tracking-[0.24em] text-bone/38">
                        Challenge {idx + 1}
                      </span>
                      <Badge tone={toneForKind(challenge.kind)}>{challenge.kind}</Badge>
                      <StatusBadge status={status} />
                    </div>
                    <h2 className="mt-3 font-display text-2xl font-semibold leading-tight text-bone">
                      {challenge.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-bone/66 whitespace-pre-line">
                      {challenge.description}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-black/[0.06] bg-[#faf6ec] px-3 py-2 text-right text-xs text-bone/48">
                    <div className="inline-flex items-center gap-1.5 font-mono">
                      <Clock3 className="h-3.5 w-3.5" />
                      {challenge.estimated_minutes} min
                    </div>
                    <div className="mt-1">{challenge.issues.length} issues</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {challenge.labels.slice(0, 3).map((label) => (
                    <Badge key={label}>{label}</Badge>
                  ))}
                  {!challenge.allow_buddy && (
                    <Badge tone="coral">
                      <Lock className="h-3 w-3" />
                      AI help locked
                    </Badge>
                  )}
                </div>

                {challenge.issues.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-black/[0.06] bg-[#fdfbf6] p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-bone/38">
                      Issues in this challenge
                    </div>
                    <div className="mt-3 space-y-2">
                      {challenge.issues.slice(0, 3).map((issue, issueIdx) => (
                        <div
                          key={issue.id}
                          className="rounded-xl border border-black/[0.05] bg-white px-3 py-2"
                        >
                          <div className="text-sm font-medium text-bone">
                            {issueIdx + 1}. {issue.title}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-bone/56">
                            {issue.description}
                          </div>
                        </div>
                      ))}
                      {challenge.issues.length > 3 && (
                        <div className="text-xs text-bone/45">
                          +{challenge.issues.length - 3} more issues inside this challenge
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-xs text-bone/48">
                    {status === "completed"
                      ? "This challenge is marked solved."
                      : status === "in_progress"
                        ? "You have started this challenge."
                        : "This challenge is still unsolved."}
                  </div>
                  <Button size="sm" onClick={() => onOpenChallenge(challenge.id)}>
                    {buttonLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warm" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        tone === "success" && "border-accent/20 bg-accent-soft/55 text-accent-deep",
        tone === "warm" && "border-amber/25 bg-amber/10 text-amber",
        tone === "neutral" && "border-black/[0.06] bg-white text-bone/75"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.2em]">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none">{value}</div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "pending" | "in_progress" | "completed";
}) {
  if (status === "completed") {
    return (
      <Badge tone="accent">
        <CheckCircle2 className="h-3 w-3" />
        Solved
      </Badge>
    );
  }

  if (status === "in_progress") {
    return (
      <Badge tone="amber">
        <Clock3 className="h-3 w-3" />
        In progress
      </Badge>
    );
  }

  return (
    <Badge>
      <Circle className="h-3 w-3" />
      Unsolved
    </Badge>
  );
}

function toneForKind(kind: CandidateChallenge["kind"]): "accent" | "violet" | "amber" | "default" {
  if (kind === "coding") return "accent";
  if (kind === "sql") return "amber";
  if (kind === "theory") return "violet";
  if (kind === "objective") return "amber";
  return "default";
}
