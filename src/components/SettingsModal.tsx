import { useStore } from '../store/useStore';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const retryConnection = useStore((s) => s.retryConnection);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <div className="field">
          <label>会话目录</label>
          <div className="value">%APPDATA%\pi-desktop\sessions（与 pi CLI 的会话隔离）</div>
        </div>
        <div className="field">
          <label>pi CLI</label>
          <div className="value">@earendil-works/pi-coding-agent（npm 全局包，通过 RPC 协议连接）</div>
        </div>
        <div className="field">
          <label>提供商与模型</label>
          <div className="value">在底部状态栏切换；API Key 沿用 pi 的现有配置（环境变量 / pi config）</div>
        </div>
        <div className="actions">
          <button onClick={() => retryConnection()}>重连 pi 进程</button>
          <button className="primary" onClick={() => setSettingsOpen(false)}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
