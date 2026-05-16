"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  FileCode2,
  FolderTree,
  ListChecks,
  Loader2,
  Play,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  api,
  type CandidateChallenge,
  type ChallengeResponse,
  type CommandResult,
  type ObjectiveQuestion,
} from "@/lib/api";
import { monitor, type MonitorEvent } from "@/lib/monitor";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { ChallengeOverview } from "./ChallengeOverview";
import { ChallengePanel } from "./ChallengePanel";
import { FileTree } from "./FileTree";
import { SearchPanel, type SearchMatch } from "./SearchPanel";
import { CodeEditor } from "./CodeEditor";
import { BuddyChat } from "./BuddyChat";
import {
  RunPanel,
  type ActivityFeedEntry,
  type TerminalEntry,
} from "./RunPanel";

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

type PanelMode = "explorer" | "search" | "challenges";
type ViewMode = "overview" | "workspace";

const RUNNABLE_EXTS = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".sh"]);

function canRun(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && RUNNABLE_EXTS.has(path.slice(dot).toLowerCase());
}

function defaultCommandFor(path: string) {
  if (path.endsWith(".py")) return `python3 ${path}`;
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return `npx tsx ${path}`;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return `node ${path}`;
  }
  if (path.endsWith(".sh")) return `bash ${path}`;
  return "";
}

function summarizeEvent(event: MonitorEvent): ActivityFeedEntry | null {
  const detail = event.file_path || stringifyPayload(event.payload);
  switch (event.kind) {
    case "file_open":
      return makeActivity("Opened file", detail, event.client_at, "accent");
    case "file_switch":
      return makeActivity("Switched file", detail, event.client_at, "accent");
    case "file_close":
      return makeActivity("Closed tab", detail, event.client_at);
    case "panel_switch":
      return makeActivity("Changed sidebar", stringifyPayload(event.payload), event.client_at);
    case "search_open":
      return makeActivity("Opened search", undefined, event.client_at);
    case "search_query":
      return makeActivity("Searched workspace", stringifyPayload(event.payload), event.client_at);
    case "search_result_open":
      return makeActivity("Opened search result", detail, event.client_at, "accent");
    case "terminal_open":
      return makeActivity("Opened terminal", stringifyPayload(event.payload), event.client_at);
    case "terminal_clear":
      return makeActivity("Cleared terminal", undefined, event.client_at);
    case "challenge_switch":
      return makeActivity("Switched challenge", stringifyPayload(event.payload), event.client_at, "accent");
    case "challenge_response":
      return makeActivity("Updated challenge response", stringifyPayload(event.payload), event.client_at);
    case "buddy_hint":
      if (event.payload?.action === "dismissed") {
        return makeActivity("Dismissed buddy suggestion", detail, event.client_at, "warning");
      }
      return makeActivity("Buddy responded", detail, event.client_at);
    case "editor_focus":
      return makeActivity("Focused editor", detail, event.client_at);
    case "selection_change":
      return makeActivity("Changed selection", stringifyPayload(event.payload), event.client_at);
    case "edit":
      return makeActivity("Edited file", `${detail || ""} ${stringifyPayload(event.payload)}`.trim(), event.client_at);
    case "submit":
      return makeActivity("Submitted assessment", detail, event.client_at, "success");
    default:
      return null;
  }
}

function makeActivity(
  label: string,
  detail: string | undefined,
  at: string,
  tone: ActivityFeedEntry["tone"] = "default"
): ActivityFeedEntry {
  return {
    id: `${at}-${label}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    detail,
    at,
    tone,
  };
}

function stringifyPayload(payload?: Record<string, unknown>) {
  if (!payload) return "";
  const parts = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.join(" ");
}

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
  const initialOpenFile = entryPoint || initialFiles[0]?.path || "";
  const langByPath = useMemo(
    () => Object.fromEntries(initialFiles.map((f) => [f.path, f.language])),
    [initialFiles]
  );

  const [filesContent, setFilesContent] = useState<Record<string, string>>(
    () => Object.fromEntries(initialFiles.map((f) => [f.path, f.content]))
  );
  const [openFile, setOpenFile] = useState<string>(initialOpenFile);
  const [openTabs, setOpenTabs] = useState<string[]>(() =>
    initialOpenFile ? [initialOpenFile] : []
  );
  const [activePanel, setActivePanel] = useState<PanelMode>("explorer");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(
    initialChallengeId || challenges[0]?.id || null
  );
  const [responses, setResponses] = useState<Record<string, ChallengeResponse>>(initialResponses);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runOpen, setRunOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [panelTab, setPanelTab] = useState<"terminal" | "activity">("terminal");
  const [terminalInput, setTerminalInput] = useState(
    initialOpenFile ? defaultCommandFor(initialOpenFile) : ""
  );
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [cursor, setCursor] = useState({
    line: 1,
    column: 1,
    selectedChars: 0,
    selectedLines: 0,
  });

  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastEditLen = useRef<Record<string, number>>({});
  const lastCursorLogAt = useRef(0);
  const lastSelectionKey = useRef("");

  const searchState = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return { results: [] as SearchMatch[], totalMatches: 0 };

    const results: SearchMatch[] = [];
    let totalMatches = 0;
    for (const [path, content] of Object.entries(filesContent)) {
      if (path.toLowerCase().includes(query)) {
        totalMatches += 1;
        results.push({
          path,
          lineNumber: 1,
          lineText: path,
          startColumn: 1,
        });
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const lower = lines[i].toLowerCase();
        if (!lower.includes(query)) continue;
        totalMatches += 1;
        if (results.length < 80) {
          results.push({
            path,
            lineNumber: i + 1,
            lineText: lines[i].trim() || "(blank line)",
            startColumn: lower.indexOf(query) + 1,
          });
        }
      }
    }
    return { results, totalMatches };
  }, [deferredSearchQuery, filesContent]);

  const activeChallenge = challenges.find((challenge) => challenge.id === activeChallengeId) || challenges[0] || null;
  const fileCanRun = !!(activeChallenge?.kind === "coding" && openFile && canRun(openFile));
  const allChallengesComplete = challenges.every(
    (challenge) => responses[challenge.id]?.status === "completed"
  );
  const completedCount = challenges.filter(
    (challenge) => responses[challenge.id]?.status === "completed"
  ).length;
  const buddyDisabled = activeChallenge ? !activeChallenge.allow_buddy : false;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");
  const remaining = Math.max(durationMinutes * 60 - elapsed, 0);
  const remMM = Math.floor(remaining / 60).toString().padStart(2, "0");
  const remSS = (remaining % 60).toString().padStart(2, "0");

  function pushActivity(entry: ActivityFeedEntry | null) {
    if (!entry) return;
    setActivityFeed((prev) => [entry, ...prev].slice(0, 120));
  }

  function persistFileBestEffort(path: string, content: string) {
    api.saveFile(sessionId, path, content).catch(() => undefined);
  }

  async function flushOpenFile() {
    if (!openFile) return;
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    try {
      await api.saveFile(sessionId, openFile, filesContent[openFile] || "");
    } catch {
      // Best effort only.
    }
  }

  useEffect(() => {
    monitor.start(sessionId);
    const unsubscribe = monitor.subscribe((event) => {
      pushActivity(summarizeEvent(event));
    });
    const startedAt = Date.now();
    const tick = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => {
      clearInterval(tick);
      unsubscribe();
      monitor.stop();
    };
  }, [assessmentId, initialOpenFile, sessionId]);

  useEffect(() => {
    if (!deferredSearchQuery.trim()) return;
    const handle = setTimeout(() => {
      monitor.event("search_query", openFile, {
        query: deferredSearchQuery.trim(),
        matches: searchState.totalMatches,
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [deferredSearchQuery, openFile, searchState.totalMatches]);

  function ensureTab(path: string) {
    if (openTabs.includes(path)) return;
    setOpenTabs((prev) => [...prev, path]);
    monitor.event("file_open", path, { source: activePanel });
  }

  function switchFile(path: string, options?: { revealLine?: number; source?: string }) {
    ensureTab(path);
    if (path !== openFile) {
      monitor.event("file_switch", path, {
        from: openFile,
        source: options?.source || "explorer",
      });
      setOpenFile(path);
      setTerminalInput(defaultCommandFor(path));
    }
    if (options?.revealLine) {
      setRevealLine(options.revealLine);
    }
  }

  function closeTab(path: string) {
    if (openTabs.length === 1) return;
    const idx = openTabs.indexOf(path);
    if (idx < 0) return;
    monitor.event("file_close", path);
    const nextTabs = openTabs.filter((tab) => tab !== path);
    setOpenTabs(nextTabs);
    if (openFile === path) {
      const nextActive = nextTabs[Math.max(0, idx - 1)] || nextTabs[0] || "";
      setOpenFile(nextActive);
      setTerminalInput(defaultCommandFor(nextActive));
    }
  }

  function switchPanel(panel: PanelMode) {
    if (panel === activePanel) return;
    setActivePanel(panel);
    monitor.event(panel === "search" ? "search_open" : "panel_switch", openFile, {
      panel,
    });
  }

  async function persistChallengeResponse(
    challengeId: string,
    body: {
      status?: "pending" | "in_progress" | "completed";
      answer_text?: string;
      selected_option_ids?: Record<string, string[]>;
    }
  ) {
    try {
      const next = await api.saveChallengeResponse(sessionId, challengeId, body);
      setResponses(next.challenge_responses);
    } catch {
      // Best effort. Keep the local optimistic state.
    }
  }

  async function selectChallenge(challengeId: string) {
    const challenge = challenges.find((item) => item.id === challengeId);
    const changed = challengeId !== activeChallengeId;
    if (changed) {
      setActiveChallengeId(challengeId);
      pushActivity(
        makeActivity(
          "Switched challenge",
          challenge?.title,
          new Date().toISOString(),
          "accent"
        )
      );
      monitor.event("challenge_switch", openFile, {
        challenge_id: challengeId,
        challenge_kind: challenge?.kind,
      });
    }
    try {
      await api.setCurrentChallenge(sessionId, challengeId);
    } catch {
      // Keep local navigation responsive.
    }
  }

  async function openChallengeWorkspace(challengeId: string) {
    const challenge = challenges.find((item) => item.id === challengeId);
    if (!challenge) return;

    await selectChallenge(challengeId);
    setViewMode("workspace");

    if (challenge.kind === "coding") {
      const preferredPath =
        challenge.related_files.find((path) => path in filesContent) ||
        openFile ||
        initialFiles[0]?.path ||
        "";
      if (preferredPath) {
        if (preferredPath === openFile && openTabs.includes(preferredPath)) {
          monitor.event("file_open", preferredPath, {
            assessment_id: assessmentId,
            source: "challenge_workspace",
            challenge_id: challengeId,
          });
        } else {
          switchFile(preferredPath, { source: "challenge_workspace" });
        }
      }
    }
  }

  function openOverview() {
    setViewMode("overview");
  }

  function updateChallengeStatus(
    challengeId: string,
    status: "pending" | "in_progress" | "completed"
  ) {
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || {
          challenge_id: challengeId,
          challenge_kind: challenges.find((challenge) => challenge.id === challengeId)?.kind || "coding",
          answer_text: "",
          selected_option_ids: {},
          updated_at: new Date().toISOString(),
        }),
        status,
        updated_at: new Date().toISOString(),
      },
    }));
    pushActivity(makeActivity("Updated challenge status", `${challengeId} → ${status}`, new Date().toISOString()));
    monitor.event("challenge_response", openFile, {
      challenge_id: challengeId,
      status,
      source: "status_toggle",
    });
    void persistChallengeResponse(challengeId, { status });
  }

  function updateChallengeAnswerText(challengeId: string, value: string) {
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || {
          challenge_id: challengeId,
          challenge_kind: challenges.find((challenge) => challenge.id === challengeId)?.kind || "theory",
          status: "in_progress",
          selected_option_ids: {},
          updated_at: new Date().toISOString(),
          answer_text: "",
        }),
        answer_text: value,
        status: value.trim() ? "in_progress" : prev[challengeId]?.status || "pending",
        updated_at: new Date().toISOString(),
      },
    }));
    const existing = responseDebounce.current[challengeId];
    if (existing) clearTimeout(existing);
    responseDebounce.current[challengeId] = setTimeout(() => {
      monitor.event("challenge_response", openFile, {
        challenge_id: challengeId,
        status: value.trim() ? "in_progress" : "pending",
        answer_length: value.trim().length,
        source: "text_response",
      });
      void persistChallengeResponse(challengeId, {
        answer_text: value,
        status: value.trim() ? "in_progress" : "pending",
      });
    }, 500);
  }

  function toggleObjectiveOption(
    challengeId: string,
    question: ObjectiveQuestion,
    optionId: string
  ) {
    const current = responses[challengeId]?.selected_option_ids || {};
    const selected = new Set(current[question.id] || []);
    if (question.multi_select) {
      if (selected.has(optionId)) selected.delete(optionId);
      else selected.add(optionId);
    } else {
      selected.clear();
      selected.add(optionId);
    }
    const nextSelected = {
      ...current,
      [question.id]: Array.from(selected),
    };
    const challenge = challenges.find((item) => item.id === challengeId);
    const allAnswered = !!challenge?.objective_questions.every(
      (item) => (nextSelected[item.id] || []).length > 0
    );
    const nextStatus = allAnswered ? "completed" : "in_progress";
    setResponses((prev) => ({
      ...prev,
      [challengeId]: {
        ...(prev[challengeId] || {
          challenge_id: challengeId,
          challenge_kind: "objective",
          status: "in_progress",
          answer_text: "",
          updated_at: new Date().toISOString(),
        }),
        selected_option_ids: nextSelected,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      },
    }));
    monitor.event("challenge_response", openFile, {
      challenge_id: challengeId,
      status: nextStatus,
      answered_questions: Object.values(nextSelected).filter((value) => value.length > 0).length,
      source: "objective_response",
    });
    void persistChallengeResponse(challengeId, {
      selected_option_ids: nextSelected,
      status: nextStatus,
    });
  }

  function editFile(path: string, content: string) {
    const prevLen = lastEditLen.current[path] ?? content.length;
    const delta = Math.abs(content.length - prevLen);
    lastEditLen.current[path] = content.length;
    monitor.edit(path, delta);

    setFilesContent((prev) => ({ ...prev, [path]: content }));
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => {
      persistFileBestEffort(path, content);
    }, 600);
  }

  function openTerminal(tab: "terminal" | "activity" = "terminal") {
    setRunOpen(true);
    setPanelTab(tab);
    monitor.event("terminal_open", openFile, { tab });
  }

  function addTerminalEntry(result: CommandResult, source: "run" | "terminal") {
    const entry: TerminalEntry = {
      ...result,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
      at: new Date().toISOString(),
    };
    setTerminalHistory((prev) => [entry, ...prev].slice(0, 40));
    pushActivity(
      makeActivity(
        source === "run" ? "Executed current file" : "Ran terminal command",
        result.command,
        entry.at,
        result.exit_code === 0 ? "success" : "warning"
      )
    );
  }

  async function runFile() {
    if (!openFile || runBusy) return;
    await flushOpenFile();
    openTerminal("terminal");
    setRunBusy(true);
    try {
      const result = await api.run(sessionId, openFile);
      addTerminalEntry(result, "run");
    } catch (e: any) {
      addTerminalEntry(
        {
          stdout: "",
          stderr: `Run failed: ${e.message}`,
          exit_code: -1,
          duration_ms: 0,
          command: defaultCommandFor(openFile) || openFile,
          timed_out: false,
          unsupported: false,
        },
        "run"
      );
    } finally {
      setRunBusy(false);
    }
  }

  async function executeTerminalCommand() {
    const command = terminalInput.trim();
    if (!command || runBusy) return;
    await flushOpenFile();
    openTerminal("terminal");
    setRunBusy(true);
    try {
      const result = await api.terminal(sessionId, command);
      addTerminalEntry(result, "terminal");
    } catch (e: any) {
      addTerminalEntry(
        {
          stdout: "",
          stderr: `Command failed: ${e.message}`,
          exit_code: -1,
          duration_ms: 0,
          command,
          timed_out: false,
          unsupported: false,
        },
        "terminal"
      );
    } finally {
      setRunBusy(false);
    }
  }

  function clearTerminalHistory() {
    setTerminalHistory([]);
    monitor.event("terminal_clear", openFile);
  }

  function applyBuddyEdit(filePath: string, newContent: string, rationale: string) {
    setFilesContent((prev) => ({ ...prev, [filePath]: newContent }));
    persistFileBestEffort(filePath, newContent);
    monitor.event("edit", filePath, {
      source: "buddy_apply",
      rationale,
      delta_chars: newContent.length,
    });
    switchFile(filePath, { source: "buddy_apply" });
  }

  function dismissBuddyEdit(filePath: string, rationale: string) {
    monitor.event("buddy_hint", filePath, {
      action: "dismissed",
      rationale,
    });
  }

  function openSearchResult(result: SearchMatch) {
    switchFile(result.path, {
      revealLine: result.lineNumber,
      source: "search",
    });
    monitor.event("search_result_open", result.path, {
      line: result.lineNumber,
      column: result.startColumn,
      query: deferredSearchQuery.trim(),
    });
  }

  function handleCursorMove(line: number, column: number) {
    setCursor((prev) => ({ ...prev, line, column }));
    const now = Date.now();
    if (now - lastCursorLogAt.current < 1200) return;
    lastCursorLogAt.current = now;
    monitor.event("cursor_move", openFile, { line, column });
  }

  function handleSelectionChange(startLine: number, endLine: number, selectedText: string) {
    const key = `${startLine}:${endLine}:${selectedText.length}`;
    if (key === lastSelectionKey.current) return;
    lastSelectionKey.current = key;
    setCursor((prev) => ({
      ...prev,
      selectedChars: selectedText.length,
      selectedLines: Math.max(endLine - startLine + 1, selectedText ? 1 : 0),
    }));
    monitor.event("selection_change", openFile, {
      start_line: startLine,
      end_line: endLine,
      selected_chars: selectedText.length,
    });
  }

  async function submit() {
    if (!allChallengesComplete) {
      alert("Please complete every challenge before submitting the assessment.");
      return;
    }
    setSubmitting(true);
    monitor.event("submit", openFile, { assessment_id: assessmentId });
    monitor.stop();
    try {
      await api.submit(sessionId);
      router.push(`/results/${sessionId}`);
    } catch (e: any) {
      alert(`Submit failed: ${e.message}`);
      monitor.start(sessionId);
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-ink">
      <div className="h-14 flex-shrink-0 flex items-center justify-between border-b border-black/[0.06] px-4 bg-ink-50/85 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="hidden md:flex items-center gap-2">
            <Badge tone="accent">
              <FileCode2 className="h-3 w-3" /> {viewMode === "overview" ? "Assessment Overview" : "Candidate Workspace"}
            </Badge>
            <Badge>{completedCount}/{Math.max(challenges.length, 1)} done</Badge>
            <span className="text-[11px] text-bone/40 font-mono">
              {sessionId.slice(-8)}
            </span>
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
            <Button onClick={openOverview} size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4" /> All challenges
            </Button>
          )}
          {viewMode === "workspace" && (
            <Button
            onClick={runFile}
            disabled={!fileCanRun || runBusy}
            size="sm"
            variant="outline"
            title={fileCanRun ? `Run ${openFile}` : "Open a runnable file first"}
          >
            {runBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Run
              </>
            )}
          </Button>
          )}
          <Button
            onClick={submit}
            disabled={submitting || !allChallengesComplete}
            size="sm"
            title={
              allChallengesComplete
                ? "Submit the full assessment"
                : "Complete every challenge before submitting"
            }
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Submit
              </>
            )}
          </Button>
        </div>
      </div>

      {viewMode === "overview" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="flex-1 min-h-0 grid grid-cols-[52px_280px_minmax(0,1fr)_340px] overflow-hidden"
        >
          <aside className="border-r border-black/[0.06] bg-[#f3efe6] flex flex-col items-center py-3 gap-2">
            <SidebarButton
              active={activePanel === "explorer"}
              title="Explorer"
              onClick={() => switchPanel("explorer")}
              icon={<FolderTree className="h-4 w-4" />}
            />
            <SidebarButton
              active={activePanel === "search"}
              title="Search"
              onClick={() => switchPanel("search")}
              icon={<Search className="h-4 w-4" />}
            />
            <SidebarButton
              active={activePanel === "challenges"}
              title="Challenges"
              onClick={() => switchPanel("challenges")}
              icon={<ListChecks className="h-4 w-4" />}
            />
          </aside>

          <aside className="border-r border-black/[0.06] bg-ink-50/85 min-h-0 overflow-hidden">
            {activePanel === "explorer" && (
              <FileTree
                files={Object.keys(filesContent)}
                current={openFile}
                onSelect={(path) => switchFile(path, { source: "explorer" })}
              />
            )}
            {activePanel === "search" && (
              <SearchPanel
                query={searchQuery}
                results={searchState.results}
                totalMatches={searchState.totalMatches}
                onQueryChange={setSearchQuery}
                onOpenResult={openSearchResult}
              />
            )}
            {activePanel === "challenges" && (
              <ChallengePanel
                challenges={challenges}
                activeChallengeId={activeChallengeId}
                responses={responses}
                onSelectChallenge={selectChallenge}
                onChangeStatus={updateChallengeStatus}
                onChangeAnswerText={updateChallengeAnswerText}
                onToggleObjectiveOption={toggleObjectiveOption}
              />
            )}
          </aside>

          <section className="min-w-0 min-h-0 grid grid-rows-[auto_1fr_auto_auto] overflow-hidden">
            <div className="border-b border-black/[0.06] bg-ink-50/80 min-w-0">
              <div className="px-2 py-1.5 flex items-center gap-1 overflow-x-auto scrollbar-thin">
                {openTabs.map((path) => {
                  const active = path === openFile;
                  return (
                    <div
                      key={path}
                      className={cn(
                        "shrink-0 flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-mono transition",
                        active
                          ? "bg-white text-bone border-black/[0.08]"
                          : "text-bone/45 border-transparent hover:text-bone/80 hover:bg-black/[0.03]"
                      )}
                    >
                      <button onClick={() => switchFile(path, { source: "tab" })}>
                        {path}
                      </button>
                      {openTabs.length > 1 && (
                        <button
                          onClick={() => closeTab(path)}
                          className="text-bone/35 hover:text-bone"
                          aria-label={`Close ${path}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 min-w-0 overflow-hidden bg-white">
              {activeChallenge?.kind === "coding" && openFile && (
                <CodeEditor
                  path={openFile}
                  language={langByPath[openFile] || "plaintext"}
                  value={filesContent[openFile] || ""}
                  revealLine={revealLine}
                  onChange={(v) => editFile(openFile, v)}
                  onFocus={() => monitor.event("editor_focus", openFile)}
                  onBlur={() => monitor.event("editor_blur", openFile)}
                  onCursorMove={handleCursorMove}
                  onSelectionChange={handleSelectionChange}
                />
              )}
              {activeChallenge?.kind !== "coding" && (
                <ChallengeWorkArea
                  challenge={activeChallenge}
                  response={activeChallenge ? responses[activeChallenge.id] : undefined}
                  onChangeAnswerText={updateChallengeAnswerText}
                  onToggleObjectiveOption={toggleObjectiveOption}
                />
              )}
            </div>

            <div className="h-8 border-t border-black/[0.06] bg-[#f6f3ea] px-3 flex items-center justify-between text-[11px] font-mono text-bone/50">
              <div className="flex items-center gap-3 overflow-hidden">
                <span className="truncate">{openFile || "No file open"}</span>
                <span>{langByPath[openFile] || "plaintext"}</span>
                {searchState.totalMatches > 0 && deferredSearchQuery.trim() && (
                  <span>
                    {searchState.totalMatches} hits for "{deferredSearchQuery.trim()}"
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span>
                  Ln {cursor.line}, Col {cursor.column}
                </span>
                <span>
                  Sel {cursor.selectedChars} chars
                </span>
                <button
                  onClick={() => openTerminal("activity")}
                  className="text-accent hover:text-accent-deep"
                >
                  Activity {activityFeed.length}
                </button>
                {activeChallenge && (
                  <span className="truncate max-w-[180px]">
                    {activeChallenge.kind}: {activeChallenge.title}
                  </span>
                )}
              </div>
            </div>

            <RunPanel
              open={runOpen}
              busy={runBusy}
              activeTab={panelTab}
              terminalInput={terminalInput}
              history={terminalHistory}
              activity={activityFeed}
              onTerminalInputChange={setTerminalInput}
              onExecuteCommand={executeTerminalCommand}
              onRunCurrentFile={runFile}
              onClearTerminal={clearTerminalHistory}
              onToggleTab={setPanelTab}
              onToggle={() => {
                if (!runOpen) openTerminal(panelTab);
                else setRunOpen(false);
              }}
              onClose={() => setRunOpen(false)}
            />
          </section>

          <aside className="min-w-0 border-l border-black/[0.06] bg-ink-50/80 min-h-0 overflow-hidden">
            <BuddyChat
              sessionId={sessionId}
              challengeId={activeChallenge?.id}
              disabled={buddyDisabled}
              disabledReason="Buddy is disabled for theory and objective challenges."
              openFile={openFile}
              workspace={filesContent}
              onApplyEdit={applyBuddyEdit}
              onDismissEdit={dismissBuddyEdit}
            />
          </aside>
        </motion.div>
      )}
    </div>
  );
}

function ChallengeWorkArea({
  challenge,
  response,
  onChangeAnswerText,
  onToggleObjectiveOption,
}: {
  challenge: CandidateChallenge | null;
  response?: ChallengeResponse;
  onChangeAnswerText: (challengeId: string, value: string) => void;
  onToggleObjectiveOption: (
    challengeId: string,
    question: ObjectiveQuestion,
    optionId: string
  ) => void;
}) {
  if (!challenge) {
    return <div className="h-full grid place-items-center text-bone/40">No active challenge.</div>;
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-[#fffdfa]">
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={challenge.kind === "sql" ? "amber" : challenge.kind === "theory" ? "violet" : "default"}>
            {challenge.kind}
          </Badge>
          <Badge>{challenge.estimated_minutes} min</Badge>
        </div>

        <div>
          <h2 className="font-display text-3xl font-semibold">{challenge.title}</h2>
          <p className="mt-2 text-sm text-bone/70 leading-relaxed whitespace-pre-line">
            {challenge.description}
          </p>
        </div>

        {challenge.issues.length > 0 && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-3">
              Issues in this challenge
            </div>
            <div className="space-y-3">
              {challenge.issues.map((issue, idx) => (
                <div key={issue.id} className="rounded-xl bg-[#fbfaf6] border border-black/[0.05] p-3">
                  <div className="text-sm font-medium text-bone">
                    {idx + 1}. {issue.title}
                  </div>
                  <div className="mt-1 text-sm text-bone/65">{issue.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {challenge.instructions && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40 mb-2">
              Instructions
            </div>
            <p className="text-sm text-bone/75 whitespace-pre-line leading-relaxed">
              {challenge.instructions}
            </p>
          </div>
        )}

        {(challenge.kind === "theory" || challenge.kind === "sql") && (
          <div className="rounded-2xl border border-black/[0.06] bg-white p-4 space-y-3">
            <div className="text-xs uppercase tracking-[0.22em] text-bone/40">
              Your response
            </div>
            {challenge.kind === "sql" ? (
              <div className="h-[360px] border border-black/[0.06] rounded-xl overflow-hidden">
                <CodeEditor
                  path={`${challenge.id}.sql`}
                  language={challenge.editor_language || "sql"}
                  value={response?.answer_text || challenge.starter_content || ""}
                  onChange={(value) => onChangeAnswerText(challenge.id, value)}
                />
              </div>
            ) : (
              <textarea
                value={response?.answer_text || ""}
                onChange={(e) => onChangeAnswerText(challenge.id, e.target.value)}
                rows={12}
                className="w-full rounded-xl border border-black/[0.08] bg-[#fcfbf7] px-3 py-3 text-sm outline-none focus:border-accent/50"
                placeholder={challenge.expected_response_format || "Write your answer here..."}
              />
            )}
          </div>
        )}

        {challenge.kind === "objective" && (
          <div className="space-y-4">
            {challenge.objective_questions.map((question) => (
              <div key={question.id} className="rounded-2xl border border-black/[0.06] bg-white p-4">
                <div className="text-sm font-medium text-bone">{question.prompt}</div>
                <div className="mt-3 space-y-2">
                  {question.options.map((option) => {
                    const selected = !!response?.selected_option_ids?.[question.id]?.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        onClick={() => onToggleObjectiveOption(challenge.id, question, option.id)}
                        className={cn(
                          "w-full text-left rounded-xl border px-3 py-2 text-sm transition",
                          selected
                            ? "border-accent/40 bg-accent-soft/70 text-bone"
                            : "border-black/[0.06] bg-[#fcfbf7] hover:border-black/15 text-bone/75"
                        )}
                      >
                        <span className="font-mono text-[11px] text-bone/45 mr-2">
                          {option.id.toUpperCase()}.
                        </span>
                        {option.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarButton({
  active,
  title,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "h-10 w-10 rounded-xl grid place-items-center transition border",
        active
          ? "bg-white text-accent border-accent/25 shadow-soft"
          : "text-bone/45 border-transparent hover:text-bone hover:bg-white/70"
      )}
    >
      {icon}
    </button>
  );
}
