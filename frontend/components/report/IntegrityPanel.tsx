"use client";

import { Info } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import type { IntegritySignals } from "@/lib/report-types";

export function IntegrityPanel({ integrity }: { integrity: IntegritySignals }) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
          Integrity signals
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-black/[0.03] border border-black/[0.04] px-3 py-2.5 text-xs text-bone/60 leading-relaxed mb-4">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-bone/45" />
          <p>{integrity.disclaimer}</p>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-xs text-bone/55">Integrity indicator</div>
          <div className="font-mono text-base text-bone/65">{integrity.score}</div>
        </div>
        {integrity.flags.length === 0 ? (
          <div className="text-sm text-bone/55">
            No integrity flags recorded in this session.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-bone/40">
                <th className="text-left py-2 pr-3 font-medium">Flag</th>
                <th className="text-right py-2 px-3 font-medium">Count</th>
                <th className="text-right py-2 pl-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {integrity.flags.map((f) => (
                <tr key={f.type}>
                  <td className="py-2 pr-3 text-bone/80">{f.label}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-bone/75">
                    {f.count}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-xs text-bone/55">
                    {f.total_duration_seconds
                      ? `${f.total_duration_seconds}s`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
