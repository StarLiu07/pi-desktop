import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from './store/useStore';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsModal } from './components/SettingsModal';

function ConnectingScreen() {
  return (
    <div className="screen">
      <div className="card">
        <span className="spinner" />
        <p>正在连接 pi 进程…</p>
      </div>
    </div>
  );
}

function InstallScreen() {
  return (
    <div className="screen">
      <div className="card">
        <h1>
          <span className="logo">π</span> Pi Desktop
        </h1>
        <p>找不到 pi CLI。请先安装 Pi 编码代理：</p>
        <code>npm install -g @earendil-works/pi-coding-agent</code>
        <p>
          安装完成后点击下方按钮重试。也可以设置环境变量{' '}
          <code style={{ display: 'inline', padding: '2px 6px' }}>PI_DESKTOP_PI_ENTRY</code>{' '}
          指向 pi 的 dist/cli.js 路径。
        </p>
        <div className="btn-row">
          <button className="primary" onClick={() => useStore.getState().retryConnection()}>
            我已安装，重试
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen() {
  const error = useStore((s) => s.error);
  const retryConnection = useStore((s) => s.retryConnection);
  return (
    <div className="screen error">
      <div className="card">
        <h1>连接中断</h1>
        <p>{error || 'pi 进程未响应'}</p>
        <div className="btn-row">
          <button className="primary" onClick={() => retryConnection()}>
            重新连接
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const status = useStore((s) => s.status);
  const init = useStore((s) => s.init);
  const activeName = useStore((s) => s.tabs[s.activeTabIndex]?.name);

  useEffect(() => {
    init();
  }, [init]);

  // Window title follows the active session; falls back to the plain title in
  // plain-browser dev (no Tauri window handle).
  useEffect(() => {
    if (status !== 'ready') return;
    const title = activeName && activeName !== '新会话' ? `${activeName} — Pi Desktop` : 'Pi Desktop';
    document.title = title;
    try {
      getCurrentWindow().setTitle(title);
    } catch {
      /* running outside Tauri */
    }
  }, [status, activeName]);

  // Desktop shortcuts: Ctrl+N new, Ctrl+W close, Ctrl+1..9 switch tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        useStore.getState().newSession();
      } else if (k === 'w') {
        e.preventDefault();
        useStore.getState().closeTab(useStore.getState().activeTabIndex);
      } else if (k >= '1' && k <= '9') {
        e.preventDefault();
        useStore.getState().activateTab(Number(k) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'installing') return <InstallScreen />;
  if (status === 'error') return <ErrorScreen />;
  if (status === 'connecting') return <ConnectingScreen />;

  return (
    <div className="app">
      <Sidebar />
      <TopBar />
      <ChatView />
      <InputBar />
      <SettingsModal />
    </div>
  );
}
