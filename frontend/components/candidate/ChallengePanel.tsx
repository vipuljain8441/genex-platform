"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  Circle,
  Code2,
  FileCode2,
  HelpCircle,
  Loader2,
  NotebookPen,
  Play,
  TableProperties,
} from "lucide-react";
import type {
  CandidateChallenge,
  ChallengeResponse,
  ObjectiveQuestion,
} from "@/lib/api";
import type { SqlResult } from "./Workspace";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export function ChallengePanel({
  challenges,
  activeChallengeId,
  responses,
  sqlResults = {},
  onSelectChallenge,
  onChangeStatus,
  onChangeAnswerText,
  onToggleObjectiveOption,
  onRunSQL,
  showSelector = true,
}: {
  challenges: CandidateChallenge[];
  activeChallengeId: string | null;
  responses: Record<string, ChallengeResponse>;
  sqlResults?: Record<string, SqlResult>;
  onSelectChallenge: (challengeId: string) => void;
  onChangeStatus: (challengeId: string, status: "pending" | "in_progress" | "completed") => void;
  onChangeAnswerText: (challengeId: string, value: string) => void;
  onToggleObjectiveOption: (challengeId: string, question: ObjectiveQuestion, optionId: string) => void;
  onRunSQL?: (challengeId: string, query: string) => void;
  showSelector?: boolean;
}) {
  const active = challenges.find((c) => c.id === activeChallengeId) || challenges[0];
  const completedCount = challenges.filter((c) => responses[c.id]?.status === "completed").length;
  const progressPct = challenges.length ? (completedCount / challenges.length) * 100 : 0;

  if (!active) {
    return <div className="p-5 text-sm text-bone/45">No challenges configured yet.</div>;
  }

  const response = responses[active.id];
  const sqlResult = sqlResults[active.id];

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0 bg-transparent">
      {/* Compact challenge selector */}
      {showSelector && (
      <div className="flex-shrink-0 border-b border-[#decba9]/80 px-3 py-2 bg-[linear-gradient(180deg,_rgba(255,251,243,0.98)_0%,_rgba(252,245,232,0.94)_100%)] space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-[#e8dcc7] overflow-hidden">
            <div
              className="h-full bg-[linear-gradient(90deg,_#d5884f_0%,_#f0b56f_100%)] transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-bone/50 shrink-0">
            {completedCount}/{challenges.length}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-thin -mx-1 px-1 pb-0.5">
          {challenges.map((challenge, idx) => {
            const itemResponse = responses[challenge.id];
            const activeItem = challenge.id === active.id;
            return (
              <button
                key={challenge.id}
                onClick={() => onSelectChallenge(challenge.id)}
                title={challenge.title}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition shrink-0",
                  activeItem
                    ? "border-accent/40 bg-[linear-gradient(180deg,_rgba(248,214,168,0.72)_0%,_rgba(255,244,226,0.92)_100%)] text-bone"
                    : "border-[#eadbc4] bg-white/92 hover:border-[#d6bb93] text-bone/70"
                )}
              >
                {itemResponse?.status === "completed" ? (
                  <CheckCircle2 className="h-3 w-3 text-mint shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 text-bone/30 shrink-0" />
                )}
                <span className="font-mono text-[11px] text-bone/55">{idx + 1}</span>
                <span className="max-w-[120px] truncate">{challenge.title}</span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Active challenge detail */}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin p-3 sm:p-4 space-y-4 bg-[linear-gradient(180deg,_rgba(255,252,246,0.86)_0%,_rgba(250,243,232,0.82)_100%)]">
        <div className="space-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge tone={toneForKind(active.kind)}>{active.kind}</Badge>
              <Badge>{active.priority}</Badge>
              {(active.labels ?? []).slice(0, 3).map((label, i) => {
                const text = typeof label === "string" ? label : String(label ?? "");
                return text ? <Badge key={`${text}-${i}`}>{text}</Badge> : null;
              })}
            </div>
            <h2 className="mt-2 font-display text-lg sm:text-xl font-semibold leading-snug break-words">
              {active.title}
            </h2>
            <div className="mt-1 text-xs text-bone/50 break-words">
              Reporter {active.reporter} → {active.assignee}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
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
          <p className="text-sm text-bone/75 leading-relaxed whitespace-pre-line break-words">{active.description}</p>
        )}

        {active.instructions && (
          <div className="rounded-2xl border border-[#e2d1b4] bg-white/95 p-3 sm:p-4 shadow-[0_10px_24px_rgba(74,57,27,0.05)]">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">Instructions</div>
            <p className="text-sm text-bone/75 leading-relaxed whitespace-pre-line break-words">{active.instructions}</p>
          </div>
        )}

        {active.acceptance_criteria.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">Acceptance criteria</div>
            <ul className="space-y-2">
              {active.acceptance_criteria.map((criterion, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-bone/80">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-violet shrink-0" />
                  <span className="min-w-0 break-words">{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {active.issues.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">Issues to resolve</div>
            <div className="space-y-2">
              {active.issues.map((issue, idx) => (
                <div key={issue.id} className="rounded-xl border border-[#e5d6bf] bg-[linear-gradient(180deg,_#fffdf8_0%,_#f9f2e7_100%)] p-3 shadow-[0_8px_20px_rgba(84,62,28,0.04)]">
                  <div className="text-sm text-bone font-medium break-words">{idx + 1}. {issue.title}</div>
                  <div className="mt-1 text-xs text-bone/55 break-words">{issue.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {active.related_files.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">Related files</div>
            <div className="flex flex-wrap gap-2">
              {active.related_files.map((path) => (
                <span
                  key={path}
                  className="rounded-lg border border-[#dfceb3] bg-white/92 px-2 py-1 font-mono text-xs text-bone/65 inline-flex items-center gap-1"
                >
                  <FileCode2 className="h-3 w-3" />
                  {path}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Theory response ── */}
        {active.kind === "theory" && (
          <div className="rounded-2xl border border-[#e2d1b4] bg-white/95 p-3 sm:p-4 space-y-3 shadow-[0_10px_24px_rgba(74,57,27,0.05)]">
            <div className="flex items-center gap-2 text-sm font-medium">
              <NotebookPen className="h-4 w-4 shrink-0 text-accent" />
              <span>Written response</span>
            </div>
            {active.expected_response_format && (
              <div className="text-xs text-bone/45 break-words">{active.expected_response_format}</div>
            )}
            <textarea
              value={response?.answer_text || ""}
              onChange={(e) => onChangeAnswerText(active.id, e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-[#e1d1b6] bg-[#fffcf6] px-3 py-3 text-sm outline-none focus:border-accent/50 resize-y min-h-[120px]"
              placeholder="Write your explanation here…"
            />
          </div>
        )}

        {/* ── SQL challenge ── */}
        {active.kind === "sql" && (
          <SQLEditor
            challengeId={active.id}
            expectedFormat={active.expected_response_format}
            answer={response?.answer_text || ""}
            result={sqlResult}
            onChangeAnswer={(v) => onChangeAnswerText(active.id, v)}
            onRun={onRunSQL ? (q) => onRunSQL(active.id, q) : undefined}
          />
        )}

        {/* ── Objective questions ── */}
        {active.kind === "objective" && (
          <div className="space-y-3">
            {active.objective_questions.map((question) => (
              <div key={question.id} className="rounded-2xl border border-black/[0.06] bg-white p-3 sm:p-4">
                <div className="flex items-start gap-2 text-sm font-medium">
                  <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
                  <span className="break-words min-w-0">{question.prompt}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {question.options.map((option) => {
                    const selected = !!response?.selected_option_ids?.[question.id]?.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        onClick={() => onToggleObjectiveOption(active.id, question, option.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                          selected
                            ? "border-accent/40 bg-accent-soft/70 text-bone"
                            : "border-black/[0.06] bg-[#fcfbf7] hover:border-black/15 text-bone/75"
                        )}
                      >
                        <span className="font-mono text-[11px] text-bone/45 mt-0.5 shrink-0">
                          {option.id.toUpperCase()}.
                        </span>
                        <span className="min-w-0 flex-1 break-words">{option.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Coding hint ── */}
        {active.kind === "coding" && (
          <div className="rounded-xl border border-black/[0.06] bg-[#f6f3ea]/60 p-4 text-sm text-bone/60 space-y-1">
            <div className="flex items-center gap-2 font-medium text-bone/80">
              <Code2 className="h-4 w-4" />
              VS Code Workspace
            </div>
            <p>Edit your files in the VS Code editor. The integrated terminal supports Python, Node.js, SQLite, and Git.</p>
            <p className="text-xs text-bone/48">The workspace also shows a sandbox guide above the editor with DB path, guide file, and starter terminal commands.</p>
            {active.related_files.length > 0 && (
              <p className="text-xs text-bone/45">
                Start with: {active.related_files.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SQL Editor component ────────────────────────────────────────────────────────

function SQLEditor({
  challengeId,
  expectedFormat,
  answer,
  result,
  onChangeAnswer,
  onRun,
}: {
  challengeId: string;
  expectedFormat?: string | null;
  answer: string;
  result?: SqlResult;
  onChangeAnswer: (v: string) => void;
  onRun?: (query: string) => void;
}) {
  const [query, setQuery] = useState(answer);

  function handleChange(v: string) {
    setQuery(v);
    onChangeAnswer(v);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-black/[0.06] bg-white p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Code2 className="h-4 w-4 shrink-0 text-amber" />
            <span>SQL Query</span>
          </div>
          {onRun && (
            <button
              onClick={() => onRun(query)}
              disabled={result?.running || !query.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber/10 border border-amber/30 px-3 py-1.5 text-xs font-medium text-amber hover:bg-amber/20 disabled:opacity-50 transition"
            >
              {result?.running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run SQL
            </button>
          )}
        </div>
        {expectedFormat && (
          <div className="text-xs text-bone/45 break-words">{expectedFormat}</div>
        )}
        <textarea
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          rows={6}
          className="w-full rounded-xl border border-black/[0.08] bg-[#0d1117] text-[#e6edf3] px-3 py-3 text-sm font-mono outline-none focus:border-amber/50 resize-y min-h-[140px]"
          placeholder={"SELECT\n  ...\nFROM\n  ...\nWHERE\n  ..."}
          spellCheck={false}
        />
      </div>

      {/* SQL Results */}
      {result && !result.running && (
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TableProperties className="h-4 w-4 text-accent" />
            {result.error ? (
              <span className="text-coral">Query Error</span>
            ) : (
              <span>Results <span className="text-bone/45 font-normal">({result.rowcount} row{result.rowcount !== 1 ? "s" : ""})</span></span>
            )}
          </div>

          {result.error ? (
            <pre className="text-xs text-coral bg-coral/5 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
              {result.error}
            </pre>
          ) : result.columns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {result.columns.map((col) => (
                      <th key={col} className="text-left px-2 py-1.5 font-mono text-bone/50 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-transparent" : "bg-black/[0.02]"}>
                      {result.columns.map((col) => (
                        <td key={col} className="px-2 py-1.5 text-bone/80 font-mono truncate max-w-[200px]">
                          {row[col] === null ? <span className="text-bone/30 italic">null</span> : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 100 && (
                <p className="text-xs text-bone/40 mt-2">Showing first 100 of {result.rowcount} rows</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-bone/40">Query executed successfully. {result.rowcount} row{result.rowcount !== 1 ? "s" : ""} affected.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Status button ──────────────────────────────────────────────────────────────

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
