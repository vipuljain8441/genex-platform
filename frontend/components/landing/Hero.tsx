"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";

const word = {
  hidden: { y: 28, opacity: 0 },
  show: (i: number) => ({
    y: 0,
    opacity: 1,
    transition: { delay: 0.1 + i * 0.07, duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  }),
};

const HEADLINE = ["Real", "assessments.", "Real", "signal."];

export function Hero() {
  return (
    <section className="relative pt-24 pb-32 overflow-hidden">
      {/* Background ornaments */}
      <div className="absolute inset-0 dotted-grid opacity-40" />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 80, ease: "linear", repeat: Infinity }}
        className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-accent/20 to-violet/10 blur-3xl"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 100, ease: "linear", repeat: Infinity }}
        className="absolute -bottom-40 -left-40 h-[460px] w-[460px] rounded-full bg-gradient-to-br from-violet/20 to-coral/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1.5 text-xs text-bone/70"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-75" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-accent" />
          </span>
          A new way to interview — by SkillBrew
        </motion.div>

        <h1 className="mt-7 font-display text-[clamp(2.5rem,7vw,6.5rem)] leading-[0.95] tracking-[-0.03em] font-semibold max-w-5xl">
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            {HEADLINE.map((w, i) => (
              <motion.span
                key={i}
                custom={i}
                variants={word}
                initial="hidden"
                animate="show"
                className={i === 3 ? "gradient-text" : ""}
              >
                {w}
              </motion.span>
            ))}
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="mt-7 max-w-2xl text-lg text-bone/60 leading-relaxed"
        >
          GenEx drops candidates into a realistic <span className="text-bone">day-1 on-the-job
          simulation</span> — a Jira-style ticket, a real codebase with planted bugs,
          and a buddy AI that helps without solving. Built for whole engineering teams,
          not just coders.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.6 }}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <Link href="/employer/new">
            <Button size="lg">
              <Sparkles className="h-4 w-4" />
              Create an assessment
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/employer">
            <Button size="lg" variant="outline">View dashboard</Button>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-black/[0.06] bg-black/[0.02]"
        >
          {[
            ["6", "Agents in the pipeline"],
            ["0", "Solutions from buddy"],
            ["100%", "Signals captured"],
            ["∞", "Roles supported"],
          ].map(([k, v]) => (
            <div key={v} className="bg-ink-50/85 p-6">
              <div className="font-display text-3xl text-accent">{k}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-bone/40">{v}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
