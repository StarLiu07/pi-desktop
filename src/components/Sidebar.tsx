import { useStore } from '../store/useStore';

function shortTime(ts: string | null): string {
  if (!ts) return '';
  // ISO timestamp like "2026-08-12T14:14:20.287Z"
  const m = /T(\d{2}):(\d{2})/.exec(ts);
  return m ? `${m[1]}:${m[2]}` : '';
}

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const tabs = useStore((s) => s.tabs);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const openSessionFromHistory = useStore((s) => s.openSessionFromHistory);
  const newSession = useStore((s) => s.newSession);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const activeId = tabs[activeTabIndex]?.sessionId;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>会话历史</span>
        <button onClick={() => newSession()} title="新建会话">
          +
        </button>
      </div>
      <div className="session-tree">
        {sessions.length === 0 ? (
          <div className="sidebar-empty">还没有会话。发一条消息开始吧。</div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => openSessionFromHistory(s)}
              title={s.cwd ?? s.file}
            >
              <span className="dot" />
              <span className="name">{s.name ?? s.file}</span>
              <span className="meta">{shortTime(s.timestamp)}</span>
            </div>
          ))
        )}
      </div>
      <div className="sidebar-footer">
        <button onClick={() => setSettingsOpen(true)}>设置</button>
      </div>
    </aside>
  );
}
