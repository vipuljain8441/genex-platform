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
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
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
import { behaviourTracker } from "@/lib/behaviour-tracker";
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
type PanelSectionState = "expanded" | "minimized" | "closed";

const MIN_WIDTH = 300;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 380;
const MIN_SECTION_HEIGHT = 180;
const MINIMIZED_SECTION_HEIGHT = 58;
const DEFAULT_CHALLENGE_SECTION_HEIGHT = 360;
const PANEL_PEEK_WIDTH = 56;

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
  const [challengePanelState, setChallengePanelState] = useState<PanelSectionState>("expanded");
  const [buddyPanelState, setBuddyPanelState] = useState<PanelSectionState>("expanded");
  const [rightWidth, setRightWidth] = useState(DEFAULT_WIDTH);
  const [challengePanelHeight, setChallengePanelHeight] = useState(DEFAULT_CHALLENGE_SECTION_HEIGHT);
  const [panelSlidOut, setPanelSlidOut] = useState(false);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const [isSectionDragging, setIsSectionDragging] = useState(false);

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
  const sidebarDragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const sectionDragState = useRef<{
    startY: number;
    startHeight: number;
    containerHeight: number;
  } | null>(null);
  const sectionContainerRef = useRef<HTMLDivElement | null>(null);

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
    if (viewMode === "overview") {
      behaviourTracker.setPanel("tickets");
      return;
    }
    if (buddyPanelState === "expanded") {
      behaviourTracker.setPanel("ai");
      return;
    }
    if (challengePanelState === "expanded" || !isCodingChallenge) {
      behaviourTracker.setPanel("tickets");
      return;
    }
    behaviourTracker.setPanel("editor");
  }, [viewMode, buddyPanelState, challengePanelState, isCodingChallenge]);

  // ── Drag resize ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const sidebarDrag = sidebarDragState.current;
      if (sidebarDrag) {
        setRightWidth(clampWidth(sidebarDrag.startWidth - (event.clientX - sidebarDrag.startX)));
      }
      const sectionDrag = sectionDragState.current;
      if (sectionDrag) {
        const maxHeight = Math.max(
          MIN_SECTION_HEIGHT,
          sectionDrag.containerHeight - MIN_SECTION_HEIGHT
        );
        const nextHeight = Math.max(
          MIN_SECTION_HEIGHT,
          Math.min(maxHeight, sectionDrag.startHeight + (event.clientY - sectionDrag.startY))
        );
        setChallengePanelHeight(nextHeight);
      }
    }
    function onMouseUp() {
      sidebarDragState.current = null;
      sectionDragState.current = null;
      setIsSidebarDragging(false);
      setIsSectionDragging(false);
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
    setChallengePanelState("expanded");
    setBuddyPanelState((current) => (current === "closed" ? "expanded" : current));
    setPanelSlidOut(false);
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
      router.push(`/candidate/submitted/${sessionId}`);
    } catch (e: any) {
      alert(`Submit failed: ${e.message}`);
      monitor.start(sessionId);
      setSubmitting(false);
    }
  }

  function startResize(clientX: number) {
    sidebarDragState.current = { startX: clientX, startWidth: rightWidth };
    setIsSidebarDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function startSectionResize(clientY: number) {
    const container = sectionContainerRef.current;
    if (!container) return;
    sectionDragState.current = {
      startY: clientY,
      startHeight: challengePanelHeight,
      containerHeight: container.clientHeight,
    };
    setIsSectionDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function openChallengePanel() {
    setChallengePanelState("expanded");
    setPanelSlidOut(false);
    behaviourTracker.setPanel("tickets");
  }

  function openBuddyPanel() {
    setBuddyPanelState("expanded");
    setPanelSlidOut(false);
    behaviourTracker.setPanel("ai");
  }

  const panelOpen = challengePanelState !== "closed" || buddyPanelState !== "closed";
  const panelWidth = panelOpen ? rightWidth : 0;
  const sectionCardWidth = Math.max(Math.min(rightWidth - 88, 420), 240);
  const panelSlideX = panelOpen && panelSlidOut ? Math.max(panelWidth - PANEL_PEEK_WIDTH, 0) : 0;

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
              onClick={openChallengePanel}
              size="sm"
              variant="outline"
            >
              <ListChecks className="h-4 w-4" /> Challenges
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

          {viewMode === "workspace" && panelOpen && (
            <Button
              onClick={() => setPanelSlidOut((current) => !current)}
              size="sm"
              variant="outline"
            >
              {panelSlidOut ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {panelSlidOut ? "Slide In" : "Slide Out"}
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
          className="flex-1 min-h-0 flex overflow-hidden relative"
        >
          {/* ── Main content ── */}
          <section
            className={cn(
              "flex-1 min-w-0 min-h-0 relative overflow-hidden transition-[filter] duration-300",
              isCodingChallenge
                ? "bg-[#1e1e1e]"
                : "bg-[radial-gradient(circle_at_top_left,_rgba(244,200,110,0.12),_transparent_30%),linear-gradient(180deg,_#fbf7ee_0%,_#f4efe3_100%)]"
            )}
            style={{
              filter: panelOpen ? "saturate(0.96)" : "none",
            }}
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
          {panelOpen && (
            <motion.aside
              initial={false}
              animate={{
                width: panelWidth,
                x: panelSlideX,
                opacity: 1,
              }}
              transition={{
                width: isSidebarDragging ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 },
                x: isSidebarDragging ? { duration: 0 } : { type: "spring", stiffness: 250, damping: 30 },
                opacity: { duration: 0.16 },
              }}
              className={cn(
                "absolute right-0 top-0 bottom-0 z-20 border-l border-[#d9c9ac]/70 bg-[linear-gradient(180deg,_rgba(255,252,245,0.98)_0%,_rgba(247,239,223,0.96)_52%,_rgba(239,229,209,0.96)_100%)] backdrop-blur-md min-h-0 flex flex-col overflow-hidden shadow-[-28px_0_70px_rgba(53,38,16,0.16)] rounded-l-[28px]"
              )}
              style={{ width: panelWidth }}
            >
              <div className="absolute left-0 top-0 bottom-0 z-40 w-14 border-r border-[#dcc9aa]/80 bg-[linear-gradient(180deg,_rgba(255,252,246,0.96)_0%,_rgba(245,235,216,0.92)_100%)]">
                <div className="flex h-full flex-col items-center justify-between py-4">
                  <button
                    onClick={() => setPanelSlidOut((current) => !current)}
                    title={panelSlidOut ? "Slide panel left" : "Slide panel right"}
                    className="grid h-9 w-9 place-items-center rounded-2xl bg-white/95 text-bone/65 shadow-sm ring-1 ring-[#d9c8aa] transition hover:text-bone hover:ring-accent/25"
                  >
                    {panelSlidOut ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={openChallengePanel}
                      className="grid h-9 w-9 place-items-center rounded-2xl bg-accent/10 text-accent transition hover:bg-accent/16"
                      title="Open challenges"
                    >
                      <ListChecks className="h-4 w-4" />
                    </button>
                    <button
                      onClick={openBuddyPanel}
                      className="grid h-9 w-9 place-items-center rounded-2xl bg-[#1f7ae0]/10 text-[#1f7ae0] transition hover:bg-[#1f7ae0]/16"
                      title="Open buddy"
                    >
                      <MessageSquareText className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-bone/35 [writing-mode:vertical-rl] rotate-180">
                    Slide
                  </div>
                </div>
              </div>

              {/* ── Resize handle (left edge) ── */}
              {!panelSlidOut && (
                <div
                  onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => startResize(e.clientX)}
                  onDoubleClick={() => setRightWidth(DEFAULT_WIDTH)}
                  className="absolute -left-3 top-0 bottom-0 z-30 w-6 cursor-col-resize group"
                  title="Drag to resize"
                >
                  <div className="absolute left-1/2 top-1/2 flex h-24 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 shadow-sm ring-1 ring-black/[0.06] transition group-hover:bg-white group-hover:ring-accent/25">
                    <div className="h-10 w-1 rounded-full bg-black/[0.12] transition group-hover:bg-accent/45" />
                  </div>
                </div>
              )}

              <div
                className={cn(
                  "ml-14 transition-opacity duration-200",
                  panelSlidOut && "pointer-events-none opacity-0"
                )}
              >
              <div className="flex-shrink-0 border-b border-[#d8c7a8]/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.88)_0%,_rgba(255,249,238,0.78)_100%)] px-4 py-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40">
                  Assessment Side Panel
                </div>
                <div className="mt-1 text-base font-semibold text-bone">
                  Challenges and Buddy
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-bone/50">
                  Resize the panel horizontally, then scroll left or right inside this side panel.
                </div>
              </div>

              <div
                className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-thin p-3"
              >
                <div className="flex h-full min-w-full gap-3 pr-3 snap-x snap-mandatory">
                {challengePanelState !== "closed" && (
                  <section
                    className="min-h-0 h-full flex-none overflow-hidden rounded-[22px] border border-[#dcc9a8]/85 bg-[linear-gradient(180deg,_rgba(255,255,255,0.94)_0%,_rgba(252,246,236,0.94)_100%)] shadow-[0_14px_28px_rgba(68,50,22,0.08)] flex flex-col snap-start"
                    style={{
                      width: challengePanelState === "minimized" ? 108 : sectionCardWidth,
                    }}
                  >
                    <div className="flex items-center gap-3 border-b border-black/[0.06] bg-[#fffaf0] px-3 py-2">
                      <div className="grid h-8 w-8 place-items-center rounded-xl bg-accent/12 text-accent">
                        <ListChecks className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bone">Challenges</div>
                        <div className="text-[11px] text-bone/50">
                          {completedCount}/{Math.max(challenges.length, 1)} completed
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => setChallengePanelState((current) => current === "expanded" ? "minimized" : "expanded")}
                          title={challengePanelState === "expanded" ? "Minimize challenges" : "Expand challenges"}
                          className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
                        >
                          {challengePanelState === "expanded" ? <Minus className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => setChallengePanelState("closed")}
                          title="Close challenges"
                          className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {challengePanelState === "expanded" && (
                      <div className="min-h-0 flex-1 overflow-hidden">
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
                  </section>
                )}

                {buddyPanelState !== "closed" && (
                  <section
                    className="min-h-0 h-full flex-none overflow-hidden rounded-[22px] border border-[#c8daf0]/85 bg-[linear-gradient(180deg,_rgba(251,254,255,0.95)_0%,_rgba(240,247,255,0.94)_100%)] shadow-[0_14px_28px_rgba(35,72,117,0.08)] flex flex-col snap-start"
                    style={{
                      width: buddyPanelState === "minimized" ? 108 : sectionCardWidth,
                    }}
                  >
                    <div className="flex items-center gap-3 border-b border-[#c8daf0]/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.92)_0%,_rgba(241,248,255,0.84)_100%)] px-3 py-2">
                      <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#1f7ae0]/10 text-[#1f7ae0]">
                        <MessageSquareText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-bone">Buddy</div>
                        <div className="text-[11px] text-bone/50">
                          {buddyDisabled ? "Disabled for this challenge" : "Hints, explanations, and review"}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => setBuddyPanelState((current) => current === "expanded" ? "minimized" : "expanded")}
                          title={buddyPanelState === "expanded" ? "Minimize buddy" : "Expand buddy"}
                          className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
                        >
                          {buddyPanelState === "expanded" ? <Minus className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => setBuddyPanelState("closed")}
                          title="Close buddy"
                          className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {buddyPanelState === "expanded" && (
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <BuddyChat
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
                          showHeader={false}
                        />
                      </div>
                    )}
                  </section>
                )}
                </div>
              </div>
              </div>
            </motion.aside>
          )}
        </motion.div>
      )}
    </div>
  );
}
