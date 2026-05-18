"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label, TextInput } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { api, type InviteView } from "@/lib/api";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [view, setView] = useState<InviteView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.getInvite(token).then((v) => {
      setView(v);
      if (v.candidate_name) setName(v.candidate_name);
      else if (v.candidate_email) setName(v.candidate_email.split("@")[0]);
    }).catch((e) => setErr(e.message));
  }, [token]);

  async function start() {
    if (!view) return;
    setStarting(true);
    try {
      const r = await api.acceptInvite(token, name);
      router.push(`/candidate/${r.session_id}`);
    } catch (e: any) {
      setErr(e.message);
      setStarting(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="pt-16 pb-24 px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-lg"
        >
          {err && (
            <Card>
              <CardBody className="text-center py-12">
                <div className="text-coral font-medium mb-1">Invite unavailable</div>
                <div className="text-sm text-bone/55">{err}</div>
              </CardBody>
            </Card>
          )}

          {!err && !view && (
            <Card>
              <CardBody className="text-center py-12 text-bone/40 inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading invite…
              </CardBody>
            </Card>
          )}

          {view && (
            <Card>
              <CardHeader>
                <div className="text-xs uppercase tracking-[0.25em] text-accent">
                  Assessment invite
                </div>
                <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">
                  You're invited to take the {view.assessment.title} assessment.
                </h1>
                <p className="mt-2 text-sm text-bone/55">
                  Hi <span className="text-bone">{view.candidate_email}</span> — when you
                  click start, we'll drop you into a real codebase with a multi-step
                  assessment flow: coding tasks, reasoning prompts, and a Buddy AI on call.
                </p>
              </CardHeader>

              <CardBody className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <Stat
                    icon={<Clock className="h-4 w-4" />}
                    label="Time"
                    value={`~${view.assessment.duration_minutes} min`}
                  />
                  <Stat
                    icon={<Sparkles className="h-4 w-4" />}
                    label="Role"
                    value={view.assessment.role_family}
                  />
                  <Stat
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Mode"
                    value="Live"
                  />
                </div>

                <div className="rounded-xl bg-accent-soft border border-accent/25 p-4 text-sm text-bone/80">
                  <strong className="text-bone">Heads up:</strong> Buddy is helpful but
                  occasionally suggests things that look fine but aren't. Your job is to
                  review every suggestion before you Apply it — that's part of the
                  assessment.
                </div>

                {view.status === "accepted" && view.session_id ? (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => router.push(`/candidate/${view.session_id}`)}
                  >
                    Resume assessment
                  </Button>
                ) : !view.assessment.ready ? (
                  <div className="rounded-xl border border-amber/40 bg-amber/10 p-4 text-sm text-amber">
                    The assessment is still being prepared. Refresh in a minute.
                  </div>
                ) : (
                  <>
                    <div>
                      <Label>Confirm your name</Label>
                      <TextInput
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Jane Doe"
                      />
                    </div>
                    <Button
                      size="lg"
                      onClick={start}
                      disabled={starting}
                      className="w-full"
                    >
                      {starting ? "Provisioning workspace…" : "Start assessment"}
                    </Button>
                  </>
                )}

                <div className="text-[11px] text-bone/40 text-center">
                  Invite token <span className="font-mono">{view.token.slice(0, 6)}…</span>
                  · status <Badge tone={view.status === "accepted" ? "accent" : "default"}>{view.status}</Badge>
                </div>
              </CardBody>
            </Card>
          )}
        </motion.div>
      </main>
    </>
  );
}

function Stat({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-3">
      <div className="flex items-center gap-1.5 text-bone/55 text-[10px] uppercase tracking-wider">
        {icon}<span>{label}</span>
      </div>
      <div className="mt-1 font-display text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}
