"use client";

import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { CodeReview, Severity } from "@/lib/report-types";

const SEV_META: Record<
  Severity,
  { label: string; tone: "coral" | "amber" | "default"; Icon: typeof Info }
> = {
  critical: { label: "Critical", tone: "coral", Icon: AlertOctagon },
  warning: { label: "Warning", tone: "amber", Icon: AlertTriangle },
  info: { label: "Info", tone: "default", Icon: Info },
};

function truncateFromLeft(s: string, max = 40) {
  if (s.length <= max) return s;
  return "…" + s.slice(s.length - max + 1);
}

export function CodeReviewPanel({ review }: { review: CodeReview | null }) {
  if (!review) {
    return (
      <Card>
        <CardBody>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            Code review
          </div>
          <div className="text-sm text-bone/55">
            No code review on record — candidate may not have pushed during the session.
          </div>
        </CardBody>
      </Card>
    );
  }

  const groups: Severity[] = ["critical", "warning", "info"];

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">Code review</div>
        {review.summary && (
          <p className="text-sm text-bone/80 leading-relaxed">{review.summary}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="coral">{review.critical_count} critical</Badge>
          <Badge tone="amber">{review.warning_count} warnings</Badge>
          <Badge>{review.info_count} info</Badge>
        </div>
        {review.critical_count === 0 && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            No critical issues found in submitted code.
          </div>
        )}
        {groups.map((sev) => {
          const items = review.findings.filter((f) => f.severity === sev);
          if (items.length === 0) return null;
          const { label, tone, Icon } = SEV_META[sev];
          return (
            <div key={sev}>
              <div className="text-[10px] uppercase tracking-wider text-bone/45 mb-1.5">
                {label}
              </div>
              <ul className="space-y-1.5">
                {items.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-bone/80"
                  >
                    <Icon
                      className={`h-4 w-4 mt-0.5 shrink-0 ${
                        tone === "coral"
                          ? "text-coral"
                          : tone === "amber"
                            ? "text-amber"
                            : "text-bone/45"
                      }`}
                    />
                    <span className="min-w-0">
                      <span>{f.message}</span>
                      {f.file && (
                        <span className="ml-2 font-mono text-xs text-bone/45">
                          {truncateFromLeft(f.file)}
                          {f.line != null ? `:${f.line}` : ""}
                        </span>
                      )}
                      {f.is_ai_generated_error && (
                        <Badge tone="amber" className="ml-2">
                          Accepted from AI without correction
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
