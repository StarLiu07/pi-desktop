import { useStore } from '../store/useStore';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const newSession = useStore((s) => s.newSession);
  const forkSession = useStore((s) => s.forkSession);
  const renameActiveSession = useStore((s) => s.renameActiveSession);

  const rename = (index: number) => {
    const t = tabs[index];
    const name = window.prompt('会话名称', t?.name ?? '');
    if (name && name.trim()) {
      // Renaming applies to pi's current session, so switch there first.
      activateTab(index).then(() => renameActiveSession(name.trim()));
    }
  };

  return (
    <div className="tabbar">
      {tabs.map((t, i) => (
        <div
          key={i}
          className={`tab ${i === activeTabIndex ? 'active' : ''}`}
          onClick={() => activateTab(i)}
          onDoubleClick={() => rename(i)}
          title="双击重命名"
        >
          <span className="tab-name">{t.name}</span>
          {t.agentActive && <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(i);
            }}
            title="关闭会话"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={() => forkSession()} title="分叉当前会话">
        ⧉
      </button>
      <button className="tab-new" onClick={() => newSession()} title="新建会话">
        +
      </button>
    </div>
  );
}
