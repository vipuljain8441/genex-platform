"use client";

import { Flag, MessageSquareText } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { FeedbackEntry } from "@/lib/report-types";

export function FeedbackLogPanel({ feedback }: { feedback: FeedbackEntry[] }) {
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40">Candidate feedback log</div>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">
              Issues and notes the candidate chose to send to the employer during the assessment.
            </p>
          </div>
          <Badge tone={feedback.length > 0 ? "amber" : "default"}>
            {feedback.length} item{feedback.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {feedback.length === 0 ? (
          <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-5 text-sm text-bone/55">
            No candidate feedback was submitted during this session.
          </div>
        ) : (
          <div className="space-y-3">
            {feedback.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-black/[0.06] bg-white px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="amber">
                      <Flag className="h-3 w-3" />
                      {item.category}
                    </Badge>
                    {item.challenge_id && (
                      <Badge>
                        <MessageSquareText className="h-3 w-3" />
                        {item.challenge_id}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-bone/45">
                    {new Date(item.created_at).toLocaleString()}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-bone/80">
                  {item.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
