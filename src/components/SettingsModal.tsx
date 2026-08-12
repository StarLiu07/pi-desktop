import { useStore } from '../store/useStore';
import { version } from '../../package.json';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const retryConnection = useStore((s) => s.retryConnection);
  const logs = useStore((s) => s.logs);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <div className="field">
          <label>版本</label>
          <div className="value">
            Pi Desktop {version}（pi CLI 通过 RPC 协议连接，协议校准于 pi 0.83.0）
          </div>
        </div>
        <div className="field">
          <label>会话目录</label>
          <div className="value">%APPDATA%\pi-desktop\sessions（与 pi CLI 的会话隔离）</div>
        </div>
        <div className="field">
          <label>提供商与模型</label>
          <div className="value">在底部状态栏切换；API Key 沿用 pi 的现有配置（环境变量 / pi config）</div>
        </div>
        <div className="field">
          <label>快捷键</label>
          <div className="value">Ctrl+N 新建会话 · Ctrl+W 关闭 · Ctrl+1…9 切换标签</div>
        </div>
        <div className="field">
          <label>pi 日志（stderr）</label>
          {logs.length === 0 ? (
            <div className="value">暂无日志</div>
          ) : (
            <pre className="log-view">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </pre>
          )}
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
