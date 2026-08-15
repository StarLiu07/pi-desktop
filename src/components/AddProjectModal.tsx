// Add-project dialog, codex/zcode style: type an absolute path (or browse
// with the native picker), add a *new* folder by just typing its name — the
// dialog offers 「创建并添加」 and the folder is created on confirm. Live
// validation runs in Rust (the WebView has no filesystem access), and recent
// projects are one click away. Adding switches the project, which restarts
// pi with the new cwd (see project.rs).
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { createProjectDir, pickProject, projectPathInfo } from '../rpc/bridge';

/** Validation result of the typed path. */
type PathState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' } // exists and is a folder → 「添加项目」
  | { kind: 'create' } // doesn't exist yet → 「创建并添加」
  | { kind: 'current' } // already the active project → nothing to do
  | { kind: 'err'; message: string };

/** Last path segment of an absolute path (`D:\a\b` → `b`). */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Case-insensitive path equality (Windows drives may differ in case). */
function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

export function AddProjectModal() {
  const open = useStore((s) => s.addProjectOpen);
  const closeAddProject = useStore((s) => s.closeAddProject);
  const setProject = useStore((s) => s.setProject);
  const currentProject = useStore((s) => s.currentProject);
  const recentProjects = useStore((s) => s.recentProjects);

  const [path, setPath] = useState('');
  const [state, setState] = useState<PathState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(0); // debounce/race guard for path checks

  // Fresh dialog state each time it opens.
  useEffect(() => {
    if (!open) return;
    setPath('');
    setState({ kind: 'idle' });
    setBusy(false);
    inputRef.current?.focus();
  }, [open]);

  // Debounced validation of the typed path (frontend can't stat the disk).
  useEffect(() => {
    if (!open) return;
    const trimmed = path.trim();
    if (!trimmed) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'checking' });
    const id = ++pendingRef.current;
    const t = setTimeout(() => {
      projectPathInfo(trimmed)
        .then((info) => {
          if (pendingRef.current !== id) return;
          if (!info.exists) setState({ kind: 'create' });
          else if (!info.is_dir) setState({ kind: 'err', message: '该路径是文件，不是文件夹' });
          else if (currentProject && samePath(trimmed, currentProject))
            setState({ kind: 'current' });
          else setState({ kind: 'ok' });
        })
        .catch((e: unknown) => {
          if (pendingRef.current !== id) return;
          setState({ kind: 'err', message: String(e) });
        });
    }, 300);
    return () => clearTimeout(t);
  }, [path, open, currentProject]);

  if (!open) return null;

  const canConfirm =
    !busy && (state.kind === 'ok' || state.kind === 'create');

  const browse = async () => {
    const dir = await pickProject().catch(() => null);
    if (dir) setPath(dir); // validation effect picks it up
  };

  const confirm = async () => {
    const dir = path.trim();
    if (!canConfirm) return;
    setBusy(true);
    try {
      if (state.kind === 'create') {
        await createProjectDir(dir).catch((e: unknown) => {
          setState({ kind: 'err', message: String(e) });
          throw e;
        });
      }
      closeAddProject();
      // Restart pi with the new cwd; the shell flips to 'connecting' and the
      // app re-initializes. Errors surface on the error screen.
      await setProject(dir).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const hint = (() => {
    switch (state.kind) {
      case 'checking':
        return <span className="proj-hint checking">正在检查…</span>;
      case 'ok':
        return <span className="proj-hint ok">✓ 文件夹已存在，将直接切换</span>;
      case 'create':
        return <span className="proj-hint create">该文件夹不存在，添加时将自动创建</span>;
      case 'current':
        return <span className="proj-hint err">这已是当前项目</span>;
      case 'err':
        return <span className="proj-hint err">⚠ {state.message}</span>;
      default:
        return <span className="proj-hint idle">输入文件夹绝对路径，或点击「浏览…」选择</span>;
    }
  })();

  const recents = recentProjects.filter((p) => !samePath(p, path.trim()));

  return (
    <div className="modal-overlay" onClick={() => !busy && closeAddProject()}>
      <div className="modal add-project" onClick={(e) => e.stopPropagation()}>
        <h2>添加项目</h2>
        <div className="field">
          <label>文件夹路径</label>
          <div className="proj-path-row">
            <input
              ref={inputRef}
              type="text"
              spellCheck={false}
              placeholder="D:\projects\myapp"
              value={path}
              disabled={busy}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  confirm();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeAddProject();
                }
              }}
            />
            <button type="button" className="browse-btn" onClick={browse} disabled={busy}>
              浏览…
            </button>
          </div>
          {hint}
        </div>
        {recents.length > 0 && (
          <div className="field">
            <label>最近项目</label>
            <div className="proj-recent">
              {recents.slice(0, 6).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="proj-chip"
                  title={p}
                  disabled={busy}
                  onClick={() => setPath(p)}
                >
                  {baseName(p)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="proj-note">添加后将切换到该文件夹并新建会话</div>
        <div className="actions">
          <button onClick={closeAddProject} disabled={busy}>
            取消
          </button>
          <button
            className="primary"
            onClick={confirm}
            disabled={!canConfirm}
            title={canConfirm ? '切换工作目录（会重启 pi 进程）' : undefined}
          >
            {state.kind === 'create' ? '创建并添加' : '添加项目'}
          </button>
        </div>
      </div>
    </div>
  );
}
