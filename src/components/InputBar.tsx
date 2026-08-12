import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';

export function InputBar() {
  const agentActive = useStore((s) => s.tabs[s.activeTabIndex]?.agentActive);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const abort = useStore((s) => s.abort);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on mount and whenever the active tab changes.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeTabIndex]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || agentActive) return;
    sendPrompt(trimmed);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  return (
    <div className="inputbar">
      <div className="inputbox">
        <span className="prompt">&gt;</span>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder="输入消息…"
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {agentActive ? (
          <button className="stop-btn" onClick={() => abort()}>
            ■ 停止
          </button>
        ) : (
          <button className="send-btn" onClick={submit} disabled={!text.trim()}>
            发送
          </button>
        )}
      </div>
      <div className="input-hint">
        {agentActive ? 'agent 运行中，可随时停止' : 'Enter 发送 · Shift+Enter 换行 · 双击标签重命名'}
      </div>
    </div>
  );
}
