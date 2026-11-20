import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Agent text rendered as Markdown. Raw HTML in the text is shown as text, never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
