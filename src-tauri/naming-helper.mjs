#!/usr/bin/env node
// Session naming helper for Pi Desktop.
// Spawned by src-tauri/src/pi.rs (name_sessions) as:
//   node naming-helper.mjs <pi-entry>      (pi-entry = <pkg>/dist/cli.js)
// Reads one JSON object from stdin:  { "items": [ { "path", "text" }, ... ] }
// Writes one JSON object to stdout: { "results": [ { "path", "title" } | { "path", "error" } ] }
//
// Reuses pi's own ModelRuntime so provider/auth resolution (models.json,
// auth.json, settings.json default model, env vars) is exactly what the pi
// CLI uses — no config re-implementation.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const piEntry = process.argv[2];
if (!piEntry) {
  console.error('naming-helper: missing pi entry path');
  process.exit(1);
}

const pkgRoot = dirname(dirname(piEntry));
const { ModelRuntime } = await import(pathToFileURL(join(pkgRoot, 'dist', 'index.js')).href);

const SYSTEM_PROMPT =
  '你是一个会话命名助手。根据用户的第一条消息判断这段对话的主题，' +
  '生成一个简洁的中文标题。要求：15 个汉字以内；不要引号、句号、感叹号；' +
  '不要「标题：」之类的任何前缀；直接输出标题本身。';

function resolveDefaultModel(runtime, available) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'));
    const { defaultProvider, defaultModel } = settings;
    const found =
      (defaultProvider && defaultModel && runtime.getModel(defaultProvider, defaultModel)) ||
      available.find((m) => m.id === defaultModel && m.provider === defaultProvider);
    if (found) return found;
  } catch {
    // no settings.json — fall through to the first available model
  }
  return available[0];
}

async function nameOne(runtime, model, item) {
  const res = await runtime.completeSimple(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: item.text }] }],
    },
    { maxTokens: 64, signal: AbortSignal.timeout(30_000) }
  );
  if (res.stopReason === 'error') {
    throw new Error('模型调用失败');
  }
  const title = (res.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .replace(/["“”「」'']/g, '')
    .trim();
  if (!title) {
    throw new Error('模型返回空标题');
  }
  return title;
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const items = Array.isArray(input?.items) ? input.items : [];
  const runtime = await ModelRuntime.create();
  const model = resolveDefaultModel(runtime, await runtime.getAvailable());

  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        const title = await nameOne(runtime, model, item);
        results.push({ path: item.path, title });
      } catch (e) {
        results.push({ path: item.path, error: String(e?.message ?? e) });
      }
    }
  }
  // Small concurrency: fast enough for a batch, gentle on rate limits.
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  process.stdout.write(JSON.stringify({ results }));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ results: [], fatal: String(e?.message ?? e) }));
  process.exit(1);
});
