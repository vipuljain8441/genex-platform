"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Flag,
  Clock,
  Code2,
  Loader2,
  Maximize2,
  MessageSquareText,
  Send,
  X,
} from "lucide-react";
import {
  api,
  type CandidateChallenge,
  type ChallengeResponse,
  type FeedbackCategory,
  type ObjectiveQuestion,
} from "@/lib/api";
import { behaviourTracker } from "@/lib/behaviour-tracker";
import { monitor } from "@/lib/monitor";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { ChallengeOverview } from "./ChallengeOverview";
import { ChallengePanel } from "./ChallengePanel";
import { ChallengesTopBar } from "./ChallengesTopBar";
import { BuddyDock } from "./BuddyDock";

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
type PanelSectionState = "expanded" | "minimized" | "closed";

const DEFAULT_BUDDY_WIDTH = 380;
const DEFAULT_BRIEF_HEIGHT = 280;
const MIN_BRIEF_HEIGHT = 120;
const MAX_BRIEF_HEIGHT = 640;
const FEEDBACK_OPTIONS: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: "general", label: "General", hint: "Anything that would help the employer understand the session." },
  { value: "challenge", label: "Challenge", hint: "Problem statement, scope, or expectation was unclear." },
  { value: "workspace", label: "Workspace", hint: "Editor, files, terminal, or sandbox issue." },
  { value: "buddy", label: "Buddy", hint: "AI assistant response quality or behavior issue." },
  { value: "bug", label: "Bug", hint: "Assessment flow or product bug." },
  { value: "performance", label: "Performance", hint: "Latency, freezing, or slow interactions." },
  { value: "clarity", label: "Clarity", hint: "Instructions, labels, or UX confusion." },
  { value: "other", label: "Other", hint: "Something else worth sharing." },
];

export function Workspace({
  sessionId,
  assessmentId,
  challenges,
  initialFiles,
  entryPoint,
  durationMinutes,
  initialChallengeId,
  initialResponses,
}: WorkspaceProps) {
  const router = useRouter();

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [buddyPanelState, setBuddyPanelState] = useState<PanelSectionState>("expanded");
  const [buddyWidth, setBuddyWidth] = useState(DEFAULT_BUDDY_WIDTH);
  const [briefHeight, setBriefHeight] = useState(DEFAULT_BRIEF_HEIGHT);
  const briefDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const [isBriefDragging, setIsBriefDragging] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>("general");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

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
  const suppressFullscreenLock = useRef(false);

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
    behaviourTracker.start();
    const startedAt = Date.now();
    const tick = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => {
      clearInterval(tick);
      behaviourTracker.stop();
      monitor.stop();
    };
  }, [sessionId]);

  useEffect(() => {
    behaviourTracker.setTicket(activeChallengeId);
  }, [activeChallengeId]);

  useEffect(() => {
    function syncFullscreenState() {
      const next = typeof document !== "undefined" && !!document.fullscreenElement;
      setIsFullscreen(next);
      if (next) {
        setFullscreenError(null);
        monitor.event("window_focus", null, { reason: "fullscreen_enter" });
      } else if (!suppressFullscreenLock.current) {
        monitor.event("window_blur", null, { reason: "fullscreen_exit" });
      }
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (suppressFullscreenLock.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (viewMode === "overview") {
      behaviourTracker.setPanel("tickets");
      return;
    }
    if (buddyPanelState === "expanded") {
      behaviourTracker.setPanel("ai");
      return;
    }
    if (!isCodingChallenge) {
      behaviourTracker.setPanel("tickets");
      return;
    }
    behaviourTracker.setPanel("editor");
  }, [viewMode, buddyPanelState, isCodingChallenge]);

  // ── Auto-commit ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== "workspace" || !sandboxUrl) return;
    const interval = setInterval(async () => {
      try { await api.commitSandbox(sessionId, "chore: candidate checkpoint"); } catch {}
    }, 60_000);
    return () => clearInterval(interval);
  }, [viewMode, sandboxUrl, sessionId]);

  useEffect(() => {
    if (viewMode !== "workspace" || !isCodingChallenge || !sandboxUrl) return;
    const interval = setInterval(async () => {
      try {
        const sync = await api.syncSandbox(sessionId);
        if (sync.changed_files.length > 0) {
          behaviourTracker.recordContentSnapshot(sync.changed_files);
        }
      } catch {}
    }, 12_000);
    return () => clearInterval(interval);
  }, [viewMode, isCodingChallenge, sandboxUrl, sessionId]);

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

  useEffect(() => {
    function onMouseMove(event: globalThis.MouseEvent) {
      const drag = briefDragState.current;
      if (!drag) return;
      const next = drag.startHeight + (event.clientY - drag.startY);
      setBriefHeight(Math.max(MIN_BRIEF_HEIGHT, Math.min(MAX_BRIEF_HEIGHT, next)));
    }
    function onMouseUp() {
      if (!briefDragState.current) return;
      briefDragState.current = null;
      setIsBriefDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    globalThis.addEventListener("mousemove", onMouseMove);
    globalThis.addEventListener("mouseup", onMouseUp);
    return () => {
      globalThis.removeEventListener("mousemove", onMouseMove);
      globalThis.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function startBriefResize(clientY: number) {
    briefDragState.current = { startY: clientY, startHeight: briefHeight };
    setIsBriefDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  // ── Challenge navigation ────────────────────────────────────────────────────
  async function selectChallenge(challengeId: string) {
    if (challengeId === activeChallengeId) return;
    setActiveChallengeId(challengeId);
    const challenge = challenges.find((c) => c.id === challengeId);
    monitor.event("challenge_switch", null, { challenge_id: challengeId, challenge_kind: challenge?.kind });
    behaviourTracker.markActivity(
      challenge?.kind === "coding" ? "editor" : "ticket",
      "challenge_switch"
    );
    try { await api.setCurrentChallenge(sessionId, challengeId); } catch {}
    if (challenge?.kind === "coding" && viewMode === "workspace") await ensureSandbox();
  }

  async function openChallengeWorkspace(challengeId: string) {
    const challenge = challenges.find((c) => c.id === challengeId);
    if (!challenge) return;
    setActiveChallengeId(challengeId);
    setViewMode("workspace");
    setBuddyPanelState((current) => (current === "closed" ? "minimized" : current));
    monitor.event("challenge_switch", null, { challenge_id: challengeId, challenge_kind: challenge.kind });
    behaviourTracker.markActivity(
      challenge.kind === "coding" ? "editor" : "ticket",
      "challenge_switch"
    );
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
    behaviourTracker.markActivity("ticket", "challenge_response");
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
    behaviourTracker.markActivity("ticket", "challenge_response");
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
    behaviourTracker.markActivity("ticket", "challenge_response");
    void persistChallengeResponse(challengeId, { selected_option_ids: nextSelected, status: nextStatus });
  }

  // ── SQL runner ──────────────────────────────────────────────────────────────
  async function runSQL(challengeId: string, query: string) {
    behaviourTracker.setPanel("terminal");
    behaviourTracker.markActivity("terminal", "terminal_command");
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
    suppressFullscreenLock.current = true;
    behaviourTracker.markActivity("submit", "submit");
    monitor.event("submit", null, { assessment_id: assessmentId });
    behaviourTracker.stop();
    monitor.stop();
    try { await api.commitSandbox(sessionId, "chore: final submission snapshot"); } catch {}
    try {
      const sync = await api.syncSandbox(sessionId);
      if (sync.changed_files.length > 0) {
        behaviourTracker.recordContentSnapshot(sync.changed_files);
      }
    } catch {}
    try {
      await api.submit(sessionId);
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch {}
      }
      router.push(`/candidate/submitted/${sessionId}`);
    } catch (e: any) {
      alert(`Submit failed: ${e.message}`);
      suppressFullscreenLock.current = false;
      monitor.start(sessionId);
      setSubmitting(false);
    }
  }

  async function requestFullscreenMode() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root.requestFullscreen) {
      setFullscreenError("This browser does not support fullscreen mode for the assessment.");
      return;
    }
    try {
      await root.requestFullscreen();
      setFullscreenError(null);
    } catch (e: any) {
      setFullscreenError(e?.message || "Fullscreen was blocked. Please allow fullscreen to continue.");
    }
  }

  async function exitWorkspace() {
    suppressFullscreenLock.current = true;
    behaviourTracker.stop();
    monitor.stop();
    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch {}
    }
    router.push("/");
  }

  async function submitFeedback() {
    const message = feedbackMessage.trim();
    if (message.length < 8) {
      setFeedbackNotice("Please share a little more detail so the employer can understand the issue.");
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackNotice(null);
    try {
      await api.submitFeedback(sessionId, {
        category: feedbackCategory,
        message,
        challenge_id: activeChallenge?.id || null,
      });
      monitor.event("feedback_submit", null, {
        category: feedbackCategory,
        challenge_id: activeChallenge?.id,
        message_length: message.length,
      });
      setFeedbackMessage("");
      setFeedbackCategory("general");
      setFeedbackNotice("Report shared with the employer.");
      window.setTimeout(() => {
        setFeedbackOpen(false);
        setFeedbackNotice(null);
      }, 900);
    } catch (e: any) {
      setFeedbackNotice(e?.message || "Could not submit report right now.");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  function openBuddyPanel() {
    setBuddyPanelState("expanded");
    behaviourTracker.setPanel("ai");
  }

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

          {viewMode === "workspace" && (
            <Button
              onClick={openBuddyPanel}
              size="sm"
              variant="outline"
            >
              <MessageSquareText className="h-4 w-4" /> Buddy
            </Button>
          )}

          <Button
            onClick={() => {
              setFeedbackOpen(true);
              setFeedbackNotice(null);
            }}
            size="sm"
            variant="outline"
          >
            <Flag className="h-4 w-4" /> Report
          </Button>

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
          className="flex-1 min-h-0 flex flex-col overflow-hidden relative"
        >
          {/* ── Top: challenges position bar ── */}
          <ChallengesTopBar
            challenges={challenges}
            activeChallengeId={activeChallengeId}
            responses={responses}
            onSelectChallenge={selectChallenge}
          />

          {/* ── Main row: editor / answer UI + buddy sidebar ── */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              {isCodingChallenge ? (
                <>
                  <div
                    className="flex-shrink-0 relative overflow-hidden bg-[linear-gradient(180deg,_#fbf7ee_0%,_#f4efe3_100%)]"
                    style={{ height: briefHeight }}
                  >
                    <div className="absolute inset-0">
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
                        showSelector={false}
                      />
                    </div>
                  </div>
                  <div
                    onMouseDown={(e) => startBriefResize(e.clientY)}
                    onDoubleClick={() => setBriefHeight(DEFAULT_BRIEF_HEIGHT)}
                    className={cn(
                      "group relative h-1.5 flex-shrink-0 cursor-row-resize border-y border-[#decba9]/70 bg-[#e8d6b6]/40 transition hover:bg-accent/30",
                      isBriefDragging && "bg-accent/40"
                    )}
                    title="Drag to resize"
                  >
                    <div className="absolute left-1/2 top-1/2 h-1 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bone/25 transition group-hover:bg-accent/60" />
                  </div>
                  <section className="flex flex-1 min-h-0 flex-col relative bg-[#1e1e1e]">
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
                        className="w-full h-full min-h-0 flex-1 border-0"
                        allow="clipboard-read; clipboard-write"
                        title="VS Code Editor"
                      />
                    )}
                  </section>
                </>
              ) : (
                <div className="flex-1 min-h-0 bg-[linear-gradient(180deg,_#fbf7ee_0%,_#f4efe3_100%)]">
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
                </div>
              )}
            </div>

            <BuddyDock
              hidden={buddyPanelState === "closed"}
              minimized={buddyPanelState === "minimized"}
              width={buddyWidth}
              onWidthChange={setBuddyWidth}
              onToggleMinimize={() =>
                setBuddyPanelState((current) =>
                  current === "expanded" ? "minimized" : "expanded"
                )
              }
              onClose={() => setBuddyPanelState("closed")}
              sessionId={sessionId}
              challengeId={activeChallenge?.id}
              disabled={buddyDisabled}
              disabledReason="Buddy is disabled for this challenge."
              onApplyEdit={(filePath, newContent, rationale) => {
                monitor.event("buddy_edit_action", filePath, {
                  action: "applied",
                  challenge_id: activeChallenge?.id,
                  rationale,
                  content_length: newContent.length,
                });
              }}
              onDismissEdit={(filePath, rationale) => {
                monitor.event("buddy_edit_action", filePath, {
                  action: "dismissed",
                  challenge_id: activeChallenge?.id,
                  rationale,
                });
              }}
            />
          </div>
        </motion.div>
      )}

      {feedbackOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#1f1506]/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-[28px] border border-[#dcc8a8] bg-[linear-gradient(180deg,_rgba(255,253,248,0.98)_0%,_rgba(247,239,223,0.98)_100%)] shadow-[0_28px_80px_rgba(40,27,4,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#dcc8a8] px-6 py-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-bone/40">
                  Candidate Report
                </div>
                <div className="mt-1 text-xl font-semibold text-bone">
                  Share an issue or note with the employer
                </div>
                <p className="mt-2 text-sm leading-relaxed text-bone/55">
                  This is for product issues, unclear instructions, workspace problems, or anything else you want the employer to review later.
                </p>
              </div>
              <button
                onClick={() => setFeedbackOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-2xl bg-white/90 text-bone/45 ring-1 ring-black/[0.06] transition hover:text-bone"
                title="Close report"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="rounded-2xl border border-black/[0.06] bg-white/75 px-4 py-3 text-sm text-bone/65">
                {activeChallenge ? (
                  <>
                    Attached to <span className="font-medium text-bone">{activeChallenge.title}</span>
                    {activeChallenge.kind ? ` · ${activeChallenge.kind}` : ""}
                  </>
                ) : (
                  "This will be recorded as a general assessment report."
                )}
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-bone/45">
                  Category
                </label>
                <select
                  value={feedbackCategory}
                  onChange={(event) => setFeedbackCategory(event.target.value as FeedbackCategory)}
                  className="w-full rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-sm text-bone outline-none transition focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.14)]"
                >
                  {FEEDBACK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-bone/45">
                  {FEEDBACK_OPTIONS.find((option) => option.value === feedbackCategory)?.hint}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-bone/45">
                  What happened?
                </label>
                <textarea
                  value={feedbackMessage}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  placeholder="Describe the issue, confusion, or anything you want the employer to know."
                  className="min-h-[170px] w-full rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-sm leading-relaxed text-bone outline-none transition focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.14)]"
                />
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-bone/40">
                  <span>Include as much context as you need.</span>
                  <span>{feedbackMessage.trim().length} chars</span>
                </div>
              </div>

              {feedbackNotice && (
                <div className="rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-sm text-bone/65">
                  {feedbackNotice}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setFeedbackOpen(false)}
                  disabled={feedbackSubmitting}
                >
                  Close
                </Button>
                <Button
                  onClick={submitFeedback}
                  disabled={feedbackSubmitting}
                >
                  {feedbackSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Flag className="h-4 w-4" /> Send report</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isFullscreen && !suppressFullscreenLock.current && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1a1204]/82 px-4 backdrop-blur-md">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-[#dcc8a8] bg-[linear-gradient(180deg,_rgba(255,253,248,0.98)_0%,_rgba(247,239,223,0.98)_100%)] shadow-[0_28px_80px_rgba(40,27,4,0.28)]">
            <div className="border-b border-[#dcc8a8] px-6 py-5">
              <div className="text-[10px] uppercase tracking-[0.24em] text-bone/40">
                Fullscreen Required
              </div>
              <div className="mt-2 text-2xl font-semibold text-bone">
                Return to fullscreen to continue the assessment
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone/60">
                This session is designed to stay in fullscreen while the candidate is inside the workspace.
                If fullscreen is exited, interaction stays locked until fullscreen is restored or the workspace is exited.
              </p>
            </div>
            <div className="space-y-4 px-6 py-6">
              <div className="rounded-2xl border border-black/[0.06] bg-white/75 px-4 py-3 text-sm text-bone/65">
                Tab switches, blur events, and fullscreen exits are still tracked in the assessment activity log.
              </div>
              {fullscreenError && (
                <div className="rounded-2xl border border-coral/25 bg-coral/10 px-4 py-3 text-sm text-coral">
                  {fullscreenError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3">
                <Button variant="ghost" onClick={exitWorkspace}>
                  Exit workspace
                </Button>
                <Button onClick={requestFullscreenMode}>
                  <Maximize2 className="h-4 w-4" /> Enter fullscreen
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
