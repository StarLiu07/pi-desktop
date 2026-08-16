import { lazy, memo, Suspense } from 'react';
import type { ChatMessage, ContentPart } from '../rpc/types';
import type { ToolExecState } from '../store/useStore';
import { ToolCard } from './ToolCard';

// Deferred chunk: react-markdown + highlight.js parse on demand, after the
// first frame (see Markdown.tsx). Falls back to plain text while loading.
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));

interface RowProps {
  message: ChatMessage;
  toolExecs: Record<string, ToolExecState>;
  /** true while this assistant message is still receiving message_update events */
  streaming?: boolean;
}

/** Assistant message content: thinking blocks, tool call cards and text parts. */
function AssistantContent({
  parts,
  toolExecs,
  streaming,
}: {
  parts: ContentPart[];
  toolExecs: Record<string, ToolExecState>;
  streaming: boolean;
}) {
  const lastTextIndex = [...parts]
    .reverse()
    .findIndex((p) => p.type === 'text');
  const lastTextAt = lastTextIndex >= 0 ? parts.length - 1 - lastTextIndex : -1;

  return (
    <div className="md">
      {parts.map((part, i) => {
        switch (part.type) {
          case 'thinking':
            return (
              <details className="thinking-block" key={i} open={streaming}>
                <summary>思考过程</summary>
                <div className="thinking-content">{part.thinking}</div>
              </details>
            );          case 'toolCall': {
            const exec = part.id ? toolExecs[part.id] : undefined;
            return (
              <ToolCard
                key={i}
                tool={
                  exec ?? {
                    id: part.id ?? '',
                    name: part.name ?? 'tool',
                    args: part.arguments ?? {},
                    status: 'running',
                    result: '',
                  }
                }
              />
            );
          }
          case 'text':
            if (streaming && i === lastTextAt) {
              // During streaming render plain text to avoid re-parsing markdown per delta.
              return (
                <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
                  {part.text}
                  <span className="caret" />
                </div>
              );
            }
            return (
              <div key={i} className="md-text">
                <Suspense fallback={<div className="md-text">{part.text ?? ''}</div>}>
                  <Markdown text={part.text ?? ''} />
                </Suspense>
              </div>
            );
          case 'image':
            // Multimodal image part (data URL or path).
            return (
              <div key={i} className="md-image">
                <img src={part.image} alt="" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

const AssistantContentMemo = memo(AssistantContent);

/** Recursively extract plain text from a content part (tool results nest arrays). */
function partText(c: ContentPart): string {
  if (typeof c.text === 'string') return c.text;
  if (Array.isArray(c.content)) {
    return c.content
      .map((x) => (typeof x === 'string' ? x : partText(x as ContentPart)))
      .join('\n');
  }
  return '';
}

export function MessageRow({ message, toolExecs, streaming = false }: RowProps) {
  if (message.role === 'user') {
    const text = message.content.map(partText).join('\n');
    return (
      <div className="message-row user">
        <span className="prompt">&gt;</span>
        <div className="user-text">{text}</div>
      </div>
    );
  }
  if (message.role === 'toolResult') {
    const text = message.content.map(partText).join('\n');
    return (
      <div className="message-row tool-result">
        <div className="bubble">{text || '（无输出）'}</div>
      </div>
    );
  }
  return (
    <div className="message-row assistant">
      {(message.model || message.usage) && (
        <div className="turn-head">
          {message.model && <span className="turn-model">{message.model}</span>}
          {message.usage && (
            <span className="turn-usage">
              {message.usage.totalTokens.toLocaleString()} tokens
              {message.usage.cost.total > 0 ? ` · $${message.usage.cost.total.toFixed(4)}` : ''}
            </span>
          )}
        </div>
      )}
      <div className="bubble">
        <AssistantContentMemo
          parts={message.content}
          toolExecs={toolExecs}
          streaming={streaming}
        />
      </div>
    </div>
  );
}
