"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Terminal, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type RunResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  command: string;
  timed_out: boolean;
  unsupported: boolean;
};

export function RunPanel({
  open,
  busy,
  result,
  onToggle,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  result: RunResult | null;
  onToggle: () => void;
  onClose: () => void;
}) {
  const success = result && result.exit_code === 0 && !result.timed_out;
  const headerColor = busy
    ? "text-bone/60"
    : result == null
    ? "text-bone/55"
    : result.unsupported
    ? "text-amber"
    : result.timed_out
    ? "text-coral"
    : success
    ? "text-mint"
    : "text-coral";

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 220, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="border-t border-black/[0.06] bg-ink-50/85 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-black/[0.05]">
            <button
              onClick={onToggle}
              className="flex items-center gap-2 text-xs font-medium tracking-wider uppercase"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className={headerColor}>
                {busy
                  ? "Running…"
                  : result == null
                  ? "Output"
                  : result.unsupported
                  ? "Unsupported runtime"
                  : result.timed_out
                  ? "Timed out"
                  : `Exit ${result.exit_code}`}
              </span>
              {result && !busy && (
                <span className="text-bone/40 normal-case tracking-normal">
                  · {result.duration_ms}ms
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 text-bone/40" />
            </button>
            <button
              onClick={onClose}
              className="text-bone/40 hover:text-bone p-1 rounded transition"
              aria-label="Close output"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="h-[178px] overflow-y-auto scrollbar-thin font-mono text-[12.5px] leading-relaxed">
            {busy && (
              <div className="flex items-center gap-2 px-4 py-3 text-bone/55">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Executing…
              </div>
            )}
            {!busy && !result && (
              <div className="px-4 py-3 text-bone/40">
                Hit ▶ Run on a Python / JS / TS file to execute it.
              </div>
            )}
            {result && (
              <div className="px-4 py-2 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-bone/40">
                  $ {result.command}
                </div>
                {result.stdout && (
                  <pre className="whitespace-pre-wrap text-bone/85">{result.stdout}</pre>
                )}
                {result.stderr && (
                  <pre className={cn(
                    "whitespace-pre-wrap",
                    result.exit_code === 0 ? "text-amber" : "text-coral"
                  )}>{result.stderr}</pre>
                )}
                {!result.stdout && !result.stderr && (
                  <div className="text-bone/40 italic">(no output)</div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {!open && (
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
            Output
            {result && (
              <span className={cn(
                result.exit_code === 0 && !result.timed_out ? "text-mint" : "text-coral"
              )}>
                · exit {result.exit_code}
              </span>
            )}
          </span>
          <ChevronUp className="h-3.5 w-3.5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
