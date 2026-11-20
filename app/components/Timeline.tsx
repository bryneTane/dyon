import {
  AlertTriangle,
  Brain,
  CircleAlert,
  FileText,
  Globe,
  Info,
  Loader2,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TimelineItem } from "@/lib/domain/types";
import { Markdown } from "./Markdown";

/** One run's steps in order, each kind with its own look. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((item) => (
        <li key={item.id} className={`step step-${item.kind} ${item.status ? `is-${item.status}` : ""}`}>
          <Step item={item} />
        </li>
      ))}
    </ol>
  );
}

function Step({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return <Markdown text={item.text} />;
    case "reasoning":
      return (
        <details>
          <summary>
            <Head icon={Brain} label="Reasoning" item={item} />
          </summary>
          <Markdown text={item.text} />
        </details>
      );
    case "command":
      return (
        <details open={item.status === "failed"}>
          <summary>
            <Head icon={SquareTerminal} label="Command" item={item}>
              {item.exitCode != null && item.exitCode !== 0 && <span className="badge bad">exit {item.exitCode}</span>}
            </Head>
            <code className="line">{item.command}</code>
          </summary>
          {item.output ? <pre className="output">{item.output}</pre> : <p className="muted small">No output.</p>}
        </details>
      );
    case "file_read":
      return (
        <Head icon={FileText} label={`${item.tool}`} item={item}>
          <code>{item.target}</code>
        </Head>
      );
    case "file_edit":
      return (
        <WithOutput item={item}>
          <Head icon={Pencil} label="Edited" item={item}>
            {item.files.map((f) => (
              <span key={f.path} className="file">
                <code>{f.path}</code> <span className="muted small">{f.change}</span>
              </span>
            ))}
          </Head>
        </WithOutput>
      );
    case "web_search":
      return (
        <WithOutput item={item}>
          <Head icon={Search} label="Web search" item={item}>
            <span>{item.query}</span>
          </Head>
        </WithOutput>
      );
    case "web_fetch":
      return (
        <WithOutput item={item}>
          <Head icon={Globe} label="Web page" item={item}>
            <code>{item.url}</code>
          </Head>
        </WithOutput>
      );
    case "tool":
      return (
        <details>
          <summary>
            <Head icon={Wrench} label={item.name} item={item} />
          </summary>
          <pre className="output">{item.input}</pre>
          {item.output && <pre className="output">{item.output}</pre>}
        </details>
      );
    case "error":
      return (
        <Head icon={CircleAlert} label="Error" item={item}>
          {item.text}
        </Head>
      );
    case "notice":
      return (
        <Head icon={AlertTriangle} label={item.label} item={item}>
          <span className="pre">{item.text}</span>
        </Head>
      );
    case "event":
      return (
        <details>
          <summary>
            <Head icon={Info} label={item.name} item={item} />
          </summary>
          <pre className="output">{item.detail}</pre>
        </details>
      );
    case "check":
      return <Head icon={SquareTerminal} label={item.passed ? "Check passed" : "Check failed"} item={item} />;
  }
}

/** Steps whose result is optional: shown under a toggle only when there is one. */
function WithOutput({ item, children }: { item: TimelineItem; children: ReactNode }) {
  if (!item.output) return <>{children}</>;
  return (
    <details>
      <summary>{children}</summary>
      <pre className="output">{item.output}</pre>
    </details>
  );
}

function Head({
  icon: Icon,
  label,
  item,
  children,
}: {
  icon: LucideIcon;
  label: string;
  item: TimelineItem;
  children?: ReactNode;
}) {
  return (
    <div className="head">
      {item.status === "running" ? (
        <Loader2 size={14} className="spin" aria-label="Running" />
      ) : (
        <Icon size={14} aria-hidden />
      )}
      <span className="label">{label}</span>
      {children}
      <span className="time">{timing(item)}</span>
    </div>
  );
}

function timing(item: TimelineItem): string {
  if (item.t === undefined) return "";
  const at = `${(item.t / 1000).toFixed(1)} s`;
  return item.endT !== undefined ? `${at} · ${((item.endT - item.t) / 1000).toFixed(1)} s` : at;
}
