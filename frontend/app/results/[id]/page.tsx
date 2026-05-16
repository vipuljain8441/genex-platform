"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, FileText, Activity } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreRing } from "@/components/results/ScoreRing";
import { SignalBars } from "@/components/results/SignalBars";
import { Heatmap } from "@/components/results/Heatmap";
import { api } from "@/lib/api";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    const tick = setInterval(() => {
      api.getResults(params.id).then((d) => {
        setData(d);
        if (d.evaluation) clearInterval(tick);
      });
    }, 2000);
    return () => clearInterval(tick);
  }, [params.id]);

  if (!data) return <div className="p-10 text-bone/40">Loading results…</div>;

  const ev = data.evaluation;
  const heatmap = data.heatmap;

  return (
    <>
      <Nav />
      <main className="pt-12 pb-24 px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-accent">
              Candidate report
            </div>
            <h1 className="mt-2 font-display text-4xl tracking-tight font-semibold">
              {ev ? "How they thought through it" : "Generating evaluation…"}
            </h1>
          </div>

          {ev && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid md:grid-cols-3 gap-5"
            >
              <Card className="md:col-span-1">
                <CardBody>
                  <ScoreRing value={ev.overall_score} label="Composite score" />
                </CardBody>
              </Card>

              <Card className="md:col-span-2">
                <CardBody>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
                    Narrative
                  </div>
                  <p className="text-lg leading-relaxed text-bone/85">
                    {ev.narrative}
                  </p>
                </CardBody>
              </Card>
            </motion.div>
          )}

          {ev && (
            <div className="grid md:grid-cols-2 gap-5">
              <Card>
                <CardBody>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-4">
                    Signals
                  </div>
                  <SignalBars signals={ev.signals} />
                </CardBody>
              </Card>

              <Card>
                <CardBody className="space-y-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
                      Strengths
                    </div>
                    <ul className="space-y-1.5">
                      {ev.strengths.map((s: string, i: number) => (
                        <li key={i} className="text-sm flex items-start gap-2 text-bone/80">
                          <CheckCircle2 className="h-4 w-4 mt-0.5 text-accent" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
                      Gaps
                    </div>
                    <ul className="space-y-1.5">
                      {ev.gaps.map((s: string, i: number) => (
                        <li key={i} className="text-sm flex items-start gap-2 text-bone/80">
                          <XCircle className="h-4 w-4 mt-0.5 text-coral" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {ev && (
            <Card>
              <CardBody>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2 flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> Completed acceptance
                    </div>
                    <ul className="space-y-1.5">
                      {ev.completed_acceptance.map((c: string, i: number) => (
                        <li key={i} className="text-sm text-bone/80">✓ {c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2 flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> Missed acceptance
                    </div>
                    <ul className="space-y-1.5">
                      {ev.missed_acceptance.map((c: string, i: number) => (
                        <li key={i} className="text-sm text-bone/60">✗ {c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
                    Activity heatmap
                  </div>
                  <div className="font-display text-xl mt-1">How they spent their time</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-bone/50">
                  {Object.entries(heatmap.totals_by_kind || {}).map(([k, v]) => (
                    <Badge key={k}>{k}: {v as number}</Badge>
                  ))}
                </div>
              </div>
              <Heatmap data={heatmap} />
            </CardBody>
          </Card>

          {!ev && (
            <Card>
              <CardBody className="py-12 text-center text-bone/55">
                <Activity className="h-6 w-6 mx-auto mb-3 text-accent animate-pulse" />
                Evaluator is reviewing the session…
              </CardBody>
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
