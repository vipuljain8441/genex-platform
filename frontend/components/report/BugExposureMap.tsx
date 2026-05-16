"use client";

import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { BugExposure, BugStatus } from "@/lib/report-types";

const statusTone: Record<BugStatus, "accent" | "amber" | "violet" | "coral"> = {
  fixed: "accent",
  noticed: "amber",
  encountered: "violet",
  missed: "coral",
};

const statusLabel: Record<BugStatus, string> = {
  fixed: "Fixed",
  noticed: "Noticed",
  encountered: "Encountered",
  missed: "Missed",
};

function truncateFromLeft(s: string, max = 40) {
  if (s.length <= max) return s;
  return "…" + s.slice(s.length - max + 1);
}

export function BugExposureMap({ data }: { data: BugExposure }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
            Bug exposure map
          </div>
          <div className="text-xs text-bone/55">
            {data.fixed_count} of {data.total} fixed · {data.missed_count} missed
          </div>
        </div>
        {data.rows.length === 0 ? (
          <div className="text-sm text-bone/55">No defects recorded for this session.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-bone/40">
                  <th className="text-left py-2 pr-3 font-medium">ID</th>
                  <th className="text-left py-2 pr-3 font-medium">Type</th>
                  <th className="text-left py-2 pr-3 font-medium">Description</th>
                  <th className="text-right py-2 pl-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-mono text-xs text-bone/55">
                      {r.id}
                    </td>
                    <td className="py-2 pr-3 text-bone/75">{r.bug_type}</td>
                    <td className="py-2 pr-3 text-bone/80">
                      {truncateFromLeft(r.description, 80)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <Badge tone={statusTone[r.status]}>
                        {statusLabel[r.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
