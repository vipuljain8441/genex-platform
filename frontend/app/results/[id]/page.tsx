"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, FileText, Loader2, Lock, Sparkles } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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
import { ActivityForensicsPanel } from "@/components/report/ActivityForensicsPanel";
import { BuddyAuditPanel } from "@/components/report/BuddyAuditPanel";
import { FeedbackLogPanel } from "@/components/report/FeedbackLogPanel";
import { PlaybackCTA } from "@/components/report/PlaybackCTA";
import { api } from "@/lib/api";
import type {
  ReportAnalysis,
  ReportData,
  ReportPreviewData,
} from "@/lib/report-types";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [preview, setPreview] = useState<ReportPreviewData | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [analysis, setAnalysis] = useState<ReportAnalysis | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchPreview = async () => {
      try {
        const data = await api.getReportPreview(params.id);
        if (!cancelled) setPreview(data);
        return !!data.available;
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
        return false;
      }
    };

    fetchPreview();
    const tick = setInterval(async () => {
      const done = await fetchPreview();
      if (done) clearInterval(tick);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [params.id]);

  async function unlockReport() {
    setUnlocking(true);
    setError(null);
    try {
      const data = await api.getReport(params.id);
      setReport(data);
      setUnlocked(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to unlock report");
    } finally {
      setUnlocking(false);
    }
  }

  async function analyzeReport() {
    setAnalysisLoading(true);
    setError(null);
    try {
      const data = await api.generateReportAnalysis(params.id);
      setAnalysis(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate AI analysis");
    } finally {
      setAnalysisLoading(false);
    }
  }

  if (error && !preview) {
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

  if (!preview) {
    return (
      <>
        <Nav />
        <main className="pt-20 px-6">
          <div className="mx-auto max-w-3xl text-bone/45 text-sm">Loading employer report preview…</div>
        </main>
      </>
    );
  }

  const header = unlocked && report ? report.header : preview.header;
  const cq = unlocked && report ? report.cq : preview.cq;

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
          <ReportHeader header={header} cq={cq} candidateId={params.id} />

          {error && (
            <Card>
              <CardBody className="text-coral text-sm">{error}</CardBody>
            </Card>
          )}

          {!preview.available && (
            <Card>
              <CardBody className="py-10 text-center text-bone/55">
                <Activity className="h-6 w-6 mx-auto mb-3 text-accent animate-pulse" />
                Evaluator is reviewing the session. The employer preview is live now, and the full report will become more useful as evaluation data arrives.
              </CardBody>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader className="bg-[linear-gradient(135deg,_rgba(250,247,238,0.98)_0%,_rgba(242,236,225,0.98)_100%)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
                    Employer Access
                  </div>
                  <div className="mt-1 font-display text-xl font-semibold text-bone">
                    Unlock the complete report or request AI interpretation
                  </div>
                  <div className="mt-2 text-sm text-bone/58 max-w-2xl">
                    {preview.lock_reason}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={unlockReport} disabled={unlocking || unlocked}>
                    {unlocking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Unlocking…
                      </>
                    ) : unlocked ? (
                      <>
                        <FileText className="h-4 w-4" /> Full report unlocked
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" /> {preview.unlock_label}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={analyzeReport} disabled={analysisLoading}>
                    {analysisLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Get AI analysis
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PreviewStat label="Tracked fixes" value={`${preview.snapshot.fixed_bugs}/${preview.snapshot.total_bugs}`} />
                <PreviewStat label="Buddy prompts" value={String(preview.snapshot.ai_prompt_count)} />
                <PreviewStat label="Files opened" value={String(preview.snapshot.files_touched)} />
                <PreviewStat label="Terminal commands" value={String(preview.snapshot.terminal_commands)} />
              </div>
              <div className="rounded-2xl border border-black/[0.06] bg-[#fcfbf7] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-bone/35">
                  Preview Highlights
                </div>
                <div className="mt-3 space-y-2 text-sm text-bone/68">
                  {preview.snapshot.highlights.map((item, index) => (
                    <div key={`${item}-${index}`}>{item}</div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          {analysis && <AnalysisCard analysis={analysis} />}

          {unlocked && report && <PlaybackCTA url={report.playback_url} />}

          {!unlocked ? (
            <LockedReportPreview />
          ) : report ? (
            <FullReport report={report} />
          ) : null}
        </motion.div>
      </main>
    </>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-bone/35">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold text-bone">{value}</div>
    </div>
  );
}

function LockedReportPreview() {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[linear-gradient(180deg,_rgba(255,252,245,0.78)_0%,_rgba(255,252,245,0.92)_100%)] backdrop-blur-[2px]">
        <div className="mx-6 max-w-lg rounded-[28px] border border-[#e2cfad] bg-white/95 px-6 py-6 text-center shadow-card">
          <Lock className="mx-auto h-8 w-8 text-accent" />
          <div className="mt-4 font-display text-2xl font-semibold text-bone">
            Full report is locked
          </div>
          <div className="mt-3 text-sm leading-relaxed text-bone/58">
            The complete activity trail, bug map, integrity signals, and Buddy audit stay hidden until the employer explicitly unlocks the report.
          </div>
        </div>
      </div>
      <CardBody className="space-y-4">
        <div className="grid gap-4 blur-sm">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-black/[0.06] bg-[#fbfaf6] p-5"
            >
              <div className="h-3 w-28 rounded-full bg-black/[0.06]" />
              <div className="mt-4 h-6 w-2/3 rounded-full bg-black/[0.08]" />
              <div className="mt-3 grid gap-2">
                <div className="h-3 rounded-full bg-black/[0.05]" />
                <div className="h-3 rounded-full bg-black/[0.05]" />
                <div className="h-3 w-4/5 rounded-full bg-black/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function AnalysisCard({ analysis }: { analysis: ReportAnalysis }) {
  return (
    <Card className="overflow-hidden border-accent/20">
      <CardHeader className="bg-[linear-gradient(135deg,_rgba(247,244,233,0.98)_0%,_rgba(235,245,238,0.98)_100%)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
              AI Report Analysis
            </div>
            <div className="mt-1 font-display text-xl font-semibold text-bone">
              {recommendationLabel(analysis.recommendation)}
            </div>
            <div className="mt-2 text-sm text-bone/58">
              Confidence {Math.round(analysis.confidence * 100)}% · Generated{" "}
              {new Date(analysis.generated_at).toLocaleString()}
            </div>
          </div>
          <div className="rounded-full border border-black/[0.08] bg-white px-3 py-1 text-xs font-medium text-bone/70">
            {analysis.recommendation.replace("_", " ")}
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="text-sm leading-7 text-bone/76">{analysis.summary}</div>
        <ListBlock title="Highlights" items={analysis.highlights} />
        <ListBlock title="Risks" items={analysis.risks} />
        <ListBlock title="Interview Focus" items={analysis.interview_focus} />
        <div className="rounded-2xl border border-black/[0.06] bg-[#fcfbf7] p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-bone/35">
            Evidence
          </div>
          <div className="mt-3 space-y-3">
            {analysis.evidence.map((item, index) => (
              <div key={`${item.label}-${index}`}>
                <div className="text-sm font-medium text-bone">{item.label}</div>
                <div className="mt-1 text-sm text-bone/60">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-bone/35">{title}</div>
      <div className="mt-3 space-y-2 text-sm text-bone/72">
        {items.map((item, index) => (
          <div key={`${title}-${index}`}>{item}</div>
        ))}
      </div>
    </div>
  );
}

function recommendationLabel(value: ReportAnalysis["recommendation"]) {
  switch (value) {
    case "strong_yes":
      return "Strong Yes Signal";
    case "lean_yes":
      return "Leaning Yes";
    case "lean_no":
      return "Leaning No";
    default:
      return "Mixed Signal";
  }
}

function FullReport({ report }: { report: ReportData }) {
  return (
    <>
      <CQOverview cq={report.cq} />
      <CQBreakdown cq={report.cq} />
      <EmployerMetrics metrics={report.metrics} />
      <BugExposureMap data={report.bug_exposure} />
      <AIInteraction ai={report.ai} />
      <BehaviourPattern behaviour={report.behaviour} heatmap={report.heatmap} />
      <PhaseTimeline phases={report.behaviour_analytics.phases} />
      <PerTicketTime tickets={report.behaviour_analytics.per_ticket} />
      <CodingRhythm data={report.behaviour_analytics.keystrokes} />
      <CodeOriginMap data={report.behaviour_analytics.content_attribution} />
      <IdleAnalysis data={report.behaviour_analytics.idle} />
      <PanelFlow data={report.behaviour_analytics.focus} />
      <IntegrityPanel integrity={report.integrity} />
      <StrategyAnswers answers={report.strategy} />
      <CodeReviewPanel review={report.code_review} />
      <ActivityForensicsPanel data={report.activity_forensics} />
      <BuddyAuditPanel audit={report.buddy_audit} />
      <FeedbackLogPanel feedback={report.feedback_log} />
    </>
  );
}
