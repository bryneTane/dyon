"use client";

import { useState } from "react";
import { Check, Download, Link2 } from "lucide-react";

/** Share and export buttons of the report page (hidden when printing). */
export function ReportActions({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : window.location.href;
  const text = `Coding agents compared on the same task: ${title}`;
  return (
    <div className="report-actions">
      <button
        className="ghost"
        onClick={async () => {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={15} className="ok" /> : <Link2 size={15} />} {copied ? "Copied" : "Copy link"}
      </button>
      <a
        className="ghost"
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer"
      >
        Share on X
      </a>
      <a
        className="ghost"
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noreferrer"
      >
        LinkedIn
      </a>
      <button className="ghost" onClick={() => window.print()} title="Opens the print dialog: choose Save as PDF">
        <Download size={15} /> PDF
      </button>
    </div>
  );
}
