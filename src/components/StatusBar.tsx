import { useStore } from '../store/useStore';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function StatusBar() {
  const status = useStore((s) => s.status);
  const currentModel = useStore((s) => s.currentModel);
  const models = useStore((s) => s.models);
  const setModel = useStore((s) => s.setModel);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const setThinkingLevel = useStore((s) => s.setThinkingLevel);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  return (
    <div className="statusbar">
      <span className="status-item">
        <span className={`dot ${status === 'ready' ? 'ok' : status === 'error' ? 'err' : 'warn'}`} />
        pi
      </span>
      <div className="spacer" />
      <select
        value={thinkingLevel}
        onChange={(e) => setThinkingLevel(e.target.value)}
        title="思考等级"
      >
        {THINKING_LEVELS.map((l) => (
          <option key={l} value={l}>
            thinking: {l}
          </option>
        ))}
      </select>
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
      <span className="status-item" onClick={() => setSettingsOpen(true)} title="设置">
        ⚙
      </span>
    </div>
  );
}
