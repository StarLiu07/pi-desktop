// E2E: sidebar project groups fold sessions past GROUP_PREVIEW (5) behind a
// 「显示更多 (N)」/「收起」 button — Z-Code style, so a project with dozens of
// conversations doesn't flood the sidebar. Seeds one project with 8 sessions
// (6th+ hidden) and one with 3 (no button), drives the real app (mock bridge
// + real pi) in headless Chrome, and asserts: preview count, toggle, reload
// persistence (localStorage), and auto-expand when the active session lands
// in the folded region.
//
// Run: node spike/mock-server.mjs & npx vite --config spike/vite.mock.config.ts --host 127.0.0.1 &
//      node spike/e2e-sessionmore.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9227;

// --- seed sessions: 8 in project A (preview folds the oldest 3), 3 in B -----
const fx = mkdtempSync(join(tmpdir(), 'pi-more-fx-'));
// One session per file: header (uuid id, cwd, timestamp) → session_info (name)
// → user message, with the parentId chain the real pi expects.
const seed = (file, id, ts, cwd, name) => {
  const lines = [
    { type: 'session', version: 3, id, timestamp: ts, cwd },
    { type: 'session_info', id: `${id}i`, parentId: id, timestamp: ts, name },
    { type: 'message', id: `${id}m`, parentId: `${id}i`, timestamp: ts, message: { role: 'user', content: [{ type: 'text', text: `内容 ${name}` }] } },
  ];
  writeFileSync(join(fx, file), lines.map((v) => JSON.stringify(v)).join('\n') + '\n');
};
// cwds must exist on disk — pi's switch_session rejects sessions whose stored
// working directory doesn't exist (rpc-probe-sessionid.mjs).
const day = (d) => `2026-08-${String(d).padStart(2, '0')}T08:00:00.000Z`;
for (let i = 1; i <= 8; i++) seed(`a${i}.jsonl`, `aaaa000${i}`, day(i), 'C:\\Users\\Sheldon', `会话A${i}`);
for (let i = 1; i <= 3; i++) seed(`b${i}.jsonl`, `bbbb000${i}`, `2026-07-2${i}T08:00:00.000Z`, 'D:\\pi-desktop', `会话B${i}`);
console.log('[more] seeded fixtures:', readdirSync(fx).join(', '));

// --- start mock bridge + vite ----------------------------------------------
const mock = spawn(process.execPath, [join(process.cwd(), 'spike', 'mock-server.mjs')], {
  env: { ...process.env, MOCK_FIXTURES_DIR: fx },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mock.stdout.on('data', (d) => process.stdout.write('[mock] ' + d));
mock.stderr.on('data', (d) => process.stderr.write('[mock-err] ' + d));
const vite = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'spike/vite.mock.config.ts', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, label) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error('HTTP endpoint not ready: ' + label);
}

await waitHttp('http://127.0.0.1:4321/sessions', 'mock bridge');
await waitHttp('http://127.0.0.1:4322/', 'vite');

// --- headless chrome + CDP --------------------------------------------------
const userData = mkdtempSync(join(tmpdir(), 'pi-more-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
  '--user-data-dir=' + userData, '--no-first-run', '--disable-gpu',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

async function getJson(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('CDP unreachable: ' + url);
}
async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}
class Cdp {
  constructor(ws) { this.ws = ws; this.pending = new Map(); this.id = 0; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function waitFor(cdp, expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.eval(expr);
    if (v) { console.log(`[more] ok: ${label}`); return v; }
    await sleep(1500);
  }
  throw new Error('timeout waiting for ' + label);
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`[more] ${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
};

// Direct RPC probe: subscribe to the mock's /events stream and match a
// response by id — independent of the app's own connection.
async function probeRpc(cmd, data) {
  const ac = new AbortController();
  const res = await fetch('http://127.0.0.1:4321/events', { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const id = 'probe-' + Math.random().toString(36).slice(2);
  fetch('http://127.0.0.1:4321/rpc', { method: 'POST', body: JSON.stringify({ id, type: cmd, ...data }) }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let m;
        try { m = JSON.parse(line.slice(6)); } catch { continue; }
        if (m.id === id) { ac.abort(); return m; }
      }
    }
  }
  ac.abort();
  return null;
}

// DOM helpers evaluated in the page.
const groupNames = (i) => `[...document.querySelectorAll('.session-group')[${i}].querySelectorAll('.session-item.grouped .name')].map((el) => el.textContent)`;
const groupCount = (i) => `document.querySelectorAll('.session-group')[${i}]?.querySelectorAll('.session-item.grouped').length ?? 0`;
const moreText = () => `document.querySelector('.session-group-more')?.textContent ?? null`;
const clickMore = () => `document.querySelector('.session-group-more')?.click()`;

try {
  await getJson(`http://127.0.0.1:${PORT}/json/version`);
  const tab = await newTab(APP_URL);
  const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // App boots against real pi.
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'app connected');
  await waitFor(cdp, `document.querySelector('.session-group-more')?.textContent === '显示更多 (3)'`, 30000, 'more button rendered');

  // 1. Project A (first group, newest) shows only the 5 newest sessions;
  //    the oldest 3 are folded and group B has no button.
  check('group count', await cdp.eval(`document.querySelectorAll('.session-group').length`), 2);
  check('group A preview names', JSON.stringify(await cdp.eval(groupNames(0))),
    JSON.stringify(['会话A8', '会话A7', '会话A6', '会话A5', '会话A4']));
  check('group A item count', await cdp.eval(groupCount(0)), 5);
  check('folded session hidden', await cdp.eval(`[...document.querySelectorAll('.session-group')[0].querySelectorAll('.session-item.grouped .name')].some((el) => el.textContent === '会话A3')`), false);
  check('group B item count (all shown)', await cdp.eval(groupCount(1)), 3);
  check('group B has no more button', await cdp.eval(`[...document.querySelectorAll('.session-group')[1].querySelectorAll('.session-group-more')].length`), 0);

  // 2. 「显示更多」 expands the group; the button flips to 「收起」.
  await cdp.eval(clickMore());
  await waitFor(cdp, `document.querySelector('.session-group-more')?.textContent === '收起'`, 15000, 'button flipped to 收起');
  check('expanded item count', await cdp.eval(groupCount(0)), 8);
  check('expanded names', JSON.stringify(await cdp.eval(groupNames(0))),
    JSON.stringify(['会话A8', '会话A7', '会话A6', '会话A5', '会话A4', '会话A3', '会话A2', '会话A1']));

  // 3. Reload: the expanded state persists (localStorage).
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'reconnected after reload');
  await waitFor(cdp, `${groupCount(0)} === 8`, 30000, 'expansion persisted across reload');
  check('persisted button text', await cdp.eval(moreText()), '收起');

  // 4. 「收起」 folds it back to the preview.
  await cdp.eval(clickMore());
  await waitFor(cdp, `${groupCount(0)} === 5`, 15000, 'collapsed back to preview');
  check('collapsed button text', await cdp.eval(moreText()), '显示更多 (3)');

  // 5. Opening a session from the folded region: group auto-expands and the
  //    toggle disappears (collapsing would hide the active session).
  await cdp.eval(clickMore());
  await waitFor(cdp, `[...document.querySelectorAll('.session-item.grouped .name')].some((el) => el.textContent === '会话A3')`, 15000, '会话A3 visible after expand');
  await cdp.eval(`[...document.querySelectorAll('.session-item.grouped')].find((el) => el.querySelector('.name')?.textContent === '会话A3')?.click()`);
  await waitFor(cdp, `document.querySelector('.tab.active .tab-name')?.textContent === '会话A3'`, 30000, 'tab switched to 会话A3');
  await sleep(2000); // let switch_session + get_state settle on pi
  console.log('[more] debug pi sessionId after click:', (await probeRpc('get_state'))?.data?.sessionId);
  check('auto-expanded count', await cdp.eval(groupCount(0)), 8);
  check('no toggle while active is in fold', await cdp.eval(`[...document.querySelectorAll('.session-group')[0].querySelectorAll('.session-group-more')].length`), 0);

  // 6. Reload: the restored active session keeps the group auto-expanded.
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'reconnected after reload 2');
  await waitFor(cdp, `${groupCount(0)} === 8`, 30000, 'auto-expand persisted after reload');
  console.log('[more] debug pi sessionId after reload:', (await probeRpc('get_state'))?.data?.sessionId);
  console.log('[more] debug active item:', await cdp.eval(`document.querySelector('.session-item.grouped.active .name')?.textContent ?? null`));
  console.log('[more] debug tab name:', await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent ?? null`));
  check('no toggle after reload', await cdp.eval(`[...document.querySelectorAll('.session-group')[0].querySelectorAll('.session-group-more')].length`), 0);

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.cwd(), 'spike', 'e2e-sessionmore.png'), Buffer.from(data, 'base64'));
  console.log('[more] saved spike/e2e-sessionmore.png');

  cdp.close();
} finally {
  chrome.kill();
  mock.kill();
  vite.kill();
}

console.log(failed === 0 ? '[more] ALL PASS' : `[more] ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
