"use client";

import { AlertCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import type { ContentAttributionSummary } from "@/lib/report-types";

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-bone/55">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-mint" />Manual</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" />AI patch</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" />Pasted</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-bone/30" />Unchanged</span>
    </div>
  );
}

export function CodeOriginMap({ data }: { data: ContentAttributionSummary }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
          7d · Code origin map
        </div>

        {data.files.length === 0 ? (
          <div className="text-sm text-bone/55">
            No content attribution snapshots recorded. Snapshots fire at each commit.
          </div>
        ) : (
          <>
            <div>
              <div className="text-xs text-bone/55 mb-2">Overall mix</div>
              <div className="flex h-3 rounded-full overflow-hidden border border-black/[0.05]">
                <div className="bg-mint h-full" style={{ width: `${data.overall_manual_pct}%` }} />
                <div className="bg-accent h-full" style={{ width: `${data.overall_ai_patch_pct}%` }} />
                <div className="bg-amber h-full" style={{ width: `${data.overall_pasted_pct}%` }} />
                <div className="bg-bone/30 h-full" style={{ width: `${data.overall_unchanged_pct}%` }} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-bone/55">
                <span>Manual {data.overall_manual_pct}%</span>
                <span>AI {data.overall_ai_patch_pct}%</span>
                <span>Pasted {data.overall_pasted_pct}%</span>
                <span>Unchanged {data.overall_unchanged_pct}%</span>
              </div>
            </div>

            <div className="space-y-2">
              {data.files.map((f) => {
                const highPaste = f.pasted_pct >= 50;
                const highUnchanged = f.unchanged_pct >= 70;
                return (
                  <div key={f.file_path}>
                    <div className="flex items-baseline justify-between gap-3 text-xs mb-1">
                      <span className="font-mono text-bone/75 truncate" title={f.file_path}>
                        {f.file_path}
                      </span>
                      <span className="text-bone/45">{f.total_lines} lines</span>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-black/[0.06]">
                      <div className="bg-mint h-full" style={{ width: `${f.manual_pct}%` }} />
                      <div className="bg-accent h-full" style={{ width: `${f.ai_patch_pct}%` }} />
                      <div className="bg-amber h-full" style={{ width: `${f.pasted_pct}%` }} />
                      <div className="bg-bone/30 h-full" style={{ width: `${f.unchanged_pct}%` }} />
                    </div>
                    {(highPaste || highUnchanged) && (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber">
                        <AlertCircle className="h-3 w-3" />
                        {highPaste
                          ? "Content primarily pasted — verify understanding in interview."
                          : "Low engagement with this file — most lines unchanged from starter."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Legend />
          </>
        )}

        <details className="text-[11px] text-bone/55">
          <summary className="cursor-pointer select-none text-bone/65">
            How to read this
          </summary>
          <div className="mt-2 leading-relaxed">
            Each line in every modified file is attributed to its origin at commit time.
            High <strong>AI patch</strong> isn&apos;t bad on its own — pair it with the
            edits-after-accept stat in the AI Interaction section to see whether the
            candidate verified what they applied. High <strong>Pasted</strong> on a critical
            file is the signal to probe in a follow-up interview.
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
