"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Nav } from "@/components/Nav";
import { PipelineView } from "@/components/employer/PipelineView";
import { api, type Assessment } from "@/lib/api";

export default function AssessmentPage() {
  const params = useParams<{ id: string }>();
  const [a, setA] = useState<Assessment | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAssessment(params.id)
      .then(setA)
      .catch((e) => setErr(e.message));
  }, [params.id]);

  return (
    <>
      <Nav />
      <main className="pt-12 pb-24 px-6">
        {err ? (
          <div className="mx-auto max-w-2xl text-center text-coral">{err}</div>
        ) : a ? (
          <PipelineView initial={a} />
        ) : (
          <div className="mx-auto max-w-2xl text-center text-bone/40">
            Loading assessment…
          </div>
        )}
      </main>
    </>
  );
}
