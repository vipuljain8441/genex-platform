"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Loader2, AlertTriangle, Sparkles, ExternalLink,
} from "lucide-react";
import {
  api, streamAssessment, type Assessment, type PipelineStage,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn, shortId } from "@/lib/utils";
import { InviteCard } from "./InviteCard";

const STAGES: { key: PipelineStage; label: string; agent: string }[] = [
  { key: "extracting", label: "Reading PM tool", agent: "Extractor" },
  { key: "authoring", label: "Writing golden artifact", agent: "Code Author" },
  { key: "ticketing", label: "Drafting candidate ticket", agent: "Ticket Author" },
  { key: "injecting", label: "Planting realistic defects", agent: "Bug Injector" },
  { key: "ready", label: "Assessment ready", agent: "—" },
];

const ORDER: PipelineStage[] = [
  "pending", "extracting", "authoring", "ticketing", "injecting", "ready",
];

function stageIndex(s: PipelineStage) {
  return ORDER.indexOf(s);
}

export function PipelineView({ initial }: { initial: Assessment }) {
  const [a, setA] = useState<Assessment>(initial);

  useEffect(() => {
    const close = streamAssessment(initial.id, setA);
    const poll = setInterval(async () => {
      try { setA(await api.getAssessment(initial.id)); } catch {}
    }, 4000);
    return () => { close(); clearInterval(poll); };
  }, [initial.id]);

  const cur = a.status.stage;
  const failed = cur === "failed";
  const ready = cur === "ready";

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
            {a.job.role_family} · {a.job.seniority} · {a.job.duration_minutes} min · PM: {a.job.pm_tool}
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

      {ready && a.candidate_ticket && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardBody>
              <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
                Candidate ticket
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
    </div>
  );
}
