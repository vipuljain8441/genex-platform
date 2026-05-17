"use client";

import { motion } from "framer-motion";
import { Card, CardBody } from "@/components/ui/Card";
import type { CQOverview } from "@/lib/report-types";

export function CQBreakdown({ cq }: { cq: CQOverview | null }) {
  if (!cq) return null;

  return (
    <section>
      <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3 px-1">
        Breakdown by component
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {cq.breakdown.components.map((c, i) => {
          const pct = (c.score / c.max) * 100;
          const tone =
            pct >= 75
              ? "bg-accent"
              : pct >= 50
                ? "bg-amber"
                : "bg-coral";
          return (
            <Card key={c.key}>
              <CardBody>
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-base font-semibold">
                    {c.label}
                  </div>
                  <div className="font-mono text-xs text-bone/55">
                    {c.score.toFixed(1)} / {c.max}
                  </div>
                </div>
                <div className="mt-2 h-2 rounded-full bg-black/[0.06] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{
                      duration: 0.9,
                      delay: 0.05 * i,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={`h-full ${tone}`}
                  />
                </div>
                <div className="mt-3 text-xs text-bone/55 leading-relaxed">
                  {c.note}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
