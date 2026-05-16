"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Send, Loader2, Clock, FileCode2, Play } from "lucide-react";
import { api } from "@/lib/api";
import { monitor } from "@/lib/monitor";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TicketPanel } from "./TicketPanel";
import { FileTree } from "./FileTree";
import { CodeEditor } from "./CodeEditor";
import { BuddyChat } from "./BuddyChat";
import { RunPanel, type RunResult } from "./RunPanel";

type WorkspaceProps = {
  sessionId: string;
  assessmentId: string;
  ticket: any;
  initialFiles: { path: string; language: string; content: string }[];
  entryPoint: string | null;
  durationMinutes: number;
};

const RUNNABLE_EXTS = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".sh"]);
function canRun(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && RUNNABLE_EXTS.has(path.slice(dot).toLowerCase());
}

export function Workspace({
  sessionId,
  assessmentId,
  ticket,
  initialFiles,
  entryPoint,
  durationMinutes,
}: WorkspaceProps) {
  const router = useRouter();
  const langByPath = useMemo(
    () => Object.fromEntries(initialFiles.map((f) => [f.path, f.language])),
    [initialFiles]
  );

  const [filesContent, setFilesContent] = useState<Record<string, string>>(
    () => Object.fromEntries(initialFiles.map((f) => [f.path, f.content]))
  );
  const [openFile, setOpenFile] = useState<string>(
    entryPoint || initialFiles[0]?.path || ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Run panel state
  const [runOpen, setRunOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEditLen = useRef<Record<string, number>>({});

  useEffect(() => {
    monitor.start(sessionId);
    monitor.event("file_open", openFile);
    const startedAt = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => {
      clearInterval(tick);
      monitor.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function switchFile(path: string) {
    if (path === openFile) return;
    monitor.event("file_switch", path, { from: openFile });
    setOpenFile(path);
  }

  function editFile(path: string, content: string) {
    const prevLen = lastEditLen.current[path] ?? content.length;
    const delta = Math.abs(content.length - prevLen);
    lastEditLen.current[path] = content.length;
    monitor.edit(path, delta);

    setFilesContent((prev) => ({ ...prev, [path]: content }));
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => {
      api.saveFile(sessionId, path, content).catch(() => {/* best effort */});
    }, 600);
  }

  async function runFile() {
    if (!openFile || runBusy) return;
    // Make sure the latest edits hit the server before we run.
    if (saveDebounce.current) {
      clearTimeout(saveDebounce.current);
      try {
        await api.saveFile(sessionId, openFile, filesContent[openFile] || "");
      } catch {/* best effort */}
    }
    setRunOpen(true);
    setRunBusy(true);
    setRunResult(null);
    try {
      const r = await api.run(sessionId, openFile);
      setRunResult(r);
    } catch (e: any) {
      setRunResult({
        stdout: "",
        stderr: `Run failed: ${e.message}`,
        exit_code: -1,
        duration_ms: 0,
        command: "",
        timed_out: false,
        unsupported: false,
      });
    } finally {
      setRunBusy(false);
    }
  }

  function applyBuddyEdit(filePath: string, newContent: string, rationale: string) {
    // Replace in editor, persist, switch to that file so the candidate sees the change,
    // and emit a monitored event so the evaluator can later compute AI Catch Rate.
    setFilesContent((prev) => ({ ...prev, [filePath]: newContent }));
    api.saveFile(sessionId, filePath, newContent).catch(() => {/* best effort */});
    monitor.event("edit", filePath, {
      source: "buddy_apply",
      rationale,
      delta_chars: newContent.length,
    });
    if (filePath !== openFile) {
      setOpenFile(filePath);
      monitor.event("file_switch", filePath, { from: openFile, reason: "buddy_apply" });
    }
  }

  function dismissBuddyEdit(filePath: string, rationale: string) {
    monitor.event("buddy_hint", filePath, {
      action: "dismissed",
      rationale,
    });
  }

  async function submit() {
    setSubmitting(true);
    monitor.event("submit", openFile);
    monitor.stop();
    try {
      await api.submit(sessionId);
      router.push(`/results/${sessionId}`);
    } catch (e: any) {
      alert("Submit failed: " + e.message);
      setSubmitting(false);
    }
  }

  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");
  const remaining = Math.max(durationMinutes * 60 - elapsed, 0);
  const remMM = Math.floor(remaining / 60).toString().padStart(2, "0");
  const remSS = (remaining % 60).toString().padStart(2, "0");

  const fileCanRun = openFile && canRun(openFile);

  return (
    <div className="h-screen flex flex-col bg-ink">
      {/* Top bar */}
      <div className="h-14 flex-shrink-0 flex items-center justify-between border-b border-black/[0.06] px-4 bg-ink-50/85 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Logo />
          <div className="hidden md:flex items-center gap-2">
            <Badge tone="accent"><FileCode2 className="h-3 w-3" /> Workspace</Badge>
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
          <Button
            onClick={runFile}
            disabled={!fileCanRun || runBusy}
            size="sm"
            variant="outline"
            title={fileCanRun ? `Run ${openFile}` : "Open a Python / JS / TS file to run"}
          >
            {runBusy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
            ) : (
              <><Play className="h-4 w-4" /> Run</>
            )}
          </Button>
          <Button onClick={submit} disabled={submitting} size="sm">
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
            ) : (
              <><Send className="h-4 w-4" /> Submit</>
            )}
          </Button>
        </div>
      </div>

      {/* Body: 3 columns. min-w-0 + overflow-hidden are critical — without
          them Monaco renders at its content width and overflows into Buddy. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex-1 min-h-0 grid grid-cols-12 overflow-hidden"
      >
        {/* Left: ticket */}
        <aside className="col-span-3 min-w-0 border-r border-black/[0.06] bg-ink-50/80 min-h-0 overflow-hidden">
          <TicketPanel ticket={ticket} />
        </aside>

        {/* Center: tabs + (tree + editor) + run panel */}
        <section className="col-span-6 min-w-0 min-h-0 grid grid-rows-[auto_1fr_auto] overflow-hidden">
          <div className="border-b border-black/[0.06] bg-ink-50/80 min-w-0">
            <div className="px-2 py-1.5 flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {Object.keys(filesContent).map((p) => (
                <button
                  key={p}
                  onClick={() => switchFile(p)}
                  className={`shrink-0 font-mono text-xs px-3 py-1.5 rounded-md transition ${
                    p === openFile
                      ? "bg-black/[0.06] text-bone"
                      : "text-bone/45 hover:text-bone/80"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[200px_minmax(0,1fr)] min-h-0 min-w-0">
            <div className="border-r border-black/[0.06] bg-ink-50/70 min-h-0 min-w-0 overflow-hidden">
              <FileTree
                files={Object.keys(filesContent)}
                current={openFile}
                onSelect={switchFile}
              />
            </div>
            <div className="min-h-0 min-w-0 overflow-hidden">
              {openFile && (
                <CodeEditor
                  path={openFile}
                  language={langByPath[openFile] || "plaintext"}
                  value={filesContent[openFile] || ""}
                  onChange={(v) => editFile(openFile, v)}
                />
              )}
            </div>
          </div>

          <RunPanel
            open={runOpen}
            busy={runBusy}
            result={runResult}
            onToggle={() => setRunOpen((v) => !v)}
            onClose={() => setRunOpen(false)}
          />
        </section>

        {/* Right: buddy */}
        <aside className="col-span-3 min-w-0 border-l border-black/[0.06] bg-ink-50/80 min-h-0 overflow-hidden">
          <BuddyChat
            sessionId={sessionId}
            openFile={openFile}
            workspace={filesContent}
            onApplyEdit={applyBuddyEdit}
            onDismissEdit={dismissBuddyEdit}
          />
        </aside>
      </motion.div>
    </div>
  );
}
