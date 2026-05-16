"use client";

import { motion } from "framer-motion";
import { Briefcase, MonitorPlay, FlameKindling } from "lucide-react";

const STEPS = [
  {
    icon: Briefcase,
    title: "Employer drops the JD",
    body: "Paste the JD, pick the role family, point us at your PM tool. Six agents spin up.",
  },
  {
    icon: MonitorPlay,
    title: "Candidate steps into day-1",
    body: "Real ticket. Real codebase. A buddy that hints, never solves. Every keystroke captured.",
  },
  {
    icon: FlameKindling,
    title: "You read the candidate, not just the score",
    body: "A behavioural heatmap and a written narrative tell you HOW they thought, not just whether they passed.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative py-28 border-t border-black/[0.04]">
      <div className="mx-auto max-w-7xl px-6">
        <div className="max-w-2xl">
          <span className="text-xs uppercase tracking-[0.25em] text-violet">
            How it works
          </span>
          <h2 className="mt-3 font-display text-4xl md:text-5xl tracking-tight font-semibold leading-tight">
            Three steps. <span className="text-bone/40">No editing rubrics by hand.</span>
          </h2>
        </div>

        <div className="mt-14 grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative rounded-2xl p-7 bg-gradient-to-b from-black/[0.04] to-transparent border border-black/[0.06]"
              >
                <div className="absolute top-5 right-5 font-display text-5xl font-bold text-white/[0.04]">
                  0{i + 1}
                </div>
                <Icon className="h-7 w-7 text-accent" />
                <h3 className="mt-5 font-display text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-bone/55 text-sm leading-relaxed">{s.body}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
