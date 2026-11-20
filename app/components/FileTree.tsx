"use client";

import { useMemo, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, Search } from "lucide-react";
import type { WorkspaceFile } from "@/lib/domain/types";

interface DirNode {
  kind: "dir";
  /** Display name; chains of single-folder directories are compacted ("src/main/java"). */
  name: string;
  path: string;
  dirs: DirNode[];
  files: WorkspaceFile[];
  changed: number;
}

function buildTree(files: WorkspaceFile[]): DirNode {
  const root: DirNode = { kind: "dir", name: "", path: "", dirs: [], files: [], changed: 0 };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = node.dirs.find((d) => d.path === path);
      if (!next) {
        next = { kind: "dir", name: parts[i], path, dirs: [], files: [], changed: 0 };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const finish = (node: DirNode): DirNode => {
    node.dirs = node.dirs.map(finish);
    // Compact folders: a folder whose only content is one folder shows as "a/b".
    node.dirs = node.dirs.map((d) => {
      let dir = d;
      while (dir.files.length === 0 && dir.dirs.length === 1)
        dir = { ...dir.dirs[0], name: `${dir.name}/${dir.dirs[0].name}` };
      return dir;
    });
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
    node.changed = node.files.filter((f) => f.change).length + node.dirs.reduce((sum, d) => sum + d.changed, 0);
    return node;
  };
  return finish(root);
}

function allDirPaths(node: DirNode): string[] {
  return node.dirs.flatMap((d) => [d.path, ...allDirPaths(d)]);
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Workspace files as a collapsible tree. Folders holding changed files start open; the filter and "Only changed" narrow the list. */
export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: WorkspaceFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const changedCount = files.filter((f) => f.change).length;
  const [onlyChanged, setOnlyChanged] = useState(changedCount > 0 && changedCount < files.length);
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();

  const visible = useMemo(
    () => files.filter((f) => (!onlyChanged || f.change) && (!query || f.path.toLowerCase().includes(query))),
    [files, onlyChanged, query],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  // Default: open every folder when the list is short or filtered, otherwise the folders that hold changes.
  const defaultOpen = useMemo(() => {
    const dirs = allDirPaths(tree);
    if (query || visible.length <= 40) return new Set(dirs);
    const open = new Set<string>();
    const walk = (node: DirNode) => node.dirs.forEach((d) => d.changed > 0 && (open.add(d.path), walk(d)));
    walk(tree);
    return open;
  }, [tree, query, visible.length]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (path: string) => defaultOpen.has(path) !== toggled.has(path);
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderDir = (node: DirNode, depth: number): React.ReactNode => (
    <>
      {node.dirs.map((dir) => {
        const open = isOpen(dir.path);
        return (
          <li key={dir.path}>
            <button
              className="tree-row"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => toggle(dir.path)}
              aria-expanded={open}
            >
              <ChevronRight size={13} className={`tree-chevron ${open ? "open" : ""}`} />
              {open ? <FolderOpen size={14} className="tree-icon" /> : <Folder size={14} className="tree-icon" />}
              <span className="tree-name">{dir.name}</span>
              {dir.changed > 0 && <span className="tree-badge">{dir.changed}</span>}
            </button>
            {open && <ul>{renderDir(dir, depth + 1)}</ul>}
          </li>
        );
      })}
      {node.files.map((file) => (
        <li key={file.path}>
          <button
            className={`tree-row ${file.path === selected ? "active" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 + 13 + 6 }}
            onClick={() => onSelect(file.path)}
            title={file.path}
          >
            <File size={14} className="tree-icon" />
            <span className="tree-name">{baseName(file.path)}</span>
            {file.change && (
              <span className={`tree-change ${file.change}`} title={file.change === "added" ? "New file" : "Modified"}>
                {file.added !== null && <span className="ok">+{file.added}</span>}
                {file.removed ? <span className="bad">−{file.removed}</span> : null}
                <span className="tree-letter">{file.change === "added" ? "A" : "M"}</span>
              </span>
            )}
          </button>
        </li>
      ))}
    </>
  );

  return (
    <div className="tree">
      <div className="tree-tools">
        <label className="tree-filter">
          <Search size={13} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
          />
        </label>
        <button
          className={`tree-toggle ${onlyChanged ? "on" : ""}`}
          onClick={() => setOnlyChanged((v) => !v)}
          disabled={changedCount === 0}
          aria-pressed={onlyChanged}
        >
          Only changed ({changedCount})
        </button>
      </div>
      <ul className="tree-list">
        {visible.length === 0 ? (
          <li className="tree-empty">{query ? "No file matches." : "No changed files."}</li>
        ) : (
          renderDir(tree, 0)
        )}
      </ul>
      <div className="tree-foot muted small">
        {files.length} file{files.length === 1 ? "" : "s"}, {changedCount} changed
      </div>
    </div>
  );
}
