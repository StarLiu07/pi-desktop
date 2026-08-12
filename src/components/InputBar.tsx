import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  computeSessionUsage,
  formatTokens,
  getCnyPerUsd,
  refreshCnyRate,
} from '../lib/usage';

export function InputBar() {
  const agentActive = useStore((s) => s.tabs[s.activeTabIndex]?.agentActive);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const messages = useStore((s) => s.tabs[s.activeTabIndex]?.messages);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const abort = useStore((s) => s.abort);
  const [text, setText] = useState('');
  // Bumped when the USD→CNY rate finishes loading so the cost line refreshes.
  const [, setRateTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on mount and whenever the active tab changes.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeTabIndex]);

  // Warm the USD→CNY rate once; cost shows in ¥ like pi's footer.
  useEffect(() => {
    refreshCnyRate().then(() => setRateTick((t) => t + 1));
  }, []);

  // Session totals for the footer, mirroring pi CLI's footer stats.
  const usage = useMemo(() => computeSessionUsage(messages ?? []), [messages]);

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
            // isComposing: IME 输入法确认候选词也触发 Enter,不能提交
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
        {usage && (
          <span className="usage-stats">
            {usage.input > 0 && <span>↑{formatTokens(usage.input)}</span>}
            {usage.output > 0 && <span>↓{formatTokens(usage.output)}</span>}
            {usage.cacheRead > 0 && <span>R{formatTokens(usage.cacheRead)}</span>}
            {usage.cacheWrite > 0 && <span>W{formatTokens(usage.cacheWrite)}</span>}
            {usage.hitRate !== null && (usage.cacheRead > 0 || usage.cacheWrite > 0) && (
              <span>CH{usage.hitRate.toFixed(1)}%</span>
            )}
            {usage.costUsd > 0 && (
              <span>¥{(usage.costUsd * getCnyPerUsd()).toFixed(2)}</span>
            )}
          </span>
        )}
        <span className="input-hint-text">
          {agentActive ? 'agent 运行中，可随时停止' : 'Enter 发送 · Shift+Enter 换行 · 双击标签重命名'}
        </span>
      </div>
    </div>
  );
}
