"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { FileContent, WorkspaceFile } from "@/lib/domain/types";
import { CodeFile } from "./Code";
import { FileTree } from "./FileTree";

function bytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body as T;
}

/** Current files of one run's workspace, and the content of the selected one. */
export function FilesPanel({ comparisonId, runId, version }: { comparisonId: string; runId: string; version: number }) {
  const base = `/api/comparisons/${comparisonId}/runs/${runId}/files`;
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getJson<{ files: WorkspaceFile[] }>(base)
      .then((data) => {
        if (cancelled) return;
        setFiles(data.files);
        // First changed file, else the first file.
        setSelected((current) => current ?? data.files.find((f) => f.change)?.path ?? data.files[0]?.path ?? null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [base, version]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);
    getJson<FileContent>(`${base}?path=${encodeURIComponent(selected)}`)
      .then((data) => !cancelled && setContent(data))
      .catch((e: Error) => !cancelled && setContentError(e.message))
      .finally(() => !cancelled && setLoadingContent(false));
    return () => {
      cancelled = true;
    };
  }, [base, selected, version]);

  if (error) return <div className="error-box">Could not list files: {error}</div>;
  if (!files) {
    return (
      <div className="empty">
        <span className="spinner" /> Listing files
      </div>
    );
  }

  return (
    <div className="files">
      <div className="files-head">
        <span className="muted small">Workspace after the latest turn. Dependency folders are hidden.</span>
        <span className="spacer" />
        <a className="text-button" href={`${base}?zip=1`} download>
          <Download size={14} /> All files (.zip)
        </a>
      </div>
      <div className="files-split">
        <FileTree files={files} selected={selected} onSelect={setSelected} />
        <div className="file-view">
          {contentError && <div className="error-box">Could not read the file: {contentError}</div>}
          {loadingContent && !content && (
            <div className="empty">
              <span className="spinner" /> Loading
            </div>
          )}
          {content && (
            <div className="file-bar">
              <span className="code">{content.path}</span>
              <span className="num muted">{bytes(content.size)}</span>
              <span className="spacer" />
              <a className="text-button" href={`${base}?path=${encodeURIComponent(content.path)}&download=1`} download>
                <Download size={14} /> Download
              </a>
            </div>
          )}
          {content?.kind === "binary" && <div className="empty">Binary file, not displayed. Use download.</div>}
          {content?.kind === "text" && (
            <div className="source">
              <CodeFile name={content.path} contents={content.text} />
              {content.truncated && (
                <div className="muted">… truncated at 256 KB for display; download gives the full file.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
