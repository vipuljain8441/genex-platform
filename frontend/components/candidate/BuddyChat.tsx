"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, ShieldAlert, FileCode2, Check, X, Sparkle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type BuddyEdit = {
  file_path: string;
  new_content: string;
  rationale: string;
  status?: "pending" | "applied" | "dismissed";
};

type Msg = {
  role: "user" | "buddy";
  content: string;
  hint_level?: string;
  blocked?: boolean;
  edits?: BuddyEdit[];
};

const HINT_TONE: Record<string, string> = {
  nudge: "text-violet",
  guide: "text-amber",
  concrete: "text-coral",
};

export function BuddyChat({
  sessionId,
  challengeId,
  disabled,
  disabledReason,
  openFile,
  workspace,
  onApplyEdit,
  onDismissEdit,
}: {
  sessionId: string;
  challengeId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  openFile?: string | null;
  workspace?: Record<string, string>;
  onApplyEdit?: (filePath: string, newContent: string, rationale: string) => void;
  onDismissEdit?: (filePath: string, rationale: string) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.buddyHistory(sessionId).then((h) => {
      setMsgs(
        h.map((t) => ({
          role: t.role === "buddy" ? "buddy" : "user",
          content: t.content,
        }))
      );
    });
  }, [sessionId]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const text = q.trim();
    if (!text || busy || disabled) return;
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api.askBuddy({
        session_id: sessionId,
        question: text,
        challenge_id: challengeId,
        open_file: openFile,
        workspace,
      });
      const edits = (r.edits || []).map((e) => ({ ...e, status: "pending" as const }));
      setMsgs((m) => [
        ...m,
        {
          role: "buddy",
          content: r.hint,
          hint_level: r.hint_level,
          blocked: r.blocked,
          edits,
        },
      ]);
    } catch {
      setMsgs((m) => [
        ...m,
        { role: "buddy", content: "Hmm — I lost the thread. Try again?" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function applyEdit(msgIdx: number, editIdx: number) {
    setMsgs((prev) => {
      const next = [...prev];
      const m = { ...next[msgIdx] };
      if (!m.edits) return prev;
      const edits = [...m.edits];
      const edit = edits[editIdx];
      edits[editIdx] = { ...edit, status: "applied" };
      m.edits = edits;
      next[msgIdx] = m;
      onApplyEdit?.(edit.file_path, edit.new_content, edit.rationale);
      return next;
    });
  }

  function dismissEdit(msgIdx: number, editIdx: number) {
    setMsgs((prev) => {
      const next = [...prev];
      const m = { ...next[msgIdx] };
      if (!m.edits) return prev;
      const edits = [...m.edits];
      const edit = edits[editIdx];
      edits[editIdx] = { ...edit, status: "dismissed" };
      m.edits = edits;
      next[msgIdx] = m;
      onDismissEdit?.(edit.file_path, edit.rationale);
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-black/[0.06] flex items-center gap-2">
        <div className="relative h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-sky grid place-items-center">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <div className="text-sm font-medium">Buddy</div>
          <div className="text-[10px] uppercase tracking-wider text-bone/40">
            Helpful · review before you apply
          </div>
        </div>
      </div>

      <div ref={scroll} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {msgs.length === 0 && (
          <div className="text-sm text-bone/45 text-center py-10">
            {disabled
              ? (disabledReason || "Buddy is disabled for this challenge.")
              : "Ask Buddy for a fix or an explanation — proposed edits show up with Apply / Dismiss."}
          </div>
        )}
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm",
                m.role === "user"
                  ? "ml-auto bg-accent/15 border border-accent/25 text-bone"
                  : "bg-white border border-black/[0.06] text-bone/85 shadow-soft"
              )}
            >
              {m.role === "buddy" && m.hint_level && (
                <div
                  className={cn(
                    "text-[10px] uppercase tracking-wider mb-1",
                    HINT_TONE[m.hint_level] || "text-bone/40"
                  )}
                >
                  {m.blocked ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" /> blocked
                    </span>
                  ) : (
                    m.hint_level
                  )}
                </div>
              )}
              <div className="prose prose-sm max-w-none [&_p]:my-0 [&_pre]:!bg-ink-100 [&_pre]:!text-bone [&_code]:!text-accent-deep">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>

              {/* Edit cards */}
              {m.edits && m.edits.length > 0 && (
                <div className="mt-3 space-y-2">
                  {m.edits.map((e, ei) => (
                    <EditCard
                      key={ei}
                      edit={e}
                      onApply={() => applyEdit(i, ei)}
                      onDismiss={() => dismissEdit(i, ei)}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && <div className="text-xs text-bone/40 italic">Buddy is thinking…</div>}
      </div>

      <div className="border-t border-black/[0.06] p-3">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={disabled ? "Buddy is disabled for this challenge" : "Ask buddy a question or for a fix…"}
            disabled={disabled}
            className="flex-1 bg-ink-100 text-bone placeholder:text-bone/35 border border-black/[0.06] rounded-xl px-3 py-2 text-sm outline-none focus:bg-white focus:border-accent/50 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={busy || disabled}
            className="px-3 py-2 rounded-xl bg-accent text-white disabled:opacity-40 hover:bg-accent-deep transition"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditCard({
  edit,
  onApply,
  onDismiss,
}: {
  edit: BuddyEdit;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const applied = edit.status === "applied";
  const dismissed = edit.status === "dismissed";
  const done = applied || dismissed;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition",
        applied
          ? "border-mint/40 bg-mint/[0.08]"
          : dismissed
          ? "border-black/[0.08] bg-black/[0.02] opacity-60"
          : "border-accent/30 bg-accent-soft"
      )}
    >
      <div className="px-3 py-2 flex items-center gap-2 border-b border-black/[0.04]">
        <FileCode2 className="h-3.5 w-3.5 text-accent shrink-0" />
        <span className="font-mono text-[11px] text-bone truncate flex-1">
          {edit.file_path}
        </span>
        {applied && (
          <span className="text-[10px] uppercase tracking-wider text-mint inline-flex items-center gap-1">
            <Check className="h-3 w-3" /> applied
          </span>
        )}
        {dismissed && (
          <span className="text-[10px] uppercase tracking-wider text-bone/40 inline-flex items-center gap-1">
            <X className="h-3 w-3" /> dismissed
          </span>
        )}
      </div>

      {edit.rationale && (
        <div className="px-3 py-2 text-[12.5px] text-bone/75 leading-snug">
          <Sparkle className="inline h-3 w-3 text-accent mr-1 -mt-0.5" />
          {edit.rationale}
        </div>
      )}

      {!done && (
        <div className="px-2 py-2 flex items-center justify-between gap-2 border-t border-black/[0.04]">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-bone/60 hover:text-bone px-2 py-1 rounded transition"
          >
            {open ? "Hide diff preview" : "Preview"}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onDismiss}
              className="text-xs px-2.5 py-1 rounded-md text-bone/70 hover:bg-black/[0.04] transition"
            >
              Dismiss
            </button>
            <button
              onClick={onApply}
              className="text-xs px-3 py-1 rounded-md bg-accent text-white hover:bg-accent-deep transition inline-flex items-center gap-1.5"
            >
              <Check className="h-3 w-3" /> Apply
            </button>
          </div>
        </div>
      )}

      {open && !done && (
        <pre className="px-3 py-2 text-[11.5px] font-mono bg-ink-100 border-t border-black/[0.04] max-h-48 overflow-auto scrollbar-thin">
          {edit.new_content.length > 2000
            ? edit.new_content.slice(0, 2000) + "\n... (truncated, full content applies)"
            : edit.new_content}
        </pre>
      )}
    </div>
  );
}
