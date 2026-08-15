import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { MessageRow } from './Message';

/** Within this many px of the bottom, new content keeps the view pinned. */
const STICK_THRESHOLD = 80;

export function ChatView() {
  const tab = useStore((s) => s.tabs[s.activeTabIndex]);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const status = useStore((s) => s.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const isEmpty =
    tab?.messages.length === 0 &&
    !tab?.streaming &&
    !tab?.pendingUserText &&
    !tab?.agentActive;

  // Follow content growth (and shrink) while the user is near the bottom —
  // reading an old message must not be yanked by incoming deltas. The chat
  // height changes without the message count changing whenever the thinking
  // block collapses at message_end, streamed deltas land, tool cards update
  // or images load, so a ResizeObserver (not a count-keyed effect) drives it.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (!stick.current) return;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [isEmpty]);

  // Switching tabs always lands at the bottom of the new conversation.
  useEffect(() => {
    stick.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeTabIndex]);

  if (!tab) return null;

  return (
    <div
      className="chat"
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      }}
    >
      {isEmpty ? (
        status === 'connecting' ? (
          <div className="chat-empty">
            <span className="spinner" />
            <span className="title">正在连接 pi 进程…</span>
          </div>
        ) : (
          <div className="chat-empty">
            <span className="logo">π</span>
            <span className="title">有什么可以帮你？</span>
            <span className="hint">输入消息开始新的会话 · Enter 发送 · Shift+Enter 换行</span>
          </div>
        )
      ) : (
        <div className="chat-inner" ref={innerRef}>
          {tab.notice && <div className="notice">{tab.notice}</div>}
          {tab.willRetry && <div className="retry-note">上次响应已重试，可能部分输出被替换</div>}
          {tab.messages.map((m, i) => (
            <MessageRow
              key={m.responseId ?? m.toolCallId ?? `msg-${i}`}
              message={m}
              toolExecs={tab.toolExecs}
            />
          ))}
          {tab.pendingUserText && (
            <div className="message-row user pending">
              <span className="prompt">&gt;</span>
              <div className="user-text">{tab.pendingUserText}</div>
            </div>
          )}
          {tab.streaming && (
            <MessageRow message={tab.streaming} toolExecs={tab.toolExecs} streaming />
          )}
          {tab.agentActive && !tab.streaming && (
            <div className="agent-dots">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
