"use client";

import { motion } from "framer-motion";

type Signal = { name: string; score: number; notes: string };

export function SignalBars({ signals }: { signals: Signal[] }) {
  return (
    <div className="space-y-3">
      {signals.map((s, i) => {
        const pct = Math.max(0, Math.min(1, s.score));
        const tone = pct > 0.75 ? "bg-accent" : pct > 0.5 ? "bg-amber" : "bg-coral";
        return (
          <div key={s.name}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="capitalize text-bone/80">{s.name.replace(/_/g, " ")}</span>
              <span className="font-mono text-xs text-bone/55">{Math.round(pct * 100)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-black/[0.05] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct * 100}%` }}
                transition={{ delay: i * 0.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className={`h-full ${tone}`}
              />
            </div>
            {s.notes && (
              <div className="mt-1 text-[11px] text-bone/45 leading-relaxed">{s.notes}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
