"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Circle, FileCode2, HelpCircle, NotebookPen } from "lucide-react";
import type {
  CandidateChallenge,
  ChallengeResponse,
  ObjectiveQuestion,
} from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export function ChallengePanel({
  challenges,
  activeChallengeId,
  responses,
  onSelectChallenge,
  onChangeStatus,
  onChangeAnswerText,
  onToggleObjectiveOption,
}: {
  challenges: CandidateChallenge[];
  activeChallengeId: string | null;
  responses: Record<string, ChallengeResponse>;
  onSelectChallenge: (challengeId: string) => void;
  onChangeStatus: (
    challengeId: string,
    status: "pending" | "in_progress" | "completed"
  ) => void;
  onChangeAnswerText: (challengeId: string, value: string) => void;
  onToggleObjectiveOption: (
    challengeId: string,
    question: ObjectiveQuestion,
    optionId: string
  ) => void;
}) {
  const active = challenges.find((challenge) => challenge.id === activeChallengeId) || challenges[0];
  const completedCount = challenges.filter(
    (challenge) => responses[challenge.id]?.status === "completed"
  ).length;
  const progressPct = challenges.length ? (completedCount / challenges.length) * 100 : 0;
  if (!active) {
    return <div className="p-5 text-sm text-bone/45">No challenges configured yet.</div>;
  }
  const response = responses[active.id];

  return (
    <div className="h-full grid grid-rows-[auto_1fr] min-h-0">
      <div className="border-b border-black/[0.06] p-3 space-y-2 bg-white/70">
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
          Challenge sequence
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-bone/45 mb-1">
            <span>Progress</span>
            <span>{completedCount}/{challenges.length}</span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.06] overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <div className="space-y-1.5">
          {challenges.map((challenge, idx) => {
            const itemResponse = responses[challenge.id];
            const activeItem = challenge.id === active.id;
            return (
              <button
                key={challenge.id}
                onClick={() => onSelectChallenge(challenge.id)}
                className={cn(
                  "w-full text-left rounded-xl border px-3 py-2 transition",
                  activeItem
                    ? "border-accent/40 bg-accent-soft/70"
                    : "border-black/[0.06] bg-white hover:border-black/15"
                )}
              >
                <div className="flex items-center gap-2">
                  {itemResponse?.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-mint shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-bone/30 shrink-0" />
                  )}
                  <span className="text-[11px] font-mono text-bone/45">
                    {idx + 1}.
                  </span>
                  <span className="text-sm text-bone truncate">{challenge.title}</span>
                </div>
                <div className="mt-1 ml-6 flex items-center gap-2">
                  <Badge tone={toneForKind(challenge.kind)}>{challenge.kind}</Badge>
                  <span className="text-[11px] text-bone/45">
                    {challenge.estimated_minutes} min
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-y-auto scrollbar-thin p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={toneForKind(active.kind)}>{active.kind}</Badge>
              <Badge>{active.priority}</Badge>
              {active.labels.slice(0, 3).map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold leading-snug">
              {active.title}
            </h2>
            <div className="mt-2 text-xs text-bone/50">
              Reporter {active.reporter} → {active.assignee}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusButton
              active={response?.status === "in_progress"}
              onClick={() => onChangeStatus(active.id, "in_progress")}
            >
              In progress
            </StatusButton>
            <StatusButton
              active={response?.status === "completed"}
              onClick={() => onChangeStatus(active.id, "completed")}
            >
              Complete
            </StatusButton>
          </div>
        </div>

        {active.description && (
          <p className="text-sm text-bone/75 leading-relaxed whitespace-pre-line">
            {active.description}
          </p>
        )}

        {active.instructions && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Instructions
            </div>
            <p className="text-sm text-bone/75 leading-relaxed whitespace-pre-line">
              {active.instructions}
            </p>
          </div>
        )}

        {active.acceptance_criteria.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Acceptance criteria
            </div>
            <ul className="space-y-2">
              {active.acceptance_criteria.map((criterion, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-bone/80">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-violet shrink-0" />
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {active.issues.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Issues to resolve
            </div>
            <div className="space-y-2">
              {active.issues.map((issue, idx) => (
                <div key={issue.id} className="rounded-xl border border-black/[0.06] bg-[#fcfbf7] p-3">
                  <div className="text-sm text-bone font-medium">
                    {idx + 1}. {issue.title}
                  </div>
                  <div className="mt-1 text-xs text-bone/55">{issue.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {active.related_files.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Related files
            </div>
            <div className="flex flex-wrap gap-2">
              {active.related_files.map((path) => (
                <span
                  key={path}
                  className="rounded-lg border border-black/[0.06] bg-white px-2 py-1 font-mono text-xs text-bone/65 inline-flex items-center gap-1"
                >
                  <FileCode2 className="h-3 w-3" />
                  {path}
                </span>
              ))}
            </div>
          </div>
        )}

        {active.kind === "theory" && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-4 space-y-3">
            <div className="text-sm font-medium inline-flex items-center gap-2">
              <NotebookPen className="h-4 w-4 text-accent" />
              Written response
            </div>
            {active.expected_response_format && (
              <div className="text-xs text-bone/45">{active.expected_response_format}</div>
            )}
            <textarea
              value={response?.answer_text || ""}
              onChange={(e) => onChangeAnswerText(active.id, e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-black/[0.08] bg-[#fcfbf7] px-3 py-3 text-sm outline-none focus:border-accent/50"
              placeholder="Write your explanation, rollout plan, and verification notes here..."
            />
          </div>
        )}

        {active.kind === "objective" && (
          <div className="space-y-4">
            {active.objective_questions.map((question) => (
              <div
                key={question.id}
                className="rounded-2xl border border-black/[0.06] bg-white p-4"
              >
                <div className="text-sm font-medium inline-flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-accent" />
                  {question.prompt}
                </div>
                <div className="mt-3 space-y-2">
                  {question.options.map((option) => {
                    const selected = !!response?.selected_option_ids?.[question.id]?.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        onClick={() => onToggleObjectiveOption(active.id, question, option.id)}
                        className={cn(
                          "w-full text-left rounded-xl border px-3 py-2 text-sm transition",
                          selected
                            ? "border-accent/40 bg-accent-soft/70 text-bone"
                            : "border-black/[0.06] bg-[#fcfbf7] hover:border-black/15 text-bone/75"
                        )}
                      >
                        <span className="font-mono text-[11px] text-bone/45 mr-2">
                          {option.id.toUpperCase()}.
                        </span>
                        {option.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs transition",
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-black/[0.08] bg-white text-bone/55 hover:text-bone"
      )}
    >
      {children}
    </button>
  );
}

function toneForKind(kind: CandidateChallenge["kind"]): "accent" | "violet" | "amber" | "default" {
  if (kind === "coding") return "accent";
  if (kind === "sql") return "amber";
  if (kind === "theory") return "violet";
  if (kind === "objective") return "amber";
  return "default";
}
