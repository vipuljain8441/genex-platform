"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Card, CardBody } from "@/components/ui/Card";
import { ReportHeader } from "@/components/report/ReportHeader";
import { CQOverview } from "@/components/report/CQOverview";
import { CQBreakdown } from "@/components/report/CQBreakdown";
import { EmployerMetrics } from "@/components/report/EmployerMetrics";
import { BugExposureMap } from "@/components/report/BugExposureMap";
import { AIInteraction } from "@/components/report/AIInteraction";
import { BehaviourPattern } from "@/components/report/BehaviourPattern";
import { PhaseTimeline } from "@/components/report/PhaseTimeline";
import { PerTicketTime } from "@/components/report/PerTicketTime";
import { CodingRhythm } from "@/components/report/CodingRhythm";
import { CodeOriginMap } from "@/components/report/CodeOriginMap";
import { IdleAnalysis } from "@/components/report/IdleAnalysis";
import { PanelFlow } from "@/components/report/PanelFlow";
import { IntegrityPanel } from "@/components/report/IntegrityPanel";
import { StrategyAnswers } from "@/components/report/StrategyAnswers";
import { CodeReviewPanel } from "@/components/report/CodeReviewPanel";
import { PlaybackCTA } from "@/components/report/PlaybackCTA";
import { api } from "@/lib/api";
import type { ReportData } from "@/lib/report-types";
import { MOCK_REPORT } from "@/lib/mock-report";

// TEMP: set to true to render the page from MOCK_REPORT instead of hitting the API.
const USE_MOCK_REPORT = false;

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(USE_MOCK_REPORT ? MOCK_REPORT : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (USE_MOCK_REPORT) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const data = await api.getReport(params.id);
        if (!cancelled) setReport(data);
        if (data.available) return true;
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
      return false;
    };

    fetchOnce();
    const tick = setInterval(async () => {
      const done = await fetchOnce();
      if (done) clearInterval(tick);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [params.id]);

  if (error) {
    return (
      <>
        <Nav />
        <main className="pt-12 pb-24 px-6">
          <div className="mx-auto max-w-3xl">
            <Card>
              <CardBody className="text-coral text-sm">{error}</CardBody>
            </Card>
          </div>
        </main>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <Nav />
        <main className="pt-20 px-6">
          <div className="mx-auto max-w-3xl text-bone/45 text-sm">Loading report…</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="pt-8 pb-24 px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-3xl space-y-5"
        >
          {/* Section 1 — Candidate header */}
          <ReportHeader header={report.header} cq={report.cq} candidateId={params.id} />

          {!report.available && (
            <Card>
              <CardBody className="py-10 text-center text-bone/55">
                <Activity className="h-6 w-6 mx-auto mb-3 text-accent animate-pulse" />
                Evaluator is reviewing the session — sections will fill in as data arrives.
              </CardBody>
            </Card>
          )}

          {/* Section 2 — CQ score overview */}
          <CQOverview cq={report.cq} />

          {/* Section 3 — CQ breakdown */}
          <CQBreakdown cq={report.cq} />

          {/* Section 4 — Employer metrics */}
          <EmployerMetrics metrics={report.metrics} />

          {/* Section 5 — Bug exposure map */}
          <BugExposureMap data={report.bug_exposure} />

          {/* Section 6 — AI interaction */}
          <AIInteraction ai={report.ai} />

          {/* Section 7 — Behaviour & investigation */}
          <BehaviourPattern behaviour={report.behaviour} heatmap={report.heatmap} />

          {/* Section 7a — Phase timeline */}
          <PhaseTimeline phases={report.behaviour_analytics.phases} />

          {/* Section 7b — Per-ticket time */}
          <PerTicketTime tickets={report.behaviour_analytics.per_ticket} />

          {/* Section 7c — Coding rhythm */}
          <CodingRhythm data={report.behaviour_analytics.keystrokes} />

          {/* Section 7d — Code origin map */}
          <CodeOriginMap data={report.behaviour_analytics.content_attribution} />

          {/* Section 7e — Idle analysis */}
          <IdleAnalysis data={report.behaviour_analytics.idle} />

          {/* Section 7f — Panel flow */}
          <PanelFlow data={report.behaviour_analytics.focus} />

          {/* Section 8 — Integrity */}
          <IntegrityPanel integrity={report.integrity} />

          {/* Section 9 — Strategy answers */}
          <StrategyAnswers answers={report.strategy} />

          {/* Section 10 — Code review */}
          <CodeReviewPanel review={report.code_review} />

          {/* Shadow playback CTA */}
          <PlaybackCTA url={report.playback_url} />
        </motion.div>
      </main>
    </>
  );
}
