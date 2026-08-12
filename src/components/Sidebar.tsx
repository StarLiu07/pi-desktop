import { useState } from 'react';
import { useStore } from '../store/useStore';

function shortTime(ts: string | null): string {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const tabs = useStore((s) => s.tabs);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const openSessionFromHistory = useStore((s) => s.openSessionFromHistory);
  const newSession = useStore((s) => s.newSession);
  const [filter, setFilter] = useState('');

  const activeId = tabs[activeTabIndex]?.sessionId;
  const q = filter.trim().toLowerCase();
  const visible = q
    ? sessions.filter((s) => `${s.name ?? ''} ${s.file}`.toLowerCase().includes(q))
    : sessions;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>会话历史</span>
        <button onClick={() => newSession()} title="新建会话">
          +
        </button>
      </div>
      <input
        className="sidebar-search"
        type="text"
        placeholder="搜索会话…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="session-tree">
        {visible.length === 0 ? (
          <div className="sidebar-empty">
            {q ? '没有匹配的会话。' : '还没有会话。发一条消息开始吧。'}
          </div>
        ) : (
          visible.map((s) => (
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
    </aside>
  );
}
