"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
};

function iconFor(path: string) {
  if (path.endsWith(".json")) return FileJson;
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".sh") || path.endsWith(".yml") || path.endsWith(".yaml")) {
    return FileTerminal;
  }
  return FileCode2;
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.split("/");
    let level = root;
    let currentPath = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = level.find((item) => item.name === part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "folder",
          children: isFile ? undefined : [],
        };
        level.push(node);
      }
      if (!isFile) {
        level = node.children ||= [];
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => {
      if (node.children) sortNodes(node.children);
    });
  };

  sortNodes(root);
  return root;
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
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const file of files) {
      const parts = file.split("/");
      let path = "";
      for (let i = 0; i < parts.length - 1; i += 1) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        initial[path] = true;
      }
    }
    return initial;
  });

  function toggle(path: string) {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-2">
      <div className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-bone/40">
        Explorer
      </div>
      <div className="space-y-0.5">
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            current={current}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  current,
  expanded,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  current: string;
  expanded: Record<string, boolean>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isFolder = node.type === "folder";
  const isOpen = expanded[node.path] ?? true;
  const isActive = node.path === current;
  const paddingLeft = 10 + depth * 14;

  return (
    <div>
      <button
        onClick={() => (isFolder ? onToggle(node.path) : onSelect(node.path))}
        className={cn(
          "w-full text-left flex items-center gap-2 rounded-lg py-1.5 pr-2 font-mono text-xs transition border",
          isActive
            ? "bg-accent/15 text-accent border-accent/30"
            : "text-bone/65 hover:bg-black/[0.04] border-transparent"
        )}
        style={{ paddingLeft }}
      >
        {isFolder ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-bone/45" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-bone/45" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            {(() => {
              const Icon = iconFor(node.path);
              return <Icon className="h-3.5 w-3.5 shrink-0" />;
            })()}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isFolder && isOpen && node.children && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              current={current}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
