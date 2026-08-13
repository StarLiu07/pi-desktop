import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Selector, type SelectorOption } from './Selector';
import type { ModelInfo } from '../rpc/types';
import {
  computeSessionUsage,
  formatTokens,
  getCnyPerUsd,
  refreshCnyRate,
} from '../lib/usage';

/** Magic option value: open the native folder picker instead of selecting. */
const PICK_PROJECT = '__pick_folder__';

/** Last path segment of an absolute path (`D:\a\b` → `b`). */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** pi thinking levels with a short Chinese gloss for the menu. */
const THINKING_LEVELS: SelectorOption[] = [
  { value: 'off', label: 'off', hint: '关闭' },
  { value: 'minimal', label: 'minimal', hint: '极少' },
  { value: 'low', label: 'low', hint: '少' },
  { value: 'medium', label: 'medium', hint: '中等' },
  { value: 'high', label: 'high', hint: '多' },
  { value: 'xhigh', label: 'xhigh', hint: '很多' },
  { value: 'max', label: 'max', hint: '最大' },
];

/**
 * Thinking levels for the active model. Models expose a `thinkingLevelMap`
 * (level → provider mapping, null = unsupported); when present, unsupported
 * levels are dimmed and not selectable.
 */
function thinkingOptions(model: ModelInfo | null): SelectorOption[] {
  const map = model?.thinkingLevelMap as Record<string, unknown> | undefined;
  if (!map) return THINKING_LEVELS;
  return THINKING_LEVELS.map((l) =>
    map[l.value] != null ? l : { ...l, disabled: true, hint: '当前模型不支持' },
  );
}

/** Models grouped by provider, preserving first-seen order. */
function modelOptions(models: ModelInfo[]): SelectorOption[] {
  return models.map((m) => ({ value: m.id, label: m.name, group: m.provider }));
}

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

  const currentProject = useStore((s) => s.currentProject);
  const recentProjects = useStore((s) => s.recentProjects);
  const setProject = useStore((s) => s.setProject);
  const pickProject = useStore((s) => s.pickProject);

  const projectOptions: SelectorOption[] = [
    {
      value: '',
      label: '无项目',
      hint: '对话不绑定文件夹',
    },
    ...recentProjects.map((p) => ({
      value: p,
      label: baseName(p),
      hint: p,
      group: '最近项目',
    })),
    {
      value: PICK_PROJECT,
      label: '选择其他文件夹…',
      hint: '打开系统目录选择器',
    },
  ];

  const onProjectChange = (v: string) => {
    if (v === PICK_PROJECT) pickProject();
    else setProject(v);
  };

  const currentModel = useStore((s) => s.currentModel);
  const models = useStore((s) => s.models);
  const setModel = useStore((s) => s.setModel);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const setThinkingLevel = useStore((s) => s.setThinkingLevel);

  // Non-reasoning models (image models, no-thinking variants) ignore the
  // thinking level entirely — disable the control instead of pretending.
  const thinkingDisabled = !!currentModel && !currentModel.reasoning;

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
        <div className="inputbox-tools">
          <Selector
            className="project-select"
            options={projectOptions}
            value={currentProject ?? ''}
            onChange={onProjectChange}
            title={currentProject ? `项目：${currentProject}` : '无项目（对话不绑定文件夹）'}
          >
            <span className="sel-icon">📁</span>
            <span className="sel-name">
              {/* 「无项目」 vs 「选择项目」:recent 非空说明用户主动切到无项目 */}
              {currentProject
                ? baseName(currentProject)
                : recentProjects.length > 0
                  ? '无项目'
                  : '选择项目'}
            </span>
          </Selector>
        </div>
        <div className="inputbox-main">
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
        <Selector
          className="inputbox-select"
          options={thinkingOptions(currentModel)}
          value={thinkingLevel}
          onChange={setThinkingLevel}
          disabled={thinkingDisabled}
          title={thinkingDisabled ? '当前模型不支持思考' : '思考强度'}
        >
          <span className="sel-icon">⚡</span>
          <span className="sel-name">{thinkingLevel}</span>
        </Selector>
        <Selector
          className="inputbox-select"
          options={modelOptions(models)}
          value={currentModel?.id ?? ''}
          onChange={setModel}
          title={currentModel ? `${currentModel.name} · ${currentModel.provider}` : '切换模型'}
          alignRight
        >
          <span className="sel-name">{currentModel?.name ?? '选择模型'}</span>
        </Selector>
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
