// Session usage stats for the input-bar footer, mirroring pi CLI's footer
// (modes/interactive/components/footer.js + core/usage-totals.js).
import type { ChatMessage, Usage } from '../rpc/types';

/** Format token counts exactly like pi's footer: 999->"999", 1234->"1.2k", 12345->"12k". */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

// pi fetches the live USD→CNY rate (open.er-api.com) with a 7.2 fallback and
// a 6h TTL; a failed fetch keeps the last known rate.
const CNY_RATE_FALLBACK = 7.2;
const CNY_RATE_TTL_MS = 6 * 60 * 60 * 1000;
let cnyPerUsd = CNY_RATE_FALLBACK;
let cnyRateFetchedAt = 0;

export function getCnyPerUsd(): number {
  return cnyPerUsd;
}

/** Refresh the exchange rate at most once per 6h; failures fall back silently. */
export async function refreshCnyRate(): Promise<void> {
  if (Date.now() - cnyRateFetchedAt < CNY_RATE_TTL_MS) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const d = await res.json();
      if (d.result === 'success' && typeof d.rates?.CNY === 'number' && d.rates.CNY > 0) {
        cnyPerUsd = d.rates.CNY;
      }
    }
  } catch {
    /* offline — keep the fallback rate */
  } finally {
    cnyRateFetchedAt = Date.now();
  }
}

export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  /** Cache hit rate (0-100) of the latest assistant message, or null. */
  hitRate: number | null;
}

/** Cumulative usage across session messages, matching pi's footer totals. */
export function computeSessionUsage(messages: ChatMessage[]): SessionUsage | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let costUsd = 0;
  let hitRate: number | null = null;

  for (const m of messages) {
    const usage: Usage | undefined = m.usage;
    if (!usage) continue;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    costUsd += usage.cost?.total ?? 0;
    // Hit rate comes from the latest assistant message only (pi footer behavior).
    if (m.role === 'assistant') {
      const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      hitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : null;
    }
  }

  if (!input && !output && !cacheRead && !cacheWrite && costUsd === 0) return null;
  return { input, output, cacheRead, cacheWrite, costUsd, hitRate };
}
