"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Flag, Tag, User } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

type Ticket = {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  priority: string;
  labels: string[];
  reporter: string;
  assignee: string;
};

const PRIORITY_TONE: Record<string, "coral" | "amber" | "violet" | "default"> = {
  critical: "coral",
  high: "coral",
  medium: "amber",
  low: "violet",
};

export function TicketPanel({ ticket }: { ticket: Ticket }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="h-full overflow-y-auto scrollbar-thin"
    >
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={PRIORITY_TONE[ticket.priority] || "default"}>
            <Flag className="h-3 w-3" /> {ticket.priority}
          </Badge>
          <span className="font-mono text-[11px] text-bone/40">{ticket.id}</span>
        </div>

        <h2 className="font-display text-xl font-semibold leading-snug">
          {ticket.title}
        </h2>

        <div className="flex items-center gap-4 text-xs text-bone/50">
          <div className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            <span>{ticket.reporter}</span>
            <span className="text-bone/30">→</span>
            <span className="text-bone/70">{ticket.assignee}</span>
          </div>
        </div>

        {ticket.labels.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {ticket.labels.map((l) => (
              <span
                key={l}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-black/[0.04] text-bone/55 inline-flex items-center gap-1"
              >
                <Tag className="h-2.5 w-2.5" />
                {l}
              </span>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-black/[0.05]">
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            Description
          </div>
          <p className="text-sm text-bone/75 leading-relaxed whitespace-pre-line">
            {ticket.description}
          </p>
        </div>

        <div className="pt-3 border-t border-black/[0.05]">
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            Acceptance criteria
          </div>
          <ul className="space-y-2">
            {ticket.acceptance_criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-bone/80">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-violet shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}
