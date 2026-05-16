"use client";

import dynamic from "next/dynamic";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const LANG_MAP: Record<string, string> = {
  py: "python", python: "python",
  ts: "typescript", typescript: "typescript",
  tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", markdown: "markdown",
  yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell",
};

function toMonaco(language: string, path: string): string {
  const fromLang = LANG_MAP[language?.toLowerCase()];
  if (fromLang) return fromLang;
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return LANG_MAP[ext] || "plaintext";
}

export function CodeEditor({
  path,
  language,
  value,
  onChange,
}: {
  path: string;
  language: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Monaco
      height="100%"
      theme="vs"
      language={toMonaco(language, path)}
      value={value}
      onChange={(v) => onChange(v || "")}
      options={{
        fontSize: 13,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        scrollBeyondLastLine: false,
        padding: { top: 14, bottom: 14 },
        renderLineHighlight: "gutter",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        // Keep autocomplete / hover popups inside the editor's column so they
        // never escape and cover the buddy chat on the right.
        fixedOverflowWidgets: true,
        wordWrap: "on",
        wrappingIndent: "indent",
        automaticLayout: true,
      }}
    />
  );
}
