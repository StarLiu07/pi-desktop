import { useStore } from '../store/useStore';
import { WindowControls } from './WindowControls';

/** OpenCode-style top bar: brand mark, session tabs, and connection/settings controls. */
export function TopBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const newSession = useStore((s) => s.newSession);
  const forkSession = useStore((s) => s.forkSession);
  const renameActiveSession = useStore((s) => s.renameActiveSession);
  const status = useStore((s) => s.status);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const rename = (index: number) => {
    const t = tabs[index];
    const name = window.prompt('会话名称', t?.name ?? '');
    if (name && name.trim()) {
      // Renaming applies to pi's current session, so switch there first.
      activateTab(index).then(() => renameActiveSession(name.trim()));
    }
  };

  return (
    <header className="topbar" data-tauri-drag-region="deep">
      <div className="topbar-logo" title="Pi Desktop — OpenCode 风格桌面客户端">
        <span className="logo-mark">π</span>
        <span className="logo-name">PI</span>
      </div>
      {/* The strip itself stays draggable (empty space between tabs); only each
          tab must block dragging so clicks still activate sessions. */}
      <nav className="tab-strip">
        {tabs.map((t, i) => (
          <div
            key={i}
            className={`tab ${i === activeTabIndex ? 'active' : ''}`}
            data-tauri-drag-region="false"
            onClick={() => activateTab(i)}
            onDoubleClick={() => rename(i)}
            title="双击重命名"
          >
            <span className="tab-name">{t.name}</span>
            {t.agentActive && <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulse 1s infinite' }} />}
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
      </nav>
      <div className="tab-btns" data-tauri-drag-region="false">
        <button onClick={() => forkSession()} title="分叉当前会话">
          ⧉
        </button>
        <button onClick={() => newSession()} title="新建会话">
          +
        </button>
      </div>
      <div className="topbar-right" data-tauri-drag-region="false">
        <span className={`conn-dot ${status === 'ready' ? 'ok' : status === 'error' ? 'err' : ''}`} />
        <button className="topbar-btn" onClick={() => setSettingsOpen(true)} title="设置">
          ⚙
        </button>
      </div>
      <WindowControls />
    </header>
  );
}
