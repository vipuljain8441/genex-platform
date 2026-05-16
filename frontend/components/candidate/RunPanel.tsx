"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Play,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandResult } from "@/lib/api";

export type RunResult = CommandResult;

export type TerminalEntry = RunResult & {
  id: string;
  source: "run" | "terminal";
  at: string;
};

export type ActivityFeedEntry = {
  id: string;
  label: string;
  detail?: string;
  at: string;
  tone?: "default" | "accent" | "success" | "warning";
};

type PanelTab = "terminal" | "activity";

export function RunPanel({
  open,
  busy,
  activeTab,
  terminalInput,
  history,
  activity,
  onTerminalInputChange,
  onExecuteCommand,
  onRunCurrentFile,
  onClearTerminal,
  onToggleTab,
  onToggle,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  activeTab: PanelTab;
  terminalInput: string;
  history: TerminalEntry[];
  activity: ActivityFeedEntry[];
  onTerminalInputChange: (value: string) => void;
  onExecuteCommand: () => void;
  onRunCurrentFile: () => void;
  onClearTerminal: () => void;
  onToggleTab: (tab: PanelTab) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 280, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="border-t border-black/[0.06] bg-ink-50/90 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-black/[0.05]">
            <div className="flex items-center gap-1">
              <TabButton
                active={activeTab === "terminal"}
                onClick={() => onToggleTab("terminal")}
                icon={<Terminal className="h-3.5 w-3.5" />}
                label="Terminal"
              />
              <TabButton
                active={activeTab === "activity"}
                onClick={() => onToggleTab("activity")}
                icon={<History className="h-3.5 w-3.5" />}
                label="Activity"
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onToggle}
                className="text-bone/40 hover:text-bone p-1 rounded transition"
                aria-label="Collapse panel"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onClose}
                className="text-bone/40 hover:text-bone p-1 rounded transition"
                aria-label="Close panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {activeTab === "terminal" ? (
            <div className="h-[236px] grid grid-rows-[auto_1fr]">
              <div className="border-b border-black/[0.05] px-3 py-2 flex items-center gap-2 bg-white/70">
                <input
                  value={terminalInput}
                  onChange={(e) => onTerminalInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onExecuteCommand()}
                  placeholder="Run a workspace command, e.g. python3 app.py"
                  className="flex-1 rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-accent/50"
                />
                <button
                  onClick={onExecuteCommand}
                  disabled={busy}
                  className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run"}
                </button>
                <button
                  onClick={onRunCurrentFile}
                  disabled={busy}
                  className="px-2.5 py-1.5 rounded-lg border border-black/[0.08] text-xs text-bone/70 hover:text-bone bg-white"
                >
                  <span className="inline-flex items-center gap-1">
                    <Play className="h-3.5 w-3.5" /> Current file
                  </span>
                </button>
                <button
                  onClick={onClearTerminal}
                  className="px-2 py-1.5 rounded-lg border border-black/[0.08] text-xs text-bone/60 hover:text-bone bg-white"
                  title="Clear terminal history"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="overflow-y-auto scrollbar-thin font-mono text-[12.5px] leading-relaxed p-3 space-y-3 bg-[#fbfaf6]">
                {history.length === 0 && (
                  <div className="text-bone/40">
                    Run the current file or enter a command to start a terminal session.
                  </div>
                )}
                {history.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-black/[0.06] bg-white overflow-hidden">
                    <div className="px-3 py-2 border-b border-black/[0.05] flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 text-accent" />
                        <span className="uppercase tracking-wider text-bone/45">
                          {entry.source === "run" ? "Run file" : "Terminal"}
                        </span>
                        <span className={statusTone(entry)}>
                          exit {entry.exit_code}
                        </span>
                      </div>
                      <span className="text-bone/35">
                        {entry.duration_ms}ms
                      </span>
                    </div>
                    <div className="px-3 py-2 space-y-2">
                      <div className="text-[10px] uppercase tracking-wider text-bone/40">
                        $ {entry.command}
                      </div>
                      {entry.stdout && (
                        <pre className="whitespace-pre-wrap text-bone/85">{entry.stdout}</pre>
                      )}
                      {entry.stderr && (
                        <pre className={cn(
                          "whitespace-pre-wrap",
                          entry.exit_code === 0 ? "text-amber" : "text-coral"
                        )}>
                          {entry.stderr}
                        </pre>
                      )}
                      {!entry.stdout && !entry.stderr && (
                        <div className="text-bone/40 italic">(no output)</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[236px] overflow-y-auto scrollbar-thin p-3 space-y-2 bg-[#fbfaf6]">
              {activity.length === 0 && (
                <div className="text-sm text-bone/40">
                  Activity events will appear here as the candidate works.
                </div>
              )}
              {activity.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-black/[0.06] bg-white px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className={cn("text-sm", activityTone(entry.tone))}>
                      {entry.label}
                    </div>
                    <div className="text-[11px] text-bone/35 whitespace-nowrap">
                      {new Date(entry.at).toLocaleTimeString()}
                    </div>
                  </div>
                  {entry.detail && (
                    <div className="mt-1 text-xs text-bone/45 font-mono break-words">
                      {entry.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      ) : (
        <motion.button
          key="run-collapsed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onToggle}
          className="border-t border-black/[0.06] bg-ink-50/85 w-full flex items-center justify-between px-3 py-1.5 text-xs text-bone/55 hover:text-bone transition"
        >
          <span className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5" />
            Terminal
            {history[0] && (
              <span className={statusTone(history[0])}>
                · exit {history[0].exit_code}
              </span>
            )}
          </span>
          <ChevronUp className="h-3.5 w-3.5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1.5 rounded-lg text-xs inline-flex items-center gap-1.5 transition",
        active
          ? "bg-white text-bone border border-black/[0.08]"
          : "text-bone/45 hover:text-bone"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function statusTone(result: RunResult) {
  if (result.timed_out) return "text-coral";
  if (result.unsupported) return "text-amber";
  return result.exit_code === 0 ? "text-mint" : "text-coral";
}

function activityTone(tone: ActivityFeedEntry["tone"] = "default") {
  if (tone === "accent") return "text-accent";
  if (tone === "success") return "text-mint";
  if (tone === "warning") return "text-coral";
  return "text-bone/80";
}
