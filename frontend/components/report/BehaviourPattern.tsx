"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Heatmap } from "@/components/results/Heatmap";
import type {
  BehaviourPattern as BehaviourData,
  Heatmap as HeatmapData,
} from "@/lib/report-types";

function Indicator({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-accent" />
      ) : (
        <AlertCircle className="h-4 w-4 text-amber" />
      )}
      <span className="text-bone/80">{label}</span>
      <span className="text-bone/40 ml-auto text-xs">{ok ? "Yes" : "No"}</span>
    </div>
  );
}

export function BehaviourPattern({
  behaviour,
  heatmap,
}: {
  behaviour: BehaviourData;
  heatmap: HeatmapData;
}) {
  const mix = behaviour.heatmap_mix;

  return (
    <Card>
      <CardBody className="space-y-6">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          Behaviour & investigation
        </div>

        {/* 7a. Decision timeline */}
        <div>
          <div className="text-xs text-bone/55 mb-2">Decision timeline</div>
          {behaviour.timeline.length === 0 ? (
            <div className="text-sm text-bone/45">No session events recorded.</div>
          ) : (
            <div className="relative h-12">
              <div className="absolute top-1/2 left-0 right-0 h-px bg-black/[0.08]" />
              {behaviour.timeline.map((m, i) => (
                <div
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${m.offset_pct}%` }}
                  title={new Date(m.at).toLocaleString()}
                >
                  <div className="h-2 w-2 rounded-full bg-accent" />
                  <div className="mt-1.5 text-[10px] whitespace-nowrap text-bone/55">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 7b. Investigation stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-black/[0.06] bg-ink-100/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-bone/45">
              Files before first edit
            </div>
            <div className="font-display text-xl text-bone mt-0.5">
              {behaviour.files_before_first_edit}
            </div>
          </div>
          <div className="rounded-lg border border-black/[0.06] bg-ink-100/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-bone/45">
              Time to first edit
            </div>
            <div className="font-display text-xl text-bone mt-0.5">
              {behaviour.time_to_first_edit_min === null
                ? "—"
                : `${behaviour.time_to_first_edit_min} min`}
            </div>
          </div>
          <div className="rounded-lg border border-black/[0.06] bg-ink-100/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-bone/45">
              Unique files opened
            </div>
            <div className="font-display text-xl text-bone mt-0.5">
              {behaviour.total_files_opened}
            </div>
          </div>
        </div>
        <div className="text-xs text-bone/55 leading-relaxed -mt-3">
          {behaviour.investigation_note}
        </div>

        {/* 7c. Activity mix */}
        <div>
          <div className="text-xs text-bone/55 mb-2">Where time was spent</div>
          <div className="flex h-7 rounded-lg overflow-hidden border border-black/[0.05]">
            <div
              className="bg-accent flex items-center justify-center text-[10px] text-white"
              style={{ width: `${mix.editor}%` }}
            >
              {mix.editor > 15 ? `Editor ${mix.editor}%` : ""}
            </div>
            <div
              className="bg-violet flex items-center justify-center text-[10px] text-white"
              style={{ width: `${mix.ai}%` }}
            >
              {mix.ai > 15 ? `AI ${mix.ai}%` : ""}
            </div>
            <div
              className="bg-bone/35 flex items-center justify-center text-[10px] text-white"
              style={{ width: `${mix.terminal}%` }}
            >
              {mix.terminal > 15 ? `Terminal ${mix.terminal}%` : ""}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-bone/55">
            <span>Editor {mix.editor}%</span>
            <span>AI {mix.ai}%</span>
            <span>Terminal {mix.terminal}%</span>
          </div>
        </div>

        {/* Heatmap grid */}
        {heatmap.files.length > 0 && (
          <div>
            <div className="text-xs text-bone/55 mb-2">File · time heatmap</div>
            <Heatmap data={heatmap} />
          </div>
        )}

        {/* 7d. Verification */}
        <div className="space-y-2">
          <div className="text-xs text-bone/55">Verification behaviour</div>
          <Indicator label="Ran tests / executed code" ok={behaviour.verification.ran_tests} />
          <Indicator
            label="Verified AI patches manually"
            ok={behaviour.verification.verified_ai_patches}
          />
          <Indicator
            label="Committed in small units"
            ok={behaviour.verification.small_commits}
          />
        </div>
      </CardBody>
    </Card>
  );
}
