"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Bot, Play, Terminal } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function PlaybackCTA({ url }: { url: string }) {
  return (
    <Card className="overflow-hidden border-accent/20 bg-[linear-gradient(135deg,_rgba(255,250,241,0.98)_0%,_rgba(245,250,255,0.98)_100%)] shadow-[0_18px_40px_rgba(138,104,39,0.08)]">
      <CardBody className="relative overflow-hidden">
        <div className="pointer-events-none absolute right-[-36px] top-[-36px] h-40 w-40 rounded-full bg-accent/10 blur-2xl" />
        <div className="pointer-events-none absolute bottom-[-56px] right-16 h-36 w-36 rounded-full bg-[#1f7ae0]/10 blur-2xl" />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent shadow-[0_10px_24px_rgba(232,153,24,0.16)]">
              <Play className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">Replay Ready</Badge>
                <Badge tone="violet">Employer view</Badge>
              </div>
              <div className="mt-3 font-display text-xl font-semibold text-bone">
                Open the session theater
              </div>
              <div className="mt-2 max-w-2xl text-sm leading-6 text-bone/60">
                Step through a polished read-only replay of how the candidate moved through the workspace, used the terminal, and worked with Buddy over time.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <PreviewChip icon={<Activity className="h-3.5 w-3.5" />} label="workspace moments" />
                <PreviewChip icon={<Terminal className="h-3.5 w-3.5" />} label="runtime checks" />
                <PreviewChip icon={<Bot className="h-3.5 w-3.5" />} label="Buddy trail" />
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[24px] border border-black/[0.06] bg-white/80 p-4 shadow-[0_12px_28px_rgba(58,60,68,0.06)] lg:w-[320px]">
            <div className="text-[10px] uppercase tracking-[0.2em] text-bone/40">
              Playback preview
            </div>
            <div className="mt-3 space-y-2.5">
              {[
                { label: "Challenge brief", tone: "bg-amber/20" },
                { label: "Code workspace", tone: "bg-[#1f7ae0]/18" },
                { label: "Buddy replay", tone: "bg-violet/18" },
                { label: "Terminal + activity", tone: "bg-mint/18" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-2xl border border-black/[0.05] bg-[#fcfbf7] px-3 py-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.tone}`} />
                  <span className="text-sm text-bone/72">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <Link
            href={url}
            className="inline-flex items-center justify-center gap-1.5 self-start rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-deep lg:self-center"
          >
            Open replay <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

function PreviewChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs text-bone/68">
      <span className="text-accent">{icon}</span>
      {label}
    </div>
  );
}
