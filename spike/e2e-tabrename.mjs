// E2E: double-click tab rename must be an inline editor, not a native
// window.prompt(). Drives the real app (mock bridge + real pi) in headless
// Chrome: dblclick → styled input appears in the tab (focused, selected),
// Enter commits through pi (tab label updates via session_info_changed),
// Escape cancels. Screenshots both states.
//
// Run: node spike/e2e-tabrename.mjs  (starts mock + vite itself)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9227;

// --- start mock bridge + vite ----------------------------------------------
const mock = spawn(process.execPath, [join(process.cwd(), 'spike', 'mock-server.mjs')], {
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
const userData = mkdtempSync(join(tmpdir(), 'pi-rename-chrome-'));
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
    if (v) { console.log(`[rename] ok: ${label}`); return v; }
    await sleep(1200);
  }
  throw new Error('timeout waiting for ' + label);
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`[rename] ${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
};

// Real double click at the center of the active tab.
async function dblclickActiveTab(cdp) {
  const rect = await cdp.eval(`(() => {
    const el = document.querySelector('.tab.active');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!rect) throw new Error('no active tab');
  for (const clickCount of [1, 2]) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount });
  }
}
async function pressKey(cdp, key, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = join(process.cwd(), 'spike', name);
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`[rename] saved ${out}`);
}

try {
  await getJson(`http://127.0.0.1:${PORT}/json/version`);
  const tab = await newTab(APP_URL);
  const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // App boots against real pi.
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'app connected');
  await sleep(1200);
  check('startup tab label', await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`), '新会话');

  // 1. Double click → inline input appears (NOT a native prompt).
  await dblclickActiveTab(cdp);
  await waitFor(cdp, `!!document.querySelector('.tab.active .tab-rename-input')`, 15000, 'inline rename input appears');
  const editing = await cdp.eval(`(() => {
    const inp = document.querySelector('.tab-rename-input');
    const tab = document.querySelector('.tab.active');
    if (!inp || !tab) return null;
    const cs = getComputedStyle(inp);
    return {
      value: inp.value,
      focused: document.activeElement === inp,
      selAll: inp.selectionStart === 0 && inp.selectionEnd === inp.value.length,
      closeHidden: !tab.querySelector('.tab-close'), // not rendered while editing
      radius: cs.borderRadius,
      font: cs.fontSize,
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      promptBlocked: typeof window.prompt === 'function' && !document.querySelector('.tab.active')?.querySelector('input') ? 'native' : 'inline',
    };
  })()`);
  check('input value = current name', editing?.value, '新会话');
  check('input focused', editing?.focused, true);
  check('text pre-selected', editing?.selAll, true);
  check('close button hidden while editing', editing?.closeHidden, true);
  check('input styled (dark bg)', editing?.bg, 'rgb(30, 30, 30)'); // --bg-element
  check('input rounded', editing?.radius, '5px');
  await screenshot(cdp, 'rename-inline-edit.png');

  // Focus ring must use the accent color.
  // Focus ring must use the accent color. The border transitions from
  // --border-strong over 0.1s, so let it settle before reading the style.
  await sleep(250);
  const focusStyle = await cdp.eval(`(() => {
    const inp = document.querySelector('.tab-rename-input');
    const cs = getComputedStyle(inp);
    return { border: cs.borderTopColor, shadow: cs.boxShadow };
  })()`);
  check('focused border = accent peach', focusStyle?.border, 'rgb(250, 178, 131)');
  check('focused glow = accent soft', (focusStyle?.shadow ?? '').includes('rgba(250, 178, 131'), true);

  // 2. Type a new name (selection is replaced) and press Enter → commits.
  await cdp.send('Input.insertText', { text: '端到端重命名' });
  await pressKey(cdp, 'Enter', 'Enter', 13);
  await waitFor(cdp, `!document.querySelector('.tab-rename-input')`, 10000, 'input dismissed on Enter');
  check('input gone after Enter', await cdp.eval(`!document.querySelector('.tab-rename-input')`), true);
  // Tab label must reflect the rename once pi confirms (session_info_changed).
  await waitFor(cdp, `document.querySelector('.tab.active .tab-name')?.textContent === '端到端重命名'`, 30000, 'tab label updated via pi');
  check('tab renamed via pi', await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`), '端到端重命名');
  await screenshot(cdp, 'rename-committed.png');

  // 3. Escape cancels without renaming.
  await dblclickActiveTab(cdp);
  await waitFor(cdp, `!!document.querySelector('.tab-rename-input')`, 10000, 'second edit starts');
  await cdp.send('Input.insertText', { text: '改坏了' });
  await pressKey(cdp, 'Escape', 'Escape', 27);
  await waitFor(cdp, `!document.querySelector('.tab-rename-input')`, 10000, 'input dismissed on Escape');
  const afterCancel = await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`);
  check('Escape keeps the name', afterCancel, '端到端重命名');

  // 4. Empty name = cancel (no rename, input just closes).
  await dblclickActiveTab(cdp);
  await waitFor(cdp, `!!document.querySelector('.tab-rename-input')`, 10000, 'third edit starts');
  // Select all (Ctrl+A) then delete → empty draft.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  const emptyDraft = await cdp.eval(`document.querySelector('.tab-rename-input')?.value`);
  check('draft cleared', emptyDraft, '');
  await pressKey(cdp, 'Enter', 'Enter', 13);
  await waitFor(cdp, `!document.querySelector('.tab-rename-input')`, 10000, 'input dismissed on empty Enter');
  await sleep(1500);
  check('empty name keeps the name', await cdp.eval(`document.querySelector('.tab.active .tab-name')?.textContent`), '端到端重命名');

  cdp.close();
} finally {
  chrome.kill();
  mock.kill();
  vite.kill();
}

console.log(failed === 0 ? '[rename] ALL PASS' : `[rename] ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
