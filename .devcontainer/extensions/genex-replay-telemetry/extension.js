const vscode = require("vscode");
const http = require("node:http");
const https = require("node:https");

const REPORT_URL = (process.env.GENEX_REPORT_URL || "").replace(/\/$/, "");
const EMIT_DEBOUNCE_MS = 180;
const VIEWPORT_DEBOUNCE_MS = 260;

function activate(context) {
  if (!REPORT_URL) {
    return;
  }

  const state = {
    seenFiles: new Set(),
    lastActiveFile: null,
    lastCursorKey: "",
    lastSelectionKey: "",
    lastViewportKey: "",
    pending: new Map(),
  };

  function getSessionId(document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return null;
    const parts = folder.uri.fsPath.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || null;
  }

  function getRelativePath(document) {
    if (!document || document.uri.scheme !== "file") return null;
    return vscode.workspace.asRelativePath(document.uri, false);
  }

  function postEvent(kind, document, payload = {}, options = {}) {
    const filePath = getRelativePath(document);
    const sessionId = getSessionId(document);
    if (!sessionId || !filePath) {
      return;
    }

    const dedupeKey = `${kind}:${filePath}`;
    const delayMs = options.delayMs || 0;
    const body = JSON.stringify({
      session_id: sessionId,
      kind,
      file_path: filePath,
      payload,
    });

    const send = () => {
      state.pending.delete(dedupeKey);
      sendRequest(body);
    };

    const existing = state.pending.get(dedupeKey);
    if (existing) {
      clearTimeout(existing);
    }

    if (delayMs > 0) {
      state.pending.set(dedupeKey, setTimeout(send, delayMs));
    } else {
      send();
    }
  }

  function buildViewportPayload(editor) {
    const selection = editor.selection;
    const visible = editor.visibleRanges[0];
    return {
      cursor_line: selection.active.line + 1,
      cursor_column: selection.active.character + 1,
      visible_start_line: visible ? visible.start.line + 1 : null,
      visible_end_line: visible ? visible.end.line + 1 : null,
    };
  }

  function emitFileFocus(editor) {
    if (!editor || editor.document.uri.scheme !== "file") return;
    const filePath = getRelativePath(editor.document);
    if (!filePath) return;

    const payload = {
      ...buildViewportPayload(editor),
      language: editor.document.languageId,
    };

    if (!state.seenFiles.has(filePath)) {
      state.seenFiles.add(filePath);
      postEvent("file_open", editor.document, payload);
    } else if (state.lastActiveFile !== filePath) {
      postEvent("file_switch", editor.document, payload);
    }
    state.lastActiveFile = filePath;
    postEvent("editor_focus", editor.document, payload, { delayMs: EMIT_DEBOUNCE_MS });
  }

  function emitCursorOrSelection(editor) {
    if (!editor || editor.document.uri.scheme !== "file") return;
    const selection = editor.selection;
    const payload = {
      ...buildViewportPayload(editor),
      line_start: selection.start.line + 1,
      line_end: selection.end.line + 1,
      column_start: selection.start.character + 1,
      column_end: selection.end.character + 1,
    };

    if (selection.isEmpty) {
      const key = `${payload.cursor_line}:${payload.cursor_column}:${payload.visible_start_line}:${payload.visible_end_line}`;
      if (key === state.lastCursorKey) return;
      state.lastCursorKey = key;
      postEvent("cursor_move", editor.document, payload, { delayMs: EMIT_DEBOUNCE_MS });
      return;
    }

    const key = `${payload.line_start}:${payload.column_start}:${payload.line_end}:${payload.column_end}:${payload.visible_start_line}:${payload.visible_end_line}`;
    if (key === state.lastSelectionKey) return;
    state.lastSelectionKey = key;
    postEvent("selection_change", editor.document, payload, { delayMs: EMIT_DEBOUNCE_MS });
  }

  function emitViewport(editor) {
    if (!editor || editor.document.uri.scheme !== "file") return;
    const payload = buildViewportPayload(editor);
    const key = `${payload.visible_start_line}:${payload.visible_end_line}:${payload.cursor_line}:${payload.cursor_column}`;
    if (key === state.lastViewportKey) return;
    state.lastViewportKey = key;
    postEvent("viewport_change", editor.document, payload, { delayMs: VIEWPORT_DEBOUNCE_MS });
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      emitFileFocus(editor);
      emitCursorOrSelection(editor);
      emitViewport(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      emitCursorOrSelection(event.textEditor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      emitViewport(event.textEditor);
    })
  );

  if (vscode.window.activeTextEditor) {
    emitFileFocus(vscode.window.activeTextEditor);
    emitCursorOrSelection(vscode.window.activeTextEditor);
    emitViewport(vscode.window.activeTextEditor);
  }
}

function sendRequest(body) {
  const target = new URL(`${REPORT_URL}/api/monitor/events`);
  const transport = target.protocol === "https:" ? https : http;
  const req = transport.request(
    target,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 1200,
    },
    (res) => {
      res.resume();
    }
  );
  req.on("error", () => {});
  req.on("timeout", () => req.destroy());
  req.write(body);
  req.end();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
