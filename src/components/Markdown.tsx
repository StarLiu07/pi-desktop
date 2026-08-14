import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useState, type HTMLAttributes } from 'react';

/**
 * Markdown renderer. Lives in its own chunk (imported lazily from Message.tsx)
 * so the heavy react-markdown/highlight.js stack is not parsed before the
 * app's first frame — it loads on demand when messages actually render.
 */

/** Code block with a copy button; falls back to a plain pre outside of markdown. */
function CodeBlock({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="code-wrap">
      <button className="code-copy" onClick={copy} title="复制代码">
        {copied ? '✓' : '⧉'}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ pre: CodeBlock }}
    >
      {text}
    </ReactMarkdown>
  );
}
