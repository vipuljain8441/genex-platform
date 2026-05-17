"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { editor as MonacoEditorNS } from "monaco-editor";

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

type SpecialKey = "undo" | "save" | "copy" | "paste" | "delete";

export function CodeEditor({
  path,
  language,
  value,
  onChange,
  revealLine,
  onFocus,
  onBlur,
  onCursorMove,
  onSelectionChange,
  onKeystroke,
  onPaste,
}: {
  path: string;
  language: string;
  value: string;
  onChange: (v: string) => void;
  revealLine?: number | null;
  onFocus?: () => void;
  onBlur?: () => void;
  onCursorMove?: (line: number, column: number) => void;
  onSelectionChange?: (startLine: number, endLine: number, selectedText: string) => void;
  onKeystroke?: (special?: SpecialKey) => void;
  onPaste?: (text: string) => void;
}) {
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealLine) return;
    editor.revealLineInCenter(revealLine);
    editor.setPosition({ lineNumber: revealLine, column: 1 });
    editor.focus();
  }, [revealLine, path]);

  return (
    <Monaco
      height="100%"
      theme="vs"
      language={toMonaco(language, path)}
      value={value}
      onChange={(v) => onChange(v || "")}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        editor.onDidFocusEditorText(() => onFocus?.());
        editor.onDidBlurEditorText(() => onBlur?.());
        editor.onDidChangeCursorPosition((event) => {
          onCursorMove?.(event.position.lineNumber, event.position.column);
        });
        editor.onDidChangeCursorSelection((event) => {
          const model = editor.getModel();
          if (!model) return;
          const selection = event.selection;
          const text = model.getValueInRange(selection);
          onSelectionChange?.(
            selection.startLineNumber,
            selection.endLineNumber,
            text
          );
        });
        editor.onKeyDown((e) => {
          let special: SpecialKey | undefined;
          if (e.ctrlKey || e.metaKey) {
            if (e.keyCode === monaco.KeyCode.KeyZ) special = "undo";
            else if (e.keyCode === monaco.KeyCode.KeyS) special = "save";
            else if (e.keyCode === monaco.KeyCode.KeyC) special = "copy";
            else if (e.keyCode === monaco.KeyCode.KeyV) special = "paste";
          } else if (
            e.keyCode === monaco.KeyCode.Backspace ||
            e.keyCode === monaco.KeyCode.Delete
          ) {
            special = "delete";
          }
          onKeystroke?.(special);
        });
        // Detect actual paste content (Ctrl+V key alone doesn't carry the text).
        const dom = editor.getDomNode();
        if (dom && onPaste) {
          dom.addEventListener("paste", (event) => {
            const text = event.clipboardData?.getData("text") || "";
            if (text) onPaste(text);
          });
        }
      }}
      options={{
        fontSize: 13,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontLigatures: true,
        minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        scrollBeyondLastLine: false,
        padding: { top: 14, bottom: 14 },
        renderLineHighlight: "gutter",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        lineNumbers: "on",
        rulers: [80, 120],
        folding: true,
        bracketPairColorization: { enabled: true },
        guides: {
          indentation: true,
          bracketPairs: true,
        },
        stickyScroll: { enabled: true },
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        // Keep autocomplete / hover popups inside the editor's column so they
        // never escape and cover the buddy chat on the right.
        fixedOverflowWidgets: true,
        wordWrap: "off",
        wrappingIndent: "same",
        automaticLayout: true,
      }}
    />
  );
}
