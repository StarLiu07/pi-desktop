import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { FolderIcon } from './FolderIcon';
import type { SessionListItem } from '../rpc/bridge';

/** localStorage key for the collapsed 项目 module (persists across restarts). */
const PROJ_COLLAPSE_KEY = 'pi-desktop.sidebar.proj-collapsed';

function loadProjCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJ_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** localStorage key for collapsed project groups (persists across restarts). */
const COLLAPSE_KEY = 'pi-desktop.sidebar.collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

/** Sessions shown per project group before the rest fold behind 「显示更多」. */
const GROUP_PREVIEW = 5;
/** localStorage key for groups whose preview was expanded (persists). */
const SHOWALL_KEY = 'pi-desktop.sidebar.showall';

function loadShowAll(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWALL_KEY) ?? '[]'));
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
  const recentProjects = useStore((s) => s.recentProjects);
  const setProject = useStore((s) => s.setProject);
  const openAddProject = useStore((s) => s.openAddProject);
  const [filter, setFilter] = useState('');
  // The 项目 module is collapsible as a whole; state persists to localStorage.
  const [projCollapsed, setProjCollapsed] = useState(loadProjCollapsed);
  // Collapsed project groups (by cwd key), persisted to localStorage.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  // Groups expanded past GROUP_PREVIEW via 「显示更多」, persisted too.
  const [showAll, setShowAll] = useState<Set<string>>(loadShowAll);

  const toggleProjCollapsed = () => {
    setProjCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJ_COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable (private mode etc.) — collapse still works */
      }
      return next;
    });
  };

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

  const toggleShowAll = (key: string) => {
    setShowAll((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(SHOWALL_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — expand still works */
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
      {/* Search lives at the very top of the sidebar, above both modules. */}
      <input
        className="sidebar-search"
        type="text"
        placeholder="搜索会话…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {/* 项目 — ZCode/Codex style: projects and tasks live in separate
          sections; the 「＋」only appears while hovering the header. */}
      <div className="sidebar-section proj">
        {/* The header row is the collapse control: clicking it folds/unfolds
            the project list; the 「＋」is a sibling action that appears only
            on hover (CSS) and stops propagation. The header carries no
            leading glyph — 项目 must line up with 任务 below it. */}
        <div
          className={`sidebar-header proj-header${projCollapsed ? ' collapsed' : ''}`}
          role="button"
          aria-expanded={!projCollapsed}
          title={projCollapsed ? '展开项目列表' : '折叠项目列表'}
          onClick={toggleProjCollapsed}
        >
          <span>项目</span>
          <div className="sidebar-actions">
            <button
              className="section-add"
              onClick={(e) => {
                e.stopPropagation();
                openAddProject();
              }}
              title="新建项目"
            >
              +
            </button>
          </div>
        </div>
        {!projCollapsed &&
          (recentProjects.length === 0 ? (
            <div className="sidebar-empty">暂无项目</div>
          ) : (
            recentProjects.map((p) => (
              <div
                key={p}
                className={`project-item${currentProject && samePath(p, currentProject) ? ' current' : ''}`}
                onClick={() => setProject(p)}
                title={p}
              >
                <span className="icon">
                  <FolderIcon open={!!currentProject && samePath(p, currentProject)} />
                </span>
                <span className="name">{baseName(p)}</span>
                {currentProject && samePath(p, currentProject) && (
                  <span className="cur">当前</span>
                )}
              </div>
            ))
          ))}
      </div>
      <div className="sidebar-section tasks">
        <div className="sidebar-header">
          <span>任务</span>
          <div className="sidebar-actions">
            <button className="section-add" onClick={() => newSession()} title="新建任务">
              +
            </button>
          </div>
        </div>
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
                <span className="name">{s.name ?? s.preview ?? '空会话'}</span>
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
                <span className={`chev${collapsed.has(g.key) ? '' : ' open'}`}>▸</span>
                <span className="icon">
                  <FolderIcon open={!collapsed.has(g.key)} />
                </span>
                <span className="label">{g.label}</span>
                {g.isCurrent && <span className="cur">当前</span>}
                <span className="count">{g.items.length}</span>
              </div>
              {!collapsed.has(g.key) && (() => {
                // Active session beyond the preview → auto-expand so the user
                // always sees where they are (collapsing would hide it, so the
                // toggle button is omitted in that state).
                const activeIdx = g.items.findIndex((s) => s.id === activeId);
                const autoExpanded = activeIdx >= GROUP_PREVIEW;
                const expanded = showAll.has(g.key) || autoExpanded;
                const shown = expanded ? g.items : g.items.slice(0, GROUP_PREVIEW);
                return (
                  <>
                    {shown.map((s) => (
                      <div
                        key={s.id}
                        className={`session-item grouped ${s.id === activeId ? 'active' : ''}`}
                        onClick={() => openSessionFromHistory(s)}
                        title={s.cwd ?? s.file}
                      >
                        <span className="dot" />
                        <span className="name">{s.name ?? s.preview ?? '空会话'}</span>
                        <span className="meta">{shortTime(s.timestamp)}</span>
                      </div>
                    ))}
                    {g.items.length > GROUP_PREVIEW && !autoExpanded && (
                      <button
                        className="session-group-more"
                        onClick={() => toggleShowAll(g.key)}
                      >
                        {expanded ? '收起' : `显示更多 (${g.items.length - GROUP_PREVIEW})`}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          ))
        )}
      </div>
      </div>
    </aside>
  );
}
