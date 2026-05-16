"use client";

import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { StrategyAnswer } from "@/lib/report-types";

export function StrategyAnswers({ answers }: { answers: StrategyAnswer[] }) {
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          Strategy responses
        </div>
        {answers.length === 0 ? (
          <div className="text-sm text-bone/55">
            Strategy question responses are not yet available for this session.
          </div>
        ) : (
          answers.map((q, i) => {
            const pct = (q.score / q.max) * 100;
            return (
              <div key={i} className="space-y-2">
                <div className="font-semibold text-bone text-sm">{q.question}</div>
                <div className="text-sm text-bone/80 whitespace-pre-wrap leading-relaxed">
                  {q.answer}
                </div>
                <div className="flex items-baseline gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="font-mono text-xs text-bone/55">
                    {q.score} / {q.max}
                  </div>
                </div>
                {q.note && (
                  <div className="text-xs text-bone/55 leading-relaxed">{q.note}</div>
                )}
                {q.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {q.tags.map((t) => (
                      <Badge key={t} tone="violet">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
