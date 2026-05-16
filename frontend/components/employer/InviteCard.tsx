"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, Copy, Check, AlertTriangle, Send, CircleDot, CircleCheck, ExternalLink,
} from "lucide-react";
import { api, type InviteOut } from "@/lib/api";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label, TextArea } from "@/components/ui/Field";
import { cn, relativeTime } from "@/lib/utils";

export function InviteCard({ assessmentId }: { assessmentId: string }) {
  const [emails, setEmails] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listInvites(assessmentId).then(setInvites).catch(() => {});
  }, [assessmentId]);

  async function send() {
    setError(null);
    const parsed = emails
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0) {
      setError("Add at least one email.");
      return;
    }
    setSending(true);
    try {
      const created = await api.createInvites(assessmentId, parsed, name.trim());
      setInvites((prev) => [...created, ...prev]);
      setEmails("");
      setName("");
    } catch (e: any) {
      setError(e.message || "Failed to send invites.");
    } finally {
      setSending(false);
    }
  }

  function copy(token: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center h-10 w-10 rounded-xl bg-accent text-white shrink-0">
            <Mail className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
              Phase 2 · invite candidates
            </div>
            <h2 className="font-display text-2xl font-semibold mt-1">
              Send the assessment to candidates.
            </h2>
            <p className="text-sm text-bone/55 mt-1.5 leading-relaxed">
              Each candidate gets a unique link via email. Their session starts when
              they click it — no logins, no setup. The link is also shown below so
              you can DM / Slack it manually.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label hint="Comma, space, or newline-separated">Candidate emails</Label>
            <TextArea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={3}
              placeholder={"ravi@example.com\npriya@example.com\nalex@example.com"}
            />
          </div>
          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label hint="Optional — only used for single-candidate invites">
                Candidate name
              </Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hridesh K."
                className="w-full bg-ink-100 text-bone placeholder:text-bone/35 border border-black/[0.08] rounded-xl px-4 py-3 outline-none transition focus:bg-white focus:border-accent/60"
              />
            </div>
            <Button onClick={send} disabled={sending}>
              {sending ? "Sending…" : <><Send className="h-4 w-4" /> Send invites</>}
            </Button>
          </div>
          {error && <div className="text-coral text-sm">{error}</div>}
        </div>

        {invites.length > 0 && (
          <div className="pt-3 border-t border-black/[0.06]">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
              Sent invites · {invites.length}
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {invites.map((iv) => {
                  const isAccepted = iv.status === "accepted";
                  return (
                    <motion.li
                      key={iv.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={cn(
                        "rounded-xl border bg-white p-3 flex items-center gap-3",
                        isAccepted ? "border-mint/40" : "border-black/[0.06]"
                      )}
                    >
                      <div
                        className={cn(
                          "grid place-items-center h-8 w-8 rounded-lg",
                          isAccepted ? "bg-mint/15 text-mint" : "bg-accent/12 text-accent"
                        )}
                      >
                        {isAccepted ? (
                          <CircleCheck className="h-4 w-4" />
                        ) : (
                          <CircleDot className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{iv.candidate_email}</div>
                        <div className="text-[11px] text-bone/45 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="uppercase tracking-wider">{iv.status}</span>
                          <span>·</span>
                          <span>{relativeTime(iv.invited_at)}</span>
                          {iv.email_sent ? (
                            <>
                              <span>·</span>
                              <span className="text-mint">email sent</span>
                            </>
                          ) : (
                            <>
                              <span>·</span>
                              <span
                                className="text-amber inline-flex items-center gap-1"
                                title={iv.email_error || ""}
                              >
                                <AlertTriangle className="h-3 w-3" /> email skipped
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => copy(iv.token, iv.invite_url)}
                        className="text-xs px-2.5 py-1.5 rounded-md text-bone/65 hover:text-bone hover:bg-black/[0.04] transition inline-flex items-center gap-1.5"
                        title={iv.invite_url}
                      >
                        {copiedToken === iv.token ? (
                          <><Check className="h-3.5 w-3.5 text-mint" /> Copied</>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /> Copy link</>
                        )}
                      </button>
                      <a
                        href={iv.invite_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-2.5 py-1.5 rounded-md text-bone/65 hover:text-bone hover:bg-black/[0.04] transition inline-flex items-center gap-1.5"
                      >
                        Open <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
