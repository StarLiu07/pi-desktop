// Shared selector option builders for the input bar and the status bar.
import type { SelectorOption } from '../components/Selector';
import type { ModelInfo } from '../rpc/types';

/** pi thinking levels with a short Chinese gloss for the menu. */
export const THINKING_LEVELS: SelectorOption[] = [
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
export function thinkingOptions(model: ModelInfo | null): SelectorOption[] {
  const map = model?.thinkingLevelMap as Record<string, unknown> | undefined;
  if (!map) return THINKING_LEVELS;
  return THINKING_LEVELS.map((l) =>
    map[l.value] != null ? l : { ...l, disabled: true, hint: '当前模型不支持' },
  );
}

/**
 * Option key for a model. Model ids are NOT unique across providers — pi
 * serves e.g. `deepseek-v4-flash` under deepseek / opencode-go / jbbtoken
 * alike — so the key must carry the provider; pi's own set_model RPC takes
 * provider + modelId for the same reason.
 */
export function modelKey(m: ModelInfo): string {
  return `${m.provider ?? ''}::${m.id}`;
}

/** Models grouped by provider, preserving first-seen order. */
export function modelOptions(models: ModelInfo[]): SelectorOption[] {
  return models.map((m) => ({ value: modelKey(m), label: m.name, group: m.provider }));
}
