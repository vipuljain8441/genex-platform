"use client";

import { Search, FileSearch } from "lucide-react";

export type SearchMatch = {
  path: string;
  lineNumber: number;
  lineText: string;
  startColumn: number;
};

export function SearchPanel({
  query,
  results,
  totalMatches,
  onQueryChange,
  onOpenResult,
}: {
  query: string;
  results: SearchMatch[];
  totalMatches: number;
  onQueryChange: (value: string) => void;
  onOpenResult: (result: SearchMatch) => void;
}) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-black/[0.06]">
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone/40 mb-2">
          Search
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-bone/35" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search across files"
            className="w-full rounded-xl border border-black/[0.08] bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-accent/50"
          />
        </div>
        <div className="mt-2 text-xs text-bone/45">
          {query.trim()
            ? `${totalMatches} match${totalMatches === 1 ? "" : "es"}`
            : "Type to search the workspace"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2">
        {!query.trim() && (
          <div className="rounded-xl border border-dashed border-black/[0.08] p-4 text-sm text-bone/45 bg-white/60">
            Search by filename, path, or file content. Results open the file and jump to the matching line.
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div className="rounded-xl border border-dashed border-black/[0.08] p-4 text-sm text-bone/45 bg-white/60">
            No matches found for <span className="font-mono text-bone">{query}</span>.
          </div>
        )}

        {results.map((result, idx) => (
          <button
            key={`${result.path}:${result.lineNumber}:${idx}`}
            onClick={() => onOpenResult(result)}
            className="w-full text-left rounded-xl border border-black/[0.06] bg-white px-3 py-2 hover:border-accent/35 hover:bg-accent-soft/60 transition"
          >
            <div className="flex items-center gap-2 text-[11px] text-bone/45 font-mono">
              <FileSearch className="h-3.5 w-3.5 text-accent" />
              <span className="truncate">{result.path}</span>
              <span>
                :{result.lineNumber}
              </span>
            </div>
            <div className="mt-1 text-sm text-bone/80 whitespace-pre-wrap break-words">
              {result.lineText}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
