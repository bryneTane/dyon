"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { bundledLanguages } from "shiki";
import { CodeSnippet } from "./Code";

// Raw HTML in agent messages is not rendered (react-markdown default): text stays text.
const components: Components = {
  // Fenced blocks are rendered by `code` below; drop the wrapping <pre>.
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const text = String(children ?? "").replace(/\n$/, "");
    const lang = /language-([\w+#-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
    const isBlock = Boolean(lang) || text.includes("\n");
    if (!isBlock) return <code className="md-inline">{children}</code>;
    return <CodeSnippet code={text} lang={lang && lang in bundledLanguages ? lang : "text"} />;
  },
  // Agents link to paths on the server (meaningless here); only web links stay clickable.
  a({ href, children }) {
    if (href && /^https?:\/\//.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    }
    return <span className="md-path">{children}</span>;
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
