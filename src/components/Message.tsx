import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { memo } from 'react';
import type { ChatMessage, ContentPart } from '../rpc/types';
import type { ToolExecState } from '../store/useStore';
import { ToolCard } from './ToolCard';

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
              <details className="thinking-block" key={i}>
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
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {part.text ?? ''}
                </ReactMarkdown>
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

export function MessageRow({ message, toolExecs, streaming = false }: RowProps) {
  if (message.role === 'user') {
    const text = message.content.map((c) => c.text ?? '').join('\n');
    return (
      <div className="message-row user">
        <span className="prompt">&gt;</span>
        <div className="user-text">{text}</div>
      </div>
    );
  }
  if (message.role === 'toolResult') {
    const text = message.content.map((c) => (c.text ?? c.content ?? '')).join('\n');
    return (
      <div className="message-row tool-result">
        <div className="bubble">{text || '（无输出）'}</div>
      </div>
    );
  }
  return (
    <div className="message-row assistant">
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
