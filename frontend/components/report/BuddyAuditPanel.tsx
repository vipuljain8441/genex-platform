"use client";

import { Bot, Check, MessageSquare, ShieldAlert, X } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { BuddyAudit } from "@/lib/report-types";

export function BuddyAuditPanel({ audit }: { audit: BuddyAudit }) {
  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40">Buddy audit trail</div>
            <p className="mt-2 text-sm text-bone/65 leading-relaxed">
              Full employer-visible Buddy conversation history, proposed edits, and the candidate’s actions on those suggestions.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="accent">{audit.total_messages} messages</Badge>
            <Badge>{audit.proposed_edits} proposed edits</Badge>
            <Badge tone="accent">{audit.applied_edits} applied</Badge>
            <Badge tone="coral">{audit.dismissed_edits} dismissed</Badge>
          </div>
        </div>

        {audit.actions.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">Suggestion actions</div>
            <div className="space-y-2">
              {audit.actions.map((action, idx) => (
                <div
                  key={`${action.at}-${idx}`}
                  className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={action.action === "applied" ? "accent" : action.action === "dismissed" ? "coral" : "default"}>
                        {action.action === "applied" ? <Check className="h-3 w-3" /> : action.action === "dismissed" ? <X className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                        {action.action}
                      </Badge>
                      {action.file_path && <span className="font-mono text-xs text-bone/65">{action.file_path}</span>}
                    </div>
                    <div className="text-[11px] text-bone/45">{new Date(action.at).toLocaleString()}</div>
                  </div>
                  {action.rationale && (
                    <p className="mt-2 text-sm text-bone/75 leading-relaxed">{action.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">Transcript</div>
          <div className="space-y-3">
            {audit.transcript.map((entry, idx) => (
              <div
                key={`${entry.at}-${idx}`}
                className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-bone/45">
                      <Badge tone={entry.role === "buddy" ? "accent" : "default"}>
                        {entry.role === "buddy" ? <Bot className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                        {entry.role}
                      </Badge>
                      {entry.hint_level && <Badge>{entry.hint_level}</Badge>}
                      {entry.blocked && (
                        <Badge tone="coral">
                          <ShieldAlert className="h-3 w-3" /> blocked
                        </Badge>
                      )}
                      {entry.open_file && <span className="font-mono">{entry.open_file}</span>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-bone/80 leading-relaxed">{entry.content}</p>
                    {entry.edit_targets.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {entry.edit_targets.map((target) => (
                          <Badge key={`${entry.at}-${target}`}>{target}</Badge>
                        ))}
                      </div>
                    )}
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
