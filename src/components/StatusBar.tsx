import { useStore } from '../store/useStore';
import { Selector, type SelectorOption } from './Selector';
import type { ModelInfo } from '../rpc/types';

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

export function StatusBar() {
  const status = useStore((s) => s.status);
  const currentModel = useStore((s) => s.currentModel);
  const models = useStore((s) => s.models);
  const setModel = useStore((s) => s.setModel);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const setThinkingLevel = useStore((s) => s.setThinkingLevel);

  // Non-reasoning models (image models, no-thinking variants) ignore the
  // thinking level entirely — disable the control instead of pretending.
  const thinkingDisabled = !!currentModel && !currentModel.reasoning;

  return (
    <div className="statusbar">
      <span className="status-item">
        <span className={`dot ${status === 'ready' ? 'ok' : status === 'error' ? 'err' : 'warn'}`} />
        <span className={`status-state ${status === 'ready' ? 'ready' : ''}`}>
          {status === 'ready' ? 'pi 已连接' : status === 'error' ? '连接中断' : '连接中…'}
        </span>
      </span>
      <div className="spacer" />
      <Selector
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
        options={modelOptions(models)}
        value={currentModel?.id ?? ''}
        onChange={setModel}
        title={currentModel ? `${currentModel.name} · ${currentModel.provider}` : '切换模型'}
        alignRight
      >
        <span className="sel-name">{currentModel?.name ?? '选择模型'}</span>
      </Selector>
    </div>
  );
}
