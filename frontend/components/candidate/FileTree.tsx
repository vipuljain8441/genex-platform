"use client";

import { FileCode2, FileText, FileJson, FileTerminal } from "lucide-react";
import { cn } from "@/lib/utils";

function iconFor(path: string) {
  if (path.endsWith(".json")) return FileJson;
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".sh") || path.endsWith(".yml") || path.endsWith(".yaml"))
    return FileTerminal;
  return FileCode2;
}

export function FileTree({
  files,
  current,
  onSelect,
}: {
  files: string[];
  current: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-2">
      <div className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-bone/40">
        Files
      </div>
      <ul className="space-y-px">
        {files.map((f) => {
          const Icon = iconFor(f);
          const active = f === current;
          return (
            <li key={f}>
              <button
                onClick={() => onSelect(f)}
                className={cn(
                  "w-full text-left flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs transition",
                  active
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-bone/65 hover:bg-black/[0.04] border border-transparent"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{f}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
