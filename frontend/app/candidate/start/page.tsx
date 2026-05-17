"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label, TextInput } from "@/components/ui/Field";
import { api } from "@/lib/api";

function CandidateStartInner() {
  const router = useRouter();
  const search = useSearchParams();
  const aid = search.get("aid") || "";
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!aid) return setErr("Missing assessment id (use the link from the employer)");
    setStarting(true);
    try {
      const { session } = await api.startSession(aid, name || "Candidate");
      router.push(`/candidate/${session.id}`);
    } catch (e: any) {
      setErr(e.message);
      setStarting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-lg"
    >
      <Card>
        <CardHeader>
          <div className="text-xs uppercase tracking-[0.25em] text-accent">
            Day one
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            Welcome to the team.
          </h1>
          <p className="mt-2 text-sm text-bone/55">
            A sequence of challenges is waiting on your board. Some will be in the
            codebase, some will test judgment or written reasoning. You'll have access
            to the workspace and a buddy who can help — but won't solve. Everything you
            do is captured so we can show your future team how you think.
          </p>
        </CardHeader>
        <CardBody className="space-y-5">
          <div>
            <Label>Your name</Label>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hridesh K."
            />
          </div>
          {err && <div className="text-coral text-sm">{err}</div>}
          <Button size="lg" onClick={go} disabled={starting} className="w-full">
            {starting ? "Provisioning workspace…" : "Start assessment"}
          </Button>
        </CardBody>
      </Card>
    </motion.div>
  );
}

export default function CandidateStart() {
  return (
    <>
      <Nav />
      <main className="pt-20 pb-24 px-6">
        <Suspense fallback={<div className="text-center text-bone/40">Loading…</div>}>
          <CandidateStartInner />
        </Suspense>
      </main>
    </>
  );
}
