// Bottom status bar (zcode-style footer): session usage + connection state.
// Mono, one-line, 28px. Model/thinking switching lives in the input bar —
// this bar is telemetry only.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  computeSessionUsage,
  formatTokens,
  getCnyPerUsd,
  refreshCnyRate,
} from '../lib/usage';

export function StatusBar() {
  const status = useStore((s) => s.status);
  const messages = useStore((s) => s.tabs[s.activeTabIndex]?.messages);
  // Bumped when the USD→CNY rate finishes loading so the cost line refreshes.
  const [, setRateTick] = useState(0);

  // Warm the USD→CNY rate once; cost shows in ¥ like pi's footer.
  useEffect(() => {
    refreshCnyRate().then(() => setRateTick((t) => t + 1));
  }, []);

  // Session totals for the footer, mirroring pi CLI's footer stats.
  const usage = useMemo(() => computeSessionUsage(messages ?? []), [messages]);

  return (
    <div className="statusbar">
      <span className="sb-usage">
        {usage && (
          <>
            {usage.input > 0 && <span>↑{formatTokens(usage.input)}</span>}
            {usage.output > 0 && <span>↓{formatTokens(usage.output)}</span>}
            {usage.cacheRead > 0 && <span>R{formatTokens(usage.cacheRead)}</span>}
            {usage.cacheWrite > 0 && <span>W{formatTokens(usage.cacheWrite)}</span>}
            {usage.hitRate !== null && (usage.cacheRead > 0 || usage.cacheWrite > 0) && (
              <span>CH{usage.hitRate.toFixed(1)}%</span>
            )}
            {usage.costUsd > 0 && <span>¥{(usage.costUsd * getCnyPerUsd()).toFixed(2)}</span>}
          </>
        )}
      </span>
      <div className="sb-right" title={status === 'ready' ? 'pi 进程已连接' : 'pi 进程连接状态'}>
        <span
          className={`conn-dot${status === 'ready' ? ' ok' : status === 'error' ? ' err' : ''}`}
        />
        <span>
          {status === 'ready' ? '已连接' : status === 'connecting' ? '连接中…' : '连接中断'}
        </span>
      </div>
    </div>
  );
}
