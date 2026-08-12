import { useStore } from '../store/useStore';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function StatusBar() {
  const status = useStore((s) => s.status);
  const currentModel = useStore((s) => s.currentModel);
  const models = useStore((s) => s.models);
  const setModel = useStore((s) => s.setModel);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const setThinkingLevel = useStore((s) => s.setThinkingLevel);

  return (
    <div className="statusbar">
      <span className="status-item">
        <span className={`dot ${status === 'ready' ? 'ok' : status === 'error' ? 'err' : 'warn'}`} />
        <span className={`status-state ${status === 'ready' ? 'ready' : ''}`}>
          {status === 'ready' ? 'pi 已连接' : status === 'error' ? '连接中断' : '连接中…'}
        </span>
      </span>
      <div className="spacer" />
      <span className="status-item">
        思考
        <select
          value={thinkingLevel}
          onChange={(e) => setThinkingLevel(e.target.value)}
          title="思考等级"
        >
          {THINKING_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </span>
      <span className="status-item">
        模型
        <select
          value={currentModel?.id ?? ''}
          onChange={(e) => setModel(e.target.value)}
          title="模型"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
