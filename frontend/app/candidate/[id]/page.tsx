"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Workspace } from "@/components/candidate/Workspace";

export default function CandidateWorkspacePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSession(params.id).then(setData).catch((e) => setErr(e.message));
  }, [params.id]);

  if (err) return <div className="p-10 text-coral">{err}</div>;
  if (!data) return <div className="p-10 text-bone/40">Loading workspace…</div>;

  const a = data.assessment;
  const challenges = a.candidate_challenges || [];
  const buggy = a.buggy_codebase;

  if (!buggy || challenges.length === 0) {
    return (
      <div className="p-10 text-bone/40">Assessment not fully ready yet.</div>
    );
  }

  // Use the candidate's current_files (overridden saved content) as the source of truth.
  const files = buggy.files.map((f: any) => ({
    path: f.path,
    language: f.language,
    content: data.session.current_files?.[f.path] ?? f.content,
  }));

  return (
    <Workspace
      sessionId={data.session.id}
      assessmentId={a.id}
      challenges={challenges}
      initialFiles={files}
      entryPoint={buggy.entry_point}
      durationMinutes={a.job.duration_minutes}
      initialChallengeId={data.session.current_challenge_id}
      initialResponses={data.session.challenge_responses || {}}
    />
  );
}
