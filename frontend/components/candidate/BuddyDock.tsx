"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Maximize2, MessageSquareText, Minus, X } from "lucide-react";
import { BuddyChat } from "./BuddyChat";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 380;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function BuddyDock({
  hidden,
  minimized,
  width,
  onWidthChange,
  onToggleMinimize,
  onClose,
  sessionId,
  challengeId,
  disabled,
  disabledReason,
  onApplyEdit,
  onDismissEdit,
}: {
  hidden: boolean;
  minimized: boolean;
  width: number;
  onWidthChange: (next: number) => void;
  onToggleMinimize: () => void;
  onClose: () => void;
  sessionId: string;
  challengeId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onApplyEdit?: (filePath: string, newContent: string, rationale: string) => void;
  onDismissEdit?: (filePath: string, rationale: string) => void;
}) {
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    function onMouseMove(event: globalThis.MouseEvent) {
      const drag = dragState.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      onWidthChange(clamp(drag.startWidth - delta, MIN_WIDTH, MAX_WIDTH));
    }
    function onMouseUp() {
      if (!dragState.current) return;
      dragState.current = null;
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    globalThis.addEventListener("mousemove", onMouseMove);
    globalThis.addEventListener("mouseup", onMouseUp);
    return () => {
      globalThis.removeEventListener("mousemove", onMouseMove);
      globalThis.removeEventListener("mouseup", onMouseUp);
    };
  }, [onWidthChange]);

  function startResize(event: ReactMouseEvent<HTMLDivElement>) {
    dragState.current = { startX: event.clientX, startWidth: width };
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const effectiveWidth = minimized ? 44 : width;

  return (
    <aside
      className={cn(
        "relative z-10 flex flex-col min-h-0 border-l border-[#c8daf0]/80 bg-[linear-gradient(180deg,_rgba(251,254,255,0.96)_0%,_rgba(240,247,255,0.95)_100%)] shadow-[-18px_0_50px_rgba(35,72,117,0.08)]",
        isDragging ? "" : "transition-[width] duration-200"
      )}
      style={{
        width: effectiveWidth,
        flex: "0 0 auto",
        display: hidden ? "none" : "flex",
      }}
    >
      {!minimized && (
        <div
          onMouseDown={startResize}
          onDoubleClick={() => onWidthChange(DEFAULT_WIDTH)}
          className="absolute -left-1.5 top-0 bottom-0 z-30 w-3 cursor-col-resize group"
          title="Drag to resize"
        >
          <div className="absolute left-1/2 top-1/2 flex h-24 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 shadow-sm ring-1 ring-black/[0.06] transition group-hover:bg-white group-hover:ring-accent/25" />
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#c8daf0]/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.92)_0%,_rgba(241,248,255,0.84)_100%)] px-3 py-2">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#1f7ae0]/10 text-[#1f7ae0]">
          <MessageSquareText className="h-4 w-4" />
        </div>
        {!minimized && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-bone">Buddy</div>
            <div className="text-[11px] text-bone/50">
              {disabled ? "Disabled for this challenge" : "Hints, explanations, and review"}
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onToggleMinimize}
            title={minimized ? "Expand buddy" : "Minimize buddy"}
            className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          {!minimized && (
            <button
              onClick={onClose}
              title="Close buddy"
              className="rounded-md p-1.5 text-bone/40 transition hover:bg-black/[0.06] hover:text-bone"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ display: minimized ? "none" : "block" }}
      >
        <BuddyChat
          sessionId={sessionId}
          challengeId={challengeId}
          disabled={disabled}
          disabledReason={disabledReason}
          onApplyEdit={onApplyEdit}
          onDismissEdit={onDismissEdit}
          showHeader={false}
        />
      </div>
    </aside>
  );
}
