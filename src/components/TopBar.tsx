import { useStore } from '../store/useStore';
import { Selector, type SelectorOption } from './Selector';

/** Magic option value: open the native folder picker instead of selecting. */
const PICK_PROJECT = '__pick_folder__';

/** Last path segment of an absolute path (`D:\a\b` → `b`). */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** OpenCode-style top bar: brand mark, project picker, session tabs, and connection/settings controls. */
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
  const currentProject = useStore((s) => s.currentProject);
  const recentProjects = useStore((s) => s.recentProjects);
  const setProject = useStore((s) => s.setProject);
  const pickProject = useStore((s) => s.pickProject);

  const projectOptions: SelectorOption[] = [
    {
      value: '',
      label: '无项目',
      hint: '对话不绑定文件夹',
    },
    ...recentProjects.map((p) => ({
      value: p,
      label: baseName(p),
      hint: p,
      group: '最近项目',
    })),
    {
      value: PICK_PROJECT,
      label: '选择其他文件夹…',
      hint: '打开系统目录选择器',
    },
  ];

  const onProjectChange = (v: string) => {
    if (v === PICK_PROJECT) pickProject();
    else setProject(v);
  };

  const rename = (index: number) => {
    const t = tabs[index];
    const name = window.prompt('会话名称', t?.name ?? '');
    if (name && name.trim()) {
      // Renaming applies to pi's current session, so switch there first.
      activateTab(index).then(() => renameActiveSession(name.trim()));
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-logo" title="Pi Desktop — OpenCode 风格桌面客户端">
        <span className="logo-mark">π</span>
        <span className="logo-name">PI</span>
      </div>
      <Selector
        className="project-select"
        options={projectOptions}
        value={currentProject ?? ''}
        onChange={onProjectChange}
        title={currentProject ? `项目：${currentProject}` : '无项目（对话不绑定文件夹）'}
        openUp={false}
      >
        <span className="sel-icon">📁</span>
        <span className="sel-name">
          {/* 「无项目」 vs 「选择项目」:recent 非空说明用户主动切到无项目 */}
          {currentProject
            ? baseName(currentProject)
            : recentProjects.length > 0
              ? '无项目'
              : '选择项目'}
        </span>
      </Selector>
      <nav className="tab-strip">
        {tabs.map((t, i) => (
          <div
            key={i}
            className={`tab ${i === activeTabIndex ? 'active' : ''}`}
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
      <div className="tab-btns">
        <button onClick={() => forkSession()} title="分叉当前会话">
          ⧉
        </button>
        <button onClick={() => newSession()} title="新建会话">
          +
        </button>
      </div>
      <div className="topbar-right">
        <span className={`conn-dot ${status === 'ready' ? 'ok' : status === 'error' ? 'err' : ''}`} />
        <button className="topbar-btn" onClick={() => setSettingsOpen(true)} title="设置">
          ⚙
        </button>
      </div>
    </header>
  );
}
