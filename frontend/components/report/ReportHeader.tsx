"use client";

import { Github } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { CandidateHeader, CQOverview } from "@/lib/report-types";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ReportHeader({
  header,
  cq,
  candidateId,
}: {
  header: CandidateHeader;
  cq: CQOverview | null;
  candidateId: string;
}) {
  const cqTone =
    cq && cq.score >= 75 ? "accent" : cq && cq.score >= 50 ? "amber" : "coral";

  return (
    <>
      <div className="sticky top-[60px] z-30 -mx-6 px-6 py-3 bg-ink/85 backdrop-blur-md border-b border-black/[0.05]">
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
              Candidate report
            </div>
            <div className="font-display text-lg font-semibold truncate">
              {header.candidate_name} · {header.role_title}
            </div>
          </div>
          {cq ? (
            <Badge tone={cqTone as "accent" | "amber" | "coral"}>
              CQ {cq.score}
            </Badge>
          ) : (
            <Badge>Pending</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardBody>
          <div className="flex items-start gap-5">
            <div className="grid place-items-center h-14 w-14 rounded-full bg-accent/15 text-accent font-display text-lg">
              {initials(header.candidate_name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-display text-2xl font-semibold">
                  {header.candidate_name}
                </div>
                <a
                  href={`https://github.com/search?q=${encodeURIComponent(
                    header.candidate_name,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-bone/40 hover:text-bone/70"
                  title="Find on GitHub"
                >
                  <Github className="h-4 w-4" />
                </a>
              </div>
              <div className="text-sm text-bone/55 mt-0.5">
                {header.role_title} · {header.tech_stack.slice(0, 4).join(", ") || "—"} ·{" "}
                <span className="capitalize">{header.seniority}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-bone/55">
                <span>
                  Time taken{" "}
                  <strong className="text-bone/85">
                    {header.duration_used_min ?? "—"} min
                  </strong>{" "}
                  of {header.duration_allotted_min} min
                </span>
                <span>·</span>
                <span>Submitted {formatDateTime(header.submitted_at)}</span>
                <span>·</span>
                <span className="truncate">{header.assessment_title}</span>
              </div>
              {header.finished_early && (
                <div className="mt-2 text-xs text-bone/40">
                  Finished with significant time remaining.
                </div>
              )}
              <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-bone/30 font-mono">
                Session {candidateId}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
