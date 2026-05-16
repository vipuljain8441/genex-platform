"use client";

import { motion } from "framer-motion";

export function ScoreRing({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const r = 56;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);

  const tone = pct > 0.75 ? "#7c3aed" : pct > 0.5 ? "#f59e0b" : "#fb7185";

  return (
    <div className="flex items-center gap-5">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
          <circle cx="70" cy="70" r={r} stroke="rgba(15,15,23,0.08)" strokeWidth="10" fill="none" />
          <motion.circle
            cx="70" cy="70" r={r}
            stroke={tone}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <div className="font-display text-3xl font-bold text-center" style={{ color: tone }}>
              {Math.round(pct * 100)}
            </div>
            <div className="text-[10px] tracking-[0.2em] uppercase text-bone/40 text-center">
              / 100
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">Overall</div>
        <div className="font-display text-xl font-semibold mt-1">{label}</div>
      </div>
    </div>
  );
}
