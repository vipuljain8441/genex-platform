"use client";

import { Activity, Clock3, FileCode2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { ActivityForensics } from "@/lib/report-types";

function fmtSeconds(value: number) {
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function ActivityForensicsPanel({ data }: { data: ActivityForensics }) {
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40">Activity forensics</div>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">
              Employer-only trace of where the candidate spent time, which files changed, and the most recently observed line ranges.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="accent">{data.total_events} events</Badge>
            <Badge>{data.tracked_files} files</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {data.file_summaries.slice(0, 8).map((file) => (
            <div
              key={file.file_path}
              className="rounded-2xl border border-black/[0.06] bg-black/[0.02] p-4"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent">
                  <FileCode2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-bone break-all">{file.file_path}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-bone/50">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" /> {fmtSeconds(file.active_seconds)}
                    </span>
                    <span>{file.total_events} events</span>
                    <span>{file.edit_events} edit observations</span>
                  </div>
                </div>
              </div>
              {file.line_ranges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {file.line_ranges.slice(0, 6).map((range, idx) => (
                    <Badge key={`${file.file_path}-${idx}`}>
                      L{range.start_line}-{range.end_line} · {range.change_type}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">Recent activity trace</div>
          <div className="space-y-2">
            {data.recent_entries.slice(-18).reverse().map((entry, idx) => (
              <div
                key={`${entry.at}-${idx}`}
                className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-bone/45">
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3" /> {entry.kind}
                      </span>
                      {entry.file_path && <span className="font-mono">{entry.file_path}</span>}
                      {entry.line_start !== null && (
                        <span>
                          L{entry.line_start}{entry.line_end && entry.line_end !== entry.line_start ? `-${entry.line_end}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-bone/80 leading-relaxed">{entry.summary}</p>
                  </div>
                  <div className="text-[11px] text-bone/45 whitespace-nowrap">
                    {new Date(entry.at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
