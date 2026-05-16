"use client";

import { motion } from "framer-motion";
import { Card, CardBody } from "@/components/ui/Card";
import type { CQOverview as CQOverviewT } from "@/lib/report-types";

function scoreColor(score: number) {
  if (score >= 75) return "#7c3aed"; // brand accent
  if (score >= 50) return "#f59e0b"; // amber
  return "#fb7185"; // coral
}

export function CQOverview({ cq }: { cq: CQOverviewT | null }) {
  if (!cq) {
    return (
      <Card>
        <CardBody>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            Collaborative intelligence
          </div>
          <div className="text-sm text-bone/55">
            Results not yet available — session may still be active.
          </div>
        </CardBody>
      </Card>
    );
  }

  const tone = scoreColor(cq.score);

  return (
    <Card>
      <CardBody>
        <div className="grid md:grid-cols-[180px_1fr] gap-6 items-center">
          <div className="text-center">
            <div
              className="font-display text-6xl font-bold leading-none"
              style={{ color: tone }}
            >
              {cq.score}
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40 mt-2">
              Collaborative Intelligence
            </div>
          </div>
          <div>
            <p className="text-base leading-relaxed text-bone/85">{cq.summary}</p>
            <div className="mt-5 space-y-2.5">
              {cq.breakdown.components.map((c, i) => {
                const pct = (c.score / c.max) * 100;
                return (
                  <div key={c.key}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-bone/80">{c.label}</span>
                      <span className="font-mono text-bone/55">
                        {c.score.toFixed(1)} / {c.max}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          delay: 0.1 + i * 0.05,
                          duration: 0.8,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className="h-full"
                        style={{ background: tone }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
