import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Frameless-window controls (opencode style): minimize / maximize-restore / close.
 * Renders as a no-drag region, so it must sit inside a `data-tauri-drag-region`
 * header (or a `.screen` that is itself a drag region).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      win.isMaximized().then(setMaximized).catch(() => undefined);
      win
        .onResized(() => {
          win.isMaximized().then(setMaximized).catch(() => undefined);
        })
        .then((fn) => (unlisten = fn))
        .catch(() => undefined);
    } catch {
      /* running outside Tauri */
    }
    return () => unlisten?.();
  }, []);

  const act = (fn: (win: ReturnType<typeof getCurrentWindow>) => Promise<void>) => () => {
    try {
      fn(getCurrentWindow()).catch(() => undefined);
    } catch {
      /* running outside Tauri */
    }
  };

  return (
    <div className="window-controls" data-tauri-drag-region="false">
      <button className="wc-btn" onClick={act((w) => w.minimize())} title="最小化">
        <span className="wc-icon wc-min" />
      </button>
      <button
        className="wc-btn"
        onClick={act((w) => w.toggleMaximize())}
        title={maximized ? '还原' : '最大化'}
      >
        <span className={`wc-icon ${maximized ? 'wc-restore' : 'wc-max'}`} />
      </button>
      <button className="wc-btn close" onClick={act((w) => w.close())} title="关闭">
        <span className="wc-close">✕</span>
      </button>
    </div>
  );
}
