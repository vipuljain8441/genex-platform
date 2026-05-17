"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  Code2,
  ListChecks,
  Loader2,
  MessageSquareText,
  Minus,
  PanelRightOpen,
  Send,
  Terminal,
  X,
} from "lucide-react";
import {
  api,
  type CandidateChallenge,
  type ChallengeResponse,
  type ObjectiveQuestion,
} from "@/lib/api";
import { monitor } from "@/lib/monitor";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { ChallengeOverview } from "./ChallengeOverview";
import { ChallengePanel } from "./ChallengePanel";
import { BuddyChat } from "./BuddyChat";

type WorkspaceProps = {
  sessionId: string;
  assessmentId: string;
  challenges: CandidateChallenge[];
  initialFiles: { path: string; language: string; content: string }[];
  entryPoint: string | null;
  durationMinutes: number;
  initialChallengeId: string | null;
  initialResponses: Record<string, ChallengeResponse>;
};

export type SqlResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowcount: number;
  error: string | null;
  running: boolean;
};

type ViewMode = "overview" | "workspace";
type RightTab = "challenges" | "buddy";
type RightPanelState = "open" | "minimized" | "closed";

const MIN_WIDTH = 300;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 380;
const STRIP_WIDTH = 44;

function clampWidth(w: number) {
  return Math.max(MIN_WIDTH, Math.min(w, MAX_WIDTH));
}

export function Workspace({
  sessionId,
  assessmentId,
  challenges,
  durationMinutes,
  initialChallengeId,
  initialResponses,
}: WorkspaceProps) {
  const router = useRouter();

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [rightTab, setRightTab] = useState<RightTab>("challenges");
  const [rightPanelState, setRightPanelState] = useState<RightPanelState>("open");
  const [rightWidth, setRightWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(
    initialChallengeId || challenges[0]?.id || null
  );
  const [responses, setResponses] = useState<Record<string, ChallengeResponse>>(initialResponses);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const sandboxProvisioned = useRef(false);

  const [sqlResults, setSqlResults] = useState<Record<string, SqlResult>>({});
  const responseDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const activeChallenge = challenges.find((c) => c.id === activeChallengeId) || challenges[0] || null;
  const isCodingChallenge = activeChallenge?.kind === "coding";
  const allChallengesComplete = challenges.every((c) => responses[c.id]?.status === "completed");
  const completedCount = challenges.filter((c) => responses[c.id]?.status === "completed").length;
  const submitTooltip = useMemo(() => {
    if (submitting) {
      return "Submitting your assessment…";
    }
    if (allChallengesComplete) {
      return "Submit the full assessment for review.";
    }
    return `Submit your assessment (${completedCount}/${challenges.length} challenges marked complete). You can submit anytime.`;
  }, [submitting, allChallengesComplete, completedCount, challenges.length]);
  const buddyDisabled = activeChallenge ? !activeChallenge.allow_buddy : false;

  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");
  const remaining = Math.max(durationMinutes * 60 - elapsed, 0);
  const remMM = Math.floor(remaining / 60).toString().padStart(2, "0");
  const remSS = (remaining % 60).toString().padStart(2, "0");

  // ── Timer + monitor ─────────────────────────────────────────────────────────
  useEffect(() => {
    monitor.start(sessionId);
    const startedAt = Date.now();
    const tick = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => { clearInterval(tick); monitor.stop(); };
  }, [sessionId]);

  // ── Drag resize ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const drag = dragState.current;
      if (!drag) return;
      setRightWidth(clampWidth(drag.startWidth - (event.clientX - drag.startX)));
    }
    function onMouseUp() {
      if (!dragState.current) return;
      dragState.current = null;
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Auto-commit ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== "workspace" || !sandboxUrl) return;
    const interval = setInterval(async () => {
      try { await api.commitSandbox(sessionId, "chore: candidate checkpoint"); } catch {}
    }, 60_000);
    return () => clearInterval(interval);
  }, [viewMode, sandboxUrl, sessionId]);

  // ── Sandbox ─────────────────────────────────────────────────────────────────
  const ensureSandbox = useCallback(async () => {
    if (sandboxProvisioned.current) return;
    sandboxProvisioned.current = true;
    setSandboxLoading(true);
    try {
      const result = await api.provisionSandbox(sessionId);
      setSandboxUrl(result.url);
    } catch (err) {
      console.error("sandbox provision failed:", err);
      const base = process.env.NEXT_PUBLIC_SANDBOX_URL || "http://localhost:8080";
      setSandboxUrl(`${base}/?folder=${encodeURIComponent(`/home/coder/sessions/${sessionId}`)}`);
    } finally {
      setSandboxLoading(false);
    }
  }, [sessionId]);

  // ── Challenge navigation ────────────────────────────────────────────────────
  async function selectChallenge(challengeId: string) {
    if (challengeId === activeChallengeId) return;
    setActiveChallengeId(challengeId);
    const challenge = challenges.find((c) => c.id === challengeId);
    monitor.event("challenge_switch", null, { challenge_id: challengeId, challenge_kind: challenge?.kind });
    try { await api.setCurrentChallenge(sessionId, challengeId); } catch {}
    if (challenge?.kind === "coding" && viewMode === "workspace") await ensureSandbox();
  }

  async function openChallengeWorkspace(challengeId: string) {
    const challenge = challenges.find((c) => c.id === challengeId);
    if (!challenge) return;
    setActiveChallengeId(challengeId);
    setViewMode("workspace");
    setRightPanelState("open");
    setRightTab("challenges");
    monitor.event("challenge_switch", null, { challenge_id: challengeId, challenge_kind: challenge.kind });
    try { await api.setCurrentChallenge(sessionId, challengeId); } catch {}
    if (challenge.kind === "coding") await ensureSandbox();
  }

  // ── Response helpers ────────────────────────────────────────────────────────
  async function persistChallengeResponse(
    challengeId: string,
    body: { status?: "pending" | "in_progress" | "completed"; answer_text?: string; selected_option_ids?: Record<string, string[]> }
  ) {
    try {
      const next = await api.saveChallengeResponse(sessionId, challengeId, body);
      setResponses(next.challenge_responses);
    } catch {}
  }

  function updateChallengeStatus(challengeId: string, status: "pending" | "in_progress" | "completed") {
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || { challenge_id: challengeId, challenge_kind: challenges.find((c) => c.id === challengeId)?.kind || "coding", answer_text: "", selected_option_ids: {}, updated_at: new Date().toISOString() }),
        status,
        updated_at: new Date().toISOString(),
      },
    }));
    monitor.event("challenge_response", null, { challenge_id: challengeId, status });
    void persistChallengeResponse(challengeId, { status });
    void api.commitSandbox(sessionId, `chore: challenge ${challengeId} marked ${status}`).catch(() => {});
  }

  function updateChallengeAnswerText(challengeId: string, value: string) {
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || { challenge_id: challengeId, challenge_kind: "theory", status: "in_progress", selected_option_ids: {}, updated_at: new Date().toISOString(), answer_text: "" }),
        answer_text: value,
        status: value.trim() ? "in_progress" : prev[challengeId]?.status || "pending",
        updated_at: new Date().toISOString(),
      },
    }));
    const existing = responseDebounce.current[challengeId];
    if (existing) clearTimeout(existing);
    responseDebounce.current[challengeId] = setTimeout(() => {
      void persistChallengeResponse(challengeId, { answer_text: value, status: value.trim() ? "in_progress" : "pending" });
    }, 500);
  }

  function toggleObjectiveOption(challengeId: string, question: ObjectiveQuestion, optionId: string) {
    const current = responses[challengeId]?.selected_option_ids || {};
    const selected = new Set(current[question.id] || []);
    if (question.multi_select) {
      if (selected.has(optionId)) selected.delete(optionId); else selected.add(optionId);
    } else { selected.clear(); selected.add(optionId); }
    const nextSelected = { ...current, [question.id]: Array.from(selected) };
    const challenge = challenges.find((c) => c.id === challengeId);
    const allAnswered = !!challenge?.objective_questions.every((q) => (nextSelected[q.id] || []).length > 0);
    const nextStatus = allAnswered ? "completed" : "in_progress";
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || { challenge_id: challengeId, challenge_kind: "objective", status: "in_progress", answer_text: "", updated_at: new Date().toISOString() }),
        selected_option_ids: nextSelected,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      },
    }));
    void persistChallengeResponse(challengeId, { selected_option_ids: nextSelected, status: nextStatus });
  }

  // ── SQL runner ──────────────────────────────────────────────────────────────
  async function runSQL(challengeId: string, query: string) {
    setSqlResults((prev) => ({ ...prev, [challengeId]: { columns: [], rows: [], rowcount: 0, error: null, running: true } }));
    try {
      const result = await api.runSQL(sessionId, query);
      setSqlResults((prev) => ({ ...prev, [challengeId]: { ...result, running: false } }));
    } catch (e: any) {
      setSqlResults((prev) => ({ ...prev, [challengeId]: { columns: [], rows: [], rowcount: 0, error: e.message, running: false } }));
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function submit() {
    setSubmitting(true);
    monitor.event("submit", null, { assessment_id: assessmentId });
    monitor.stop();
    try { await api.commitSandbox(sessionId, "chore: final submission snapshot"); } catch {}
    try { await api.syncSandbox(sessionId); } catch {}
    try {
      await api.submit(sessionId);
      router.push(`/results/${sessionId}`);
    } catch (e: any) {
      alert(`Submit failed: ${e.message}`);
      monitor.start(sessionId);
      setSubmitting(false);
    }
  }

  function startResize(clientX: number) {
    dragState.current = { startX: clientX, startWidth: rightWidth };
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const panelWidth = rightPanelState === "open"
    ? rightWidth
    : rightPanelState === "minimized"
      ? STRIP_WIDTH
      : 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-ink">
      {/* ── Header ── */}
      <header className="h-14 flex-shrink-0 flex items-center justify-between border-b border-black/[0.06] px-4 bg-ink-50/85 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="hidden md:flex items-center gap-2">
            <Badge tone="accent">
              <Code2 className="h-3 w-3" />
              {viewMode === "overview" ? "Assessment Overview" : "Candidate Workspace"}
            </Badge>
            <Badge>{completedCount}/{Math.max(challenges.length, 1)} done</Badge>
            <span className="text-[11px] text-bone/40 font-mono">{sessionId.slice(-8)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs flex items-center gap-1.5 text-bone/55 font-mono">
            <Clock className="h-3.5 w-3.5" />
            <span>{mm}:{ss}</span>
            <span className="text-bone/30">·</span>
            <span className={remaining < 300 ? "text-coral" : "text-bone/55"}>
              {remMM}:{remSS} left
            </span>
          </div>

          {viewMode === "workspace" && (
            <Button onClick={() => setViewMode("overview")} size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4" /> All challenges
            </Button>
          )}

          {viewMode === "workspace" && rightPanelState === "closed" && (
            <Button
              onClick={() => setRightPanelState("open")}
              size="sm"
              variant="outline"
            >
              <PanelRightOpen className="h-4 w-4" /> Open panel
            </Button>
          )}

          {viewMode === "workspace" && isCodingChallenge && sandboxUrl && (
            <a
              href={sandboxUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-xs text-bone/70 hover:text-bone transition"
            >
              <Terminal className="h-3.5 w-3.5" /> Full screen
            </a>
          )}

          <Button
            onClick={submit}
            disabled={submitting}
            size="sm"
            title={submitTooltip}
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Send className="h-4 w-4" /> Submit</>}
          </Button>
        </div>
      </header>

      {/* ── Body ── */}
      {viewMode === "overview" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex-1 min-h-0 overflow-hidden"
        >
          <ChallengeOverview
            challenges={challenges}
            activeChallengeId={activeChallengeId}
            responses={responses}
            onOpenChallenge={openChallengeWorkspace}
          />
        </motion.div>
      ) : (
        <motion.div
          key="workspace"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="flex-1 min-h-0 flex overflow-hidden"
        >
          {/* ── Main content ── */}
          <section
            className={cn(
              "flex-1 min-w-0 min-h-0 relative overflow-hidden",
              isCodingChallenge
                ? "bg-[#1e1e1e]"
                : "bg-[radial-gradient(circle_at_top_left,_rgba(244,200,110,0.12),_transparent_30%),linear-gradient(180deg,_#fbf7ee_0%,_#f4efe3_100%)]"
            )}
          >
            {isCodingChallenge ? (
              <>
                {sandboxLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#1e1e1e] text-white/60">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm font-medium text-white/80">Preparing workspace</p>
                    <p className="text-xs">Setting up your coding environment…</p>
                  </div>
                )}
                {!sandboxLoading && !sandboxUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e] text-white/50">
                    <Code2 className="h-10 w-10 opacity-30" />
                    <p className="text-sm">Workspace not provisioned</p>
                    <button onClick={ensureSandbox} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/70 transition">
                      Retry
                    </button>
                  </div>
                )}
                {!sandboxLoading && sandboxUrl && (
                  <iframe
                    src={sandboxUrl}
                    className="w-full h-full border-0"
                    allow="clipboard-read; clipboard-write; fullscreen"
                    title="VS Code Editor"
                  />
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-2 text-bone/40">
                  <ListChecks className="h-10 w-10 mx-auto opacity-40" />
                  <p className="text-sm">Answer the challenge in the panel →</p>
                </div>
              </div>
            )}
          </section>

          {/* ── Right panel ── */}
          {rightPanelState !== "closed" && (
            <aside
              className={cn(
                "flex-shrink-0 border-l border-black/[0.06] bg-[#f8f4ea] min-h-0 flex flex-col relative overflow-hidden",
                !isDragging && "transition-[width] duration-200 ease-out"
              )}
              style={{ width: panelWidth }}
            >
              {rightPanelState === "minimized" ? (
                /* ── Minimized strip ── */
                <div className="flex flex-col items-center gap-2 pt-3 pb-3">
                  <button
                    onClick={() => setRightPanelState("open")}
                    title="Expand panel"
                    className="p-2 rounded-lg text-bone/40 hover:text-bone hover:bg-black/[0.06] transition"
                  >
                    <PanelRightOpen className="h-4 w-4 rotate-180" />
                  </button>
                  <div className="w-px h-3 bg-black/[0.08]" />
                  <button
                    onClick={() => { setRightPanelState("open"); setRightTab("challenges"); }}
                    title="Challenges"
                    className={cn(
                      "p-2 rounded-lg transition",
                      rightTab === "challenges" ? "bg-accent/15 text-accent" : "text-bone/40 hover:text-bone hover:bg-black/[0.06]"
                    )}
                  >
                    <ListChecks className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setRightPanelState("open"); setRightTab("buddy"); }}
                    title="Buddy"
                    className={cn(
                      "p-2 rounded-lg transition",
                      rightTab === "buddy" ? "bg-accent/15 text-accent" : "text-bone/40 hover:text-bone hover:bg-black/[0.06]"
                    )}
                  >
                    <MessageSquareText className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  {/* ── Resize handle (left edge) ── */}
                  <div
                    onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => startResize(e.clientX)}
                    className="absolute left-0 top-0 bottom-0 z-20 w-2 cursor-col-resize group"
                  >
                    <div className="mx-auto h-full w-px bg-black/[0.08] transition group-hover:bg-accent/50" />
                  </div>

                  {/* ── Tab bar ── */}
                  <div className="flex-shrink-0 flex items-center gap-1 px-2 pt-2 pb-0 border-b border-black/[0.06]">
                    <button
                      onClick={() => setRightTab("challenges")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition border-b-2 -mb-px",
                        rightTab === "challenges"
                          ? "border-accent text-accent bg-white/60"
                          : "border-transparent text-bone/50 hover:text-bone hover:bg-black/[0.04]"
                      )}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      Challenges
                    </button>
                    <button
                      onClick={() => setRightTab("buddy")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition border-b-2 -mb-px",
                        rightTab === "buddy"
                          ? "border-accent text-accent bg-white/60"
                          : "border-transparent text-bone/50 hover:text-bone hover:bg-black/[0.04]"
                      )}
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      Buddy
                    </button>

                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        onClick={() => setRightPanelState("minimized")}
                        title="Minimize panel"
                        className="p-1.5 rounded-md text-bone/40 hover:text-bone hover:bg-black/[0.06] transition"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setRightPanelState("closed")}
                        title="Close panel"
                        className="p-1.5 rounded-md text-bone/40 hover:text-bone hover:bg-black/[0.06] transition"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* ── Panel content ── */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {rightTab === "challenges" ? (
                      <ChallengePanel
                        challenges={challenges}
                        activeChallengeId={activeChallengeId}
                        responses={responses}
                        sqlResults={sqlResults}
                        onSelectChallenge={selectChallenge}
                        onChangeStatus={updateChallengeStatus}
                        onChangeAnswerText={updateChallengeAnswerText}
                        onToggleObjectiveOption={toggleObjectiveOption}
                        onRunSQL={runSQL}
                      />
                    ) : (
                      <BuddyChat
                        sessionId={sessionId}
                        challengeId={activeChallenge?.id}
                        disabled={buddyDisabled}
                        disabledReason="Buddy is disabled for theory and objective challenges."
                        workspace={{}}
                      />
                    )}
                  </div>
                </>
              )}
            </aside>
          )}
        </motion.div>
      )}
    </div>
  );
}
