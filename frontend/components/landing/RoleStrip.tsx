"use client";

import { motion } from "framer-motion";

const ROLES = [
  "Backend",
  "Frontend",
  "Fullstack",
  "QA",
  "DevOps",
  "Data",
  "PM",
  "Design",
  "Mobile",
  "Security",
  "Platform",
  "ML",
];

export function RoleStrip() {
  return (
    <section className="py-12 border-y border-black/[0.04] overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <span className="text-xs uppercase tracking-[0.25em] text-bone/40">
          Built for the whole engineering team — not just coders
        </span>
      </div>
      <motion.div
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 40, ease: "linear", repeat: Infinity }}
        className="mt-6 flex gap-3 whitespace-nowrap w-[200%]"
      >
        {[...ROLES, ...ROLES, ...ROLES, ...ROLES].map((r, i) => (
          <div
            key={i}
            className="rounded-full border border-black/[0.06] bg-ink-50/85 px-5 py-2 font-display text-lg tracking-tight"
          >
            {r}
          </div>
        ))}
      </motion.div>
    </section>
  );
}
