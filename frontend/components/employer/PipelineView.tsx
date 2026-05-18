"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Loader2, AlertTriangle, Sparkles, ExternalLink,
} from "lucide-react";
import {
  api, streamAssessment, type Assessment, type AssessmentFeedbackSummary, type AssessmentSessionSummary, type PipelineStage,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn, shortId } from "@/lib/utils";
import { InviteCard } from "./InviteCard";

const STAGES: { key: PipelineStage; label: string; agent: string }[] = [
  { key: "fetching", label: "Fetching GitHub repository", agent: "GitHub Fetcher" },
  { key: "extracting", label: "Reading PM tool / context", agent: "Extractor" },
  { key: "authoring", label: "Generating production codebase", agent: "Code Author" },
  { key: "ticketing", label: "Drafting candidate ticket", agent: "Ticket Author" },
  { key: "challenging", label: "Designing challenge sequence", agent: "Challenge Architect" },
  { key: "injecting", label: "Planting realistic defects", agent: "Bug Injector" },
  { key: "ready", label: "Assessment ready", agent: "—" },
];

const ORDER: PipelineStage[] = [
  "pending", "fetching", "extracting", "authoring", "ticketing", "challenging", "injecting", "ready",
];

type AssessmentViewTab = "overview" | "sessions" | "feedback";
type AssessmentTabConfig = {
  key: AssessmentViewTab;
  label: string;
  count?: number;
  readyOnly?: boolean;
};

function stageIndex(s: PipelineStage) {
  return ORDER.indexOf(s);
}

export function PipelineView({ initial }: { initial: Assessment }) {
  const [a, setA] = useState<Assessment>(initial);
  const [sessions, setSessions] = useState<AssessmentSessionSummary[]>([]);
  const [feedback, setFeedback] = useState<AssessmentFeedbackSummary[]>([]);
  const [activeTab, setActiveTab] = useState<AssessmentViewTab>("overview");

  useEffect(() => {
    const close = streamAssessment(initial.id, setA);
    const poll = setInterval(async () => {
      try { setA(await api.getAssessment(initial.id)); } catch {}
    }, 4000);
    return () => { close(); clearInterval(poll); };
  }, [initial.id]);

  useEffect(() => {
    if (a.status.stage !== "ready") return;
    let cancelled = false;
    const load = async () => {
      try {
        const [sessionData, feedbackData] = await Promise.all([
          api.listAssessmentSessions(initial.id),
          api.listAssessmentFeedback(initial.id),
        ]);
        if (!cancelled) {
          setSessions(sessionData);
          setFeedback(feedbackData);
        }
      } catch {}
    };
    load();
    const poll = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [a.status.stage, initial.id]);

  const cur = a.status.stage;
  const failed = cur === "failed";
  const ready = cur === "ready";
  const tabs: AssessmentTabConfig[] = [
    { key: "overview", label: "Overview" },
    { key: "sessions", label: "Candidate Sessions", count: sessions.length, readyOnly: true },
    { key: "feedback", label: "Feedback", count: feedback.length, readyOnly: true },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <Badge tone="accent">#{shortId(a.id)}</Badge>
            <Badge tone={failed ? "coral" : ready ? "accent" : "violet"}>
              {a.status.stage}
            </Badge>
          </div>
          <h1 className="mt-3 font-display text-3xl md:text-4xl tracking-tight font-semibold">
            {a.job.title}
          </h1>
          <p className="mt-1 text-bone/55 text-sm capitalize">
            {a.job.role_family} · {a.job.seniority}
            {(a.job as any).industry ? ` · ${(a.job as any).industry}` : ""}
            {" "}· {a.job.duration_minutes} min
            {" "}· {(a.job as any).codebase_source === "github" ? "GitHub repo" : "AI-generated"}
          </p>
        </div>

        {ready && a.candidate_ticket && (
          <Link href={`/candidate/start?aid=${a.id}`}>
            <Button variant="outline" size="sm">
              <Sparkles className="h-4 w-4" /> Preview as candidate
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardBody className="py-4">
          <div className="flex items-center gap-2 flex-wrap">
            {tabs.map((tab) => {
              if (tab.readyOnly && !ready) return null;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium tracking-tight transition",
                    isActive
                      ? "border-accent/35 bg-accent/[0.07] text-accent shadow-card"
                      : "border-black/[0.06] bg-black/[0.02] text-bone/65 hover:bg-black/[0.04] hover:text-bone"
                  )}
                >
                  <span>{tab.label}</span>
                  {typeof tab.count === "number" && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px]",
                        isActive ? "bg-accent/12 text-accent" : "bg-black/[0.05] text-bone/55"
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {activeTab === "overview" && (
        <>
          <Card>
            <CardBody>
              <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-5">
                Pipeline
              </div>
              <ol className="space-y-3">
                {STAGES.map((s, idx) => {
                  const curIdx = stageIndex(cur);
                  const sIdx = stageIndex(s.key);
                  const isCurrent = !failed && !ready && s.key === cur;
                  const done = ready || (sIdx < curIdx) || (sIdx <= curIdx && curIdx === ORDER.length - 1);
                  return (
                    <li
                      key={s.key}
                      className={cn(
                        "flex items-center gap-4 rounded-xl border px-4 py-3 transition",
                        isCurrent && "border-accent/40 bg-accent/[0.04]",
                        done && !isCurrent && "border-black/[0.06] bg-black/[0.02]",
                        !done && !isCurrent && "border-black/[0.04] bg-transparent opacity-50"
                      )}
                    >
                      <div className="w-7 h-7 grid place-items-center rounded-full border border-black/[0.08] shrink-0">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        ) : isCurrent ? (
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        ) : (
                          <span className="text-xs text-bone/30">{idx + 1}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm">{s.label}</div>
                        <div className="text-[11px] uppercase tracking-wider text-bone/40">
                          {s.agent}
                        </div>
                      </div>
                      <AnimatePresence>
                        {isCurrent && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-xs text-accent/80 max-w-xs truncate"
                          >
                            {a.status.detail}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ol>

              {failed && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-coral/40 bg-coral/10 p-4 text-sm text-coral">
                  <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Pipeline failed</div>
                    <div className="opacity-80">{a.status.detail}</div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {ready && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <InviteCard assessmentId={a.id} />
            </motion.div>
          )}

          {ready && a.candidate_challenges?.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardBody>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
                    Challenge sequence
                  </div>
                  <div className="space-y-3">
                    {a.candidate_challenges.map((challenge, idx) => (
                      <div
                        key={challenge.id}
                        className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge>{idx + 1}</Badge>
                          <Badge tone={challenge.kind === "coding" ? "accent" : challenge.kind === "theory" ? "violet" : challenge.kind === "sql" ? "amber" : "default"}>
                            {challenge.kind}
                          </Badge>
                          <span className="text-xs text-bone/45">
                            {challenge.estimated_minutes} min
                          </span>
                        </div>
                        <div className="mt-2 font-medium text-bone">{challenge.title}</div>
                        <p className="mt-1 text-sm text-bone/65 leading-relaxed whitespace-pre-line">
                          {challenge.description || challenge.instructions}
                        </p>
                        {challenge.issues?.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {challenge.issues.map((issue) => (
                              <li key={issue.id} className="text-xs text-bone/55">
                                • {issue.title}: {issue.description}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {ready && a.candidate_ticket && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardBody>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
                    Primary coding ticket
                  </div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge tone="coral">{a.candidate_ticket.priority}</Badge>
                    {a.candidate_ticket.labels.map((l) => (
                      <Badge key={l}>{l}</Badge>
                    ))}
                  </div>
                  <div className="font-display text-xl font-semibold">{a.candidate_ticket.title}</div>
                  <p className="mt-2 text-sm text-bone/65 leading-relaxed whitespace-pre-line">
                    {a.candidate_ticket.description}
                  </p>
                  <div className="mt-4 text-xs uppercase tracking-[0.22em] text-bone/40">
                    Acceptance criteria
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {a.candidate_ticket.acceptance_criteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-bone/75">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-violet" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {ready && a.buggy_codebase && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
                    Generated artifact ({a.buggy_codebase.files.length} files)
                  </div>
                  <Link
                    href={`/candidate/start?aid=${a.id}`}
                    className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                  >
                    Open workspace <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.buggy_codebase.files.map((f) => (
                    <span
                      key={f.path}
                      className="font-mono text-xs px-2 py-1 rounded-md bg-black/[0.04] border border-black/[0.06]"
                    >
                      {f.path}
                    </span>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {ready && activeTab === "sessions" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
                    Candidate sessions
                  </div>
                  <p className="mt-2 text-sm text-bone/60">
                    Employer-only access to submitted sessions and reports for this assessment.
                  </p>
                </div>
                <Badge>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {sessions.length === 0 ? (
                  <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-5 text-sm text-bone/50">
                    No candidates have started this assessment yet.
                  </div>
                ) : sessions.map((session) => (
                  <div
                    key={session.session_id}
                    className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-medium text-bone">{session.candidate_name}</div>
                        <div className="mt-1 text-xs text-bone/45 font-mono">{session.session_id}</div>
                        <div className="mt-2 text-xs text-bone/50">
                          Started {new Date(session.started_at).toLocaleString()}
                          {session.submitted_at ? ` · Submitted ${new Date(session.submitted_at).toLocaleString()}` : " · In progress"}
                        </div>
                      </div>
                      {session.has_evaluation ? (
                        <Link href={session.report_url}>
                          <Button size="sm" variant="outline">
                            Open preview
                          </Button>
                        </Link>
                      ) : (
                        <Badge tone="violet">Evaluating / active</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}

      {ready && activeTab === "feedback" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
                    Candidate feedback
                  </div>
                  <p className="mt-2 text-sm text-bone/60">
                    Notes, issues, and concerns candidates submitted during the assessment.
                  </p>
                </div>
                <Badge tone={feedback.length > 0 ? "amber" : "default"}>
                  {feedback.length} item{feedback.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="mt-4 space-y-3">
                {feedback.length === 0 ? (
                  <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-5 text-sm text-bone/50">
                    No candidate feedback has been submitted for this assessment yet.
                  </div>
                ) : feedback.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-bone">{item.candidate_name}</div>
                          <Badge tone="amber">{item.category}</Badge>
                          {item.challenge_id && <Badge>{item.challenge_id}</Badge>}
                        </div>
                        <div className="mt-2 text-xs text-bone/45">
                          {new Date(item.created_at).toLocaleString()}
                          {item.submitted_at ? ` · Candidate submitted ${new Date(item.submitted_at).toLocaleString()}` : " · Candidate still active"}
                        </div>
                      </div>
                      {item.has_evaluation ? (
                        <Link href={item.report_url}>
                          <Button size="sm" variant="outline">
                            Open preview
                          </Button>
                        </Link>
                      ) : (
                        <Badge tone="violet">Live session</Badge>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-bone/78">
                      {item.message}
                    </p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
