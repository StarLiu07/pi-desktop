import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { SessionListItem } from '../rpc/bridge';

/** localStorage key for collapsed project groups (persists across restarts). */
const COLLAPSE_KEY = 'pi-desktop.sidebar.collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

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

/** Case-insensitive path equality (Windows drives may differ in case). */
function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

/** Last path segment of an absolute path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Sessions grouped by their recorded project folder (the session header cwd). */
interface SessionGroup {
  key: string; // cwd, '' for sessions without one
  label: string;
  path: string;
  isCurrent: boolean;
  items: SessionListItem[];
}

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const tabs = useStore((s) => s.tabs);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const openSessionFromHistory = useStore((s) => s.openSessionFromHistory);
  const newSession = useStore((s) => s.newSession);
  const currentProject = useStore((s) => s.currentProject);
  const [filter, setFilter] = useState('');
  // Collapsed project groups (by cwd key), persisted to localStorage.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable (private mode etc.) — collapse still works */
      }
      return next;
    });
  };

  const activeId = tabs[activeTabIndex]?.sessionId;
  const q = filter.trim().toLowerCase();
  const visible = q
    ? sessions.filter((s) =>
        `${s.name ?? ''} ${s.preview ?? ''} ${s.file}`.toLowerCase().includes(q),
      )
    : sessions;

  // Group by cwd: the current project first, then other folders ordered by
  // their most recent session (newest group on top), so old conversations
  // stay visible instead of being buried under a name-sorted list. Search
  // mode keeps the flat list.
  const groups = useMemo(() => {
    if (q) return null;
    const map = new Map<string, SessionGroup>();
    for (const s of sessions) {
      const cwd = s.cwd ?? '';
      let g = map.get(cwd);
      if (!g) {
        g = {
          key: cwd,
          label: cwd ? baseName(cwd) : '其他',
          path: cwd,
          isCurrent: !!currentProject && !!cwd && samePath(cwd, currentProject),
          items: [],
        };
        map.set(cwd, g);
      }
      g.items.push(s);
    }
    const latest = (g: SessionGroup) =>
      g.items.reduce((m, s) => Math.max(m, Date.parse(s.timestamp ?? '') || 0), 0);
    return [...map.values()].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return latest(b) - latest(a);
    });
  }, [sessions, q, currentProject]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>会话历史</span>
        <div className="sidebar-actions">
          <button onClick={() => newSession()} title="新建会话">
            +
          </button>
        </div>
      </div>
      <input
        className="sidebar-search"
        type="text"
        placeholder="搜索会话…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="session-tree">
        {groups === null ? (
          // Search mode: flat list.
          visible.length === 0 ? (
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
                <span className="name">{s.name ?? s.preview ?? s.file}</span>
                <span className="meta">{shortTime(s.timestamp)}</span>
              </div>
            ))
          )
        ) : groups.length === 0 ? (
          <div className="sidebar-empty">还没有会话。发一条消息开始吧。</div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="session-group">
              <div
                className={`session-group-label${g.isCurrent ? ' current' : ''}${
                  collapsed.has(g.key) ? ' collapsed' : ''
                }`}
                title={collapsed.has(g.key) ? `${g.path}\n点击展开会话列表` : `${g.path}\n点击折叠会话列表`}
                role="button"
                aria-expanded={!collapsed.has(g.key)}
                onClick={() => toggleGroup(g.key)}
              >
                <span className="chev">{collapsed.has(g.key) ? '▸' : '▾'}</span>
                <span className="icon">📁</span>
                <span className="label">{g.label}</span>
                {g.isCurrent && <span className="cur">当前</span>}
                <span className="count">{g.items.length}</span>
              </div>
              {!collapsed.has(g.key) &&
                g.items.map((s) => (
                  <div
                    key={s.id}
                    className={`session-item grouped ${s.id === activeId ? 'active' : ''}`}
                    onClick={() => openSessionFromHistory(s)}
                    title={s.cwd ?? s.file}
                  >
                    <span className="dot" />
                    <span className="name">{s.name ?? s.preview ?? s.file}</span>
                    <span className="meta">{shortTime(s.timestamp)}</span>
                  </div>
                ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
