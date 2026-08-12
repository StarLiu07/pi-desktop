import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { MessageRow } from './Message';

export function ChatView() {
  const tab = useStore((s) => s.tabs[s.activeTabIndex]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const count =
    (tab?.messages.length ?? 0) +
    (tab?.streaming ? 1 : 0) +
    (tab?.pendingUserText ? 1 : 0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [count]);

  if (!tab) return null;

  const isEmpty =
    tab.messages.length === 0 &&
    !tab.streaming &&
    !tab.pendingUserText &&
    !tab.agentActive;

  return (
    <div className="chat">
      {isEmpty ? (
        <div className="chat-empty">
          <span className="logo">π</span>
          <span className="title">有什么可以帮你？</span>
          <span className="hint">输入消息开始新的会话 · Enter 发送 · Shift+Enter 换行</span>
        </div>
      ) : (
        <div className="chat-inner">
          {tab.notice && <div className="notice">{tab.notice}</div>}
          {tab.willRetry && <div className="retry-note">上次响应已重试，可能部分输出被替换</div>}
          {tab.messages.map((m, i) => (
            <MessageRow key={i} message={m} toolExecs={tab.toolExecs} />
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
      <div ref={bottomRef} />
    </div>
  );
}
