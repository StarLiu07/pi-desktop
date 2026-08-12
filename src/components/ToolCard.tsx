import { useState } from 'react';
import type { ToolExecState } from '../store/useStore';

const STATUS_LABEL: Record<ToolExecState['status'], string> = {
  running: '运行中',
  done: '完成',
  error: '错误',
};

export function ToolCard({ tool }: { tool: ToolExecState }) {
  const [open, setOpen] = useState(tool.status === 'error');
  const argsStr = JSON.stringify(tool.args);
  // Huge argument payloads (file contents, bash scripts) would blow up the
  // card — truncate the visible text, keep the full JSON in the tooltip.
  const shortArgs = argsStr.length > 240 ? argsStr.slice(0, 240) + '…' : argsStr;
  const showBody = open && (tool.result.length > 0 || tool.status === 'error');

  return (
    <div className={`tool-card ${tool.status}`}>
      <div className="tool-card-header" onClick={() => setOpen(!open)} title={argsStr}>
        <span className="tool-icon" />
        <span className="tool-name">{tool.name}</span>
        <span className="tool-args">{shortArgs}</span>
        <span className="tool-status">{STATUS_LABEL[tool.status]}</span>
      </div>
      {showBody && (
        <div className="tool-card-body">
          {tool.result || (tool.status === 'error' ? '（工具执行失败，无输出）' : '（无输出）')}
        </div>
      )}
    </div>
  );
}
