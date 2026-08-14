// E2E: tab/sidebar labels must never show timestamped file names
// (e.g. `2026-08-14T02-36-03-072Z_<uuid>.jsonl`) — Z-Code/OpenCode style:
// real name → first user message → neutral placeholder.
// Seeds three sessions: named, unnamed-with-message, empty. Drives the real
// app (mock bridge + real pi) in headless Chrome and asserts tab labels.
//
// Run: node spike/mock-server.mjs & npx vite --config spike/vite.mock.config.ts --host 127.0.0.1 &
//      node spike/e2e-tablabels.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9226;

// --- seed a session dir with the three label cases -------------------------
const fx = mkdtempSync(join(tmpdir(), 'pi-labels-fx-'));
for (const f of readdirSync(join(process.cwd(), 'spike', 'fixtures'))) {
  if (f.endsWith('.jsonl')) copyFileSync(join(process.cwd(), 'spike', 'fixtures', f), join(fx, f));
}
writeFileSync(join(fx, 'unnamed-with-msg.jsonl'), [
  '{"type":"session","version":3,"id":"uuuu0001","timestamp":"2026-08-04T09:00:00.000Z","cwd":"C:\\\\Users\\\\Sheldon"}',
  '{"type":"message","id":"uuuu0002","parentId":"uuuu0001","timestamp":"2026-08-04T09:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"帮我排查 WebView2 黑帧问题"}]}}',
].join('\n'));
writeFileSync(join(fx, 'empty-session.jsonl'), '{"type":"session","version":3,"id":"eeee0001","timestamp":"2026-08-05T09:00:00.000Z","cwd":"C:\\\\Users\\\\Sheldon"}\n');
console.log('[labels] seeded fixtures:', readdirSync(fx).join(', '));

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
const userData = mkdtempSync(join(tmpdir(), 'pi-labels-chrome-'));
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
    if (v) { console.log(`[labels] ok: ${label}`); return v; }
    await sleep(1500);
  }
  throw new Error('timeout waiting for ' + label);
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`[labels] ${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
};

try {
  await getJson(`http://127.0.0.1:${PORT}/json/version`);
  const tab = await newTab(APP_URL);
  const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // App boots against real pi.
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'app connected');
  await sleep(1500); // let refreshSessions settle

  // 1. The startup tab (pi's fresh session) must show the neutral placeholder,
  //    NOT the timestamped file name the old code fell back to.
  const tab0 = await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`);
  check('startup tab label', tab0, '新会话');

  // 2. No `.jsonl` file name may leak into any visible label.
  const leaks = await cdp.eval(
    `[...document.querySelectorAll('.tab-name, .session-item .name')]
       .map((el) => el.textContent).filter((t) => t.includes('.jsonl'))`);
  check('no timestamp file names in labels', JSON.stringify(leaks), '[]');

  // 3. Sidebar: empty session shows the neutral label, not its file name.
  const emptySidebar = await cdp.eval(
    `[...document.querySelectorAll('.session-item .name')].find((el) => el.textContent === '空会话')?.textContent ?? null`);
  check('sidebar empty-session label', emptySidebar, '空会话');

  // 4. Open the unnamed session with a message -> tab label = first message.
  await cdp.eval(
    `[...document.querySelectorAll('.session-item')].find((el) => el.querySelector('.name')?.textContent === '帮我排查 WebView2 黑帧问题')?.click()`);
  await waitFor(cdp, `document.querySelector('.tab.active .tab-name')?.textContent === '帮我排查 WebView2 黑帧问题'`, 30000, 'tab label = first message preview');
  const t1 = await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`);
  check('unnamed session tab label', t1, '帮我排查 WebView2 黑帧问题');

  // 5. Open the named session -> tab label = real name.
  await cdp.eval(
    `[...document.querySelectorAll('.session-item')].find((el) => el.querySelector('.name')?.textContent === '安装环境踩坑记录')?.click()`);
  await waitFor(cdp, `document.querySelector('.tab.active .tab-name')?.textContent === '安装环境踩坑记录'`, 30000, 'tab label = session name');
  const t2 = await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`);
  check('named session tab label', t2, '安装环境踩坑记录');

  // 6. Open the empty session -> tab label = neutral placeholder.
  await cdp.eval(
    `[...document.querySelectorAll('.session-item')].find((el) => el.querySelector('.name')?.textContent === '空会话')?.click()`);
  await waitFor(cdp, `document.querySelector('.tab.active .tab-name')?.textContent === '新会话'`, 30000, 'tab label = neutral placeholder');
  const t3 = await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`);
  check('empty session tab label', t3, '新会话');

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.cwd(), 'spike', 'e2e-tablabels.png'), Buffer.from(data, 'base64'));
  console.log('[labels] saved spike/e2e-tablabels.png');

  cdp.close();
} finally {
  chrome.kill();
  mock.kill();
  vite.kill();
}

console.log(failed === 0 ? '[labels] ALL PASS' : `[labels] ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
