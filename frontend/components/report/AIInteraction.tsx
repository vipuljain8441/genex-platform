"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, ShieldAlert } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { AIInteraction as AIData } from "@/lib/report-types";

const TAG_TONE: Record<string, "accent" | "amber" | "violet" | "coral" | "default"> = {
  "Security-aware": "accent",
  "Edge-case aware": "violet",
  "Test-oriented": "accent",
  Iterative: "amber",
  Vague: "coral",
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AIInteraction({ ai }: { ai: AIData }) {
  const [open, setOpen] = useState(false);
  const acceptRatio = ai.proposed > 0 ? ai.accepted / ai.proposed : 0;
  const rejectRatio = ai.proposed > 0 ? ai.rejected / ai.proposed : 0;

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          AI interaction
        </div>

        {/* 6a. Prompt log */}
        <div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 text-sm text-bone/85 hover:text-bone"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span>
              {ai.prompt_count} prompt{ai.prompt_count === 1 ? "" : "s"}
              {ai.prompt_count > 0 && (open ? " · hide" : " · click to expand")}
            </span>
          </button>
          {open && ai.prompts.length > 0 && (
            <ul className="mt-3 space-y-3">
              {ai.prompts.map((p, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-black/[0.05] bg-ink-100/50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-[10px] text-bone/45">
                    <span className="font-mono">{formatTime(p.at)}</span>
                    {p.file_context && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{p.file_context}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-bone/85 whitespace-pre-wrap">
                    {p.content}
                  </div>
                  {p.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.tags.map((t) => (
                        <Badge key={t} tone={TAG_TONE[t] ?? "default"}>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 6b. Patch stats */}
        {ai.proposed > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Patch activity
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{ai.proposed} proposed</Badge>
              <Badge tone="accent">{ai.accepted} accepted</Badge>
              <Badge tone="coral">{ai.rejected} rejected</Badge>
              <Badge tone="amber">{ai.edits_after_accept} edits after accept</Badge>
              <Badge tone={ai.blind_paste_rate > 0.5 ? "coral" : "default"}>
                {Math.round(ai.blind_paste_rate * 100)}% blind paste
              </Badge>
            </div>
            <div className="mt-3 h-2 rounded-full bg-black/[0.06] overflow-hidden flex">
              <div
                className="bg-accent h-full"
                style={{ width: `${acceptRatio * 100}%` }}
                title="Accepted"
              />
              <div
                className="bg-coral h-full"
                style={{ width: `${rejectRatio * 100}%` }}
                title="Rejected"
              />
            </div>
          </div>
        )}

        {/* 6c. Trap scenario */}
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
            AI trap scenario
          </div>
          {ai.trap.configured ? (
            <div className="rounded-lg border border-black/[0.06] bg-ink-100/50 p-3 space-y-2">
              <div className="font-mono text-xs text-bone/75 whitespace-pre-wrap">
                {ai.trap.bad_suggestion || "—"}
              </div>
              <div className="flex items-center gap-2">
                {ai.trap.outcome === "passed" && (
                  <Badge tone="accent">Candidate refused</Badge>
                )}
                {ai.trap.outcome === "failed" && (
                  <Badge tone="coral">
                    <ShieldAlert className="h-3 w-3" />
                    Candidate accepted
                  </Badge>
                )}
                {ai.trap.outcome === "not_triggered" && <Badge>Not triggered</Badge>}
              </div>
            </div>
          ) : (
            <div className="text-sm text-bone/55">
              No trap configured for this assessment.
            </div>
          )}
        </div>

        {/* 6d. Model */}
        <div className="text-xs text-bone/45">
          AI model used: <span className="font-mono">{ai.model_used}</span>
        </div>
      </CardBody>
    </Card>
  );
}
