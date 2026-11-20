"use client";

import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CircleCheck,
  CircleX,
  FilePen,
  FileText,
  Globe,
  Info,
  LoaderCircle,
  MessageSquare,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TimelineItem } from "@/lib/domain/types";
import { Markdown } from "./Markdown";

const ICONS: Record<TimelineItem["kind"], LucideIcon> = {
  message: MessageSquare,
  reasoning: Brain,
  command: Terminal,
  file_read: FileText,
  file_edit: FilePen,
  web_search: Search,
  web_fetch: Globe,
  tool: Wrench,
  error: TriangleAlert,
  notice: TriangleAlert,
  event: Info,
  check: CircleCheck,
};

export function StepIcon({ item, size = 14 }: { item: TimelineItem; size?: number }) {
  const Icon = item.kind === "check" && !item.passed ? CircleX : ICONS[item.kind];
  const tone = item.kind === "check" ? (item.passed ? "ok" : "bad") : `k-${item.kind}`;
  return <Icon size={size} className={`step-icon ${tone}`} />;
}

/** One-line description of a step. */
export function stepSummary(item: TimelineItem): string {
  switch (item.kind) {
    case "message":
      return item.text
        .replace(/[`*_#>]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ");
    case "reasoning":
      return "Thinking";
    case "command":
      return item.command.split("\n")[0];
    case "file_read":
      return item.target;
    case "file_edit":
      return item.files.map((f) => f.path).join(", ");
    case "web_search":
      return item.query ? `“${item.query}”` : "Web action";
    case "web_fetch":
      return item.url;
    case "tool":
      return item.name;
    case "error":
      return item.text;
    case "notice":
      return `${item.label}: ${item.text}`;
    case "event":
      return item.name;
    case "check":
      return item.passed ? "Check passed" : "Check failed";
  }
}

const seconds = (ms?: number) => (ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`);

/** Text clamped to a few lines, with a toggle. */
function Expandable({
  text,
  lines,
  tail = false,
  className,
}: {
  text: string;
  lines: number;
  tail?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trimmed = text.replace(/\s+$/, "");
  const all = trimmed.split("\n");
  const maxChars = lines * 120;
  const long = all.length > lines || trimmed.length > maxChars;
  let shown = open || !long ? trimmed : (tail ? all.slice(-lines) : all.slice(0, lines)).join("\n");
  if (!open && shown.length > maxChars) shown = tail ? `…${shown.slice(-maxChars)}` : `${shown.slice(0, maxChars)}…`;
  return (
    <div className={className}>
      <pre>{shown}</pre>
      {long && (
        <button className="more" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : all.length > lines ? `Show all ${all.length} lines` : "Show all"}
        </button>
      )}
    </div>
  );
}

/** Rendered content cut to a fixed height, with a toggle when it is longer. */
function Clamped({ children, maxHeight = 160 }: { children: React.ReactNode; maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured, not guessed: a message grows while it streams, and code blocks or lists change its height.
    const measure = () => setLong(el.scrollHeight > maxHeight + 24);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeight]);
  const cut = long && !open;
  return (
    <div>
      <div ref={ref} className={cut ? "clamped" : undefined} style={cut ? { maxHeight } : undefined}>
        {children}
      </div>
      {long && (
        <button className="more" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Detail({ item, final }: { item: TimelineItem; final: boolean }) {
  switch (item.kind) {
    case "message":
      // The agent's answer stays whole; the messages it wrote along the way are cut when long.
      return final ? (
        <Markdown text={item.text} />
      ) : (
        <Clamped>
          <Markdown text={item.text} />
        </Clamped>
      );
    case "reasoning":
      return <Expandable className="reasoning" text={item.text} lines={2} />;
    case "command":
      return <Expandable className="cmd" text={item.command} lines={4} />;
    case "file_read":
      return (
        <div className="step-title">
          <span>{item.tool}</span> <code className="path">{item.target}</code>
        </div>
      );
    case "file_edit":
      return (
        <div className="step-title">
          {item.files.map((f) => (
            <code key={f.path} className="path">
              {f.path}
            </code>
          ))}
          <span className="muted small">
            {item.files[0]?.change === "add" || item.files[0]?.change === "write"
              ? "created or written"
              : item.files[0]?.change}
          </span>
        </div>
      );
    case "web_search":
      return (
        <div className="step-title">
          {item.query ? (
            `“${item.query}”`
          ) : (
            <span className="muted">
              {item.status === "running" ? "Searching…" : "Web action without a query (open page, find)"}
            </span>
          )}
        </div>
      );
    case "web_fetch":
      return <code className="path">{item.url}</code>;
    case "tool":
      return (
        <div className="step-title">
          <span>{item.name}</span> <code className="muted small">{item.input}</code>
        </div>
      );
    case "error":
      return <div className="bad">{item.text}</div>;
    case "notice":
      return (
        <div>
          <span className="warn">{item.label}</span>
          <Clamped maxHeight={60}>
            <div className="notice-text">{item.text}</div>
          </Clamped>
        </div>
      );
    case "event":
      return <Expandable className="output" text={`${item.name}\n${item.detail}`} lines={1} />;
    case "check":
      return (
        <div className="step-title">
          <span className={item.passed ? "ok" : "bad"}>
            {item.passed ? "Check passed" : item.timedOut ? "Check timed out" : "Check failed"}
          </span>
          <code className="muted small">{item.command}</code>
        </div>
      );
  }
}

function Meta({ item }: { item: TimelineItem }) {
  const duration =
    item.kind === "check"
      ? item.durationMs
      : item.endT !== undefined && item.t !== undefined
        ? item.endT - item.t
        : undefined;
  return (
    <span className="step-meta">
      {item.status === "running" && <LoaderCircle size={12} className="spin accent" />}
      {item.kind === "command" && item.exitCode != null && item.status !== "running" && (
        <span className={item.exitCode === 0 ? "" : "warn"}>exit {item.exitCode}</span>
      )}
      {item.status === "failed" && item.kind !== "command" && <span className="bad">failed</span>}
      {duration !== undefined && (
        <span title="From the first event Dyon received for this step to its completion. Codex can announce very short commands only when they finish (about 0 s).">
          {seconds(duration)}
        </span>
      )}
    </span>
  );
}

function Step({ item, final }: { item: TimelineItem; final: boolean }) {
  return (
    <div className={`step step-${item.kind}`}>
      <span className="step-time" title="Time since the start of the turn">
        {seconds(item.t)}
      </span>
      <StepIcon item={item} />
      <div className="step-body">
        <Detail item={item} final={final} />
        {item.output && item.kind !== "message" && (
          <Expandable
            className="output"
            text={item.output}
            lines={4}
            tail={item.kind === "command" || item.kind === "check"}
          />
        )}
      </div>
      <Meta item={item} />
    </div>
  );
}

export function Timeline({ items, live }: { items: TimelineItem[]; live: boolean }) {
  // The run's answer: its last message, once the run is over.
  const finalMessageId = [...items].reverse().find((i) => i.kind === "message")?.id;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (live && el) el.scrollTop = el.scrollHeight;
  }, [items, live]);
  return (
    <div className="timeline" ref={ref}>
      {items.length === 0 && (
        <div className="empty">
          {live ? (
            <>
              <LoaderCircle size={14} className="spin" /> Waiting for the first event
            </>
          ) : (
            "No events"
          )}
        </div>
      )}
      {items.map((item) => (
        <Step key={item.id} item={item} final={!live && item.id === finalMessageId} />
      ))}
    </div>
  );
}
