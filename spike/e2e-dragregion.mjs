// Drag-region verification: loads the real app (mock bridge) in headless
// Chrome, injects the *actual* Tauri 2.11.5 drag.js script, and drives real
// CDP mouse events against real coordinates. Asserts which topbar areas start
// a window drag and which stay interactive (tabs/buttons).
//
// Regression: tab-strip was marked data-tauri-drag-region="false" as a whole,
// so the entire middle of the title bar was drag-blocked and the window could
// not be dragged (only the ~70px logo). The fix moved the flag onto each .tab.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9224;
const TAURI_DRAG_JS =
  'C:/Users/Sheldon/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/src/window/scripts/drag.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;

function check(label, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

async function getJson(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('endpoint not reachable: ' + url);
}

async function newTab(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

let seq = 0;
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
    return r.result?.value;
  }
  async mousePress(x, y, clickCount = 1) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  }
  close() { try { this.ws.close(); } catch {} }
}

// --- servers ---
const mock = spawn(process.execPath, [join(ROOT, 'spike', 'mock-server.mjs')], { cwd: ROOT, stdio: 'ignore' });
const vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'spike/vite.mock.config.ts', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await getJson('http://127.0.0.1:4321/installed');
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(APP_URL); if (r.ok) break; } catch {}
  await sleep(250);
}

// --- chrome ---
const userData = mkdtempSync(join(tmpdir(), 'pi-drag-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--remote-allow-origins=*',
  '--user-data-dir=' + userData,
  '--no-first-run',
  '--disable-gpu',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' });

await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

async function waitFor(expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.eval(expr);
    if (v) { console.log(`[drag] ok: ${label}`); return v; }
    await sleep(1000);
  }
  throw new Error('timeout waiting for ' + label);
}

// App shell must render (mock bridge + real pi process).
await waitFor(`document.querySelectorAll('.tab').length >= 1`, 90000, 'topbar tabs rendered');
console.log('[drag] app state:', await cdp.eval(`document.querySelector('.conn-dot')?.className`));

// Install a recording Tauri IPC stub, then the REAL tauri drag.js script.
await cdp.eval(`
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd) => { (window.__dragCalls = window.__dragCalls || []).push(cmd); return Promise.resolve(); },
  };
  true`);
const dragJs = readFileSync(TAURI_DRAG_JS, 'utf8').replace('__TEMPLATE_os_name__', "'windows'");
await cdp.eval(dragJs);
console.log('[drag] real tauri drag.js injected (2.11.5)');

// Compute real click targets.
const points = await cdp.eval(`(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, label: sel }; };
  // empty space inside .tab-strip: first x (at strip midY) where the topmost
  // element IS the strip itself (i.e. not covered by a .tab or button)
  const strip = document.querySelector('.tab-strip');
  const sb = strip.getBoundingClientRect();
  const y = sb.top + sb.height / 2;
  let empty = null;
  for (let x = sb.left + 4; x < sb.right - 4; x += 2) {
    const el = document.elementFromPoint(x, y);
    if (el === strip || strip.contains(el) && el === strip) { empty = { x, y, label: 'empty .tab-strip' }; break; }
    if (el && el.closest && el.closest('.tab-strip') && !el.closest('.tab, .tab-btns')) { empty = { x, y, label: 'empty .tab-strip' }; break; }
  }
  return { logo: r('.topbar-logo'), tab1: r('.tab'), wcMin: r('.wc-btn'), strip: empty };
})()`);
console.log('[drag] targets:', JSON.stringify(points, null, 1));

// --- 1. logo must drag ---
await cdp.eval(`window.__dragCalls = []`);
await cdp.mousePress(points.logo.x, points.logo.y);
let calls = await cdp.eval(`(window.__dragCalls || []).join(',')`);
check('logo area starts drag', calls === 'plugin:window|start_dragging', calls || '(none)');

// --- 2. empty tab-strip space must drag ---
if (points.strip) {
  await cdp.eval(`window.__dragCalls = []`);
  await cdp.mousePress(points.strip.x, points.strip.y);
  calls = await cdp.eval(`(window.__dragCalls || []).join(',')`);
  check('empty tab-strip space starts drag', calls === 'plugin:window|start_dragging', calls || '(none)');
} else {
  check('empty tab-strip space exists (layout)', false, 'strip fully covered — nothing to drag');
}

// --- 3. double-click on empty strip maximizes (windows) ---
if (points.strip) {
  await cdp.eval(`window.__dragCalls = []`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.strip.x, y: points.strip.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.strip.x, y: points.strip.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.strip.x, y: points.strip.y, button: 'left', clickCount: 2 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.strip.x, y: points.strip.y, button: 'left', clickCount: 2 });
  calls = await cdp.eval(`(window.__dragCalls || []).join(',')`);
  // First press starts a drag (as in a real click), second press must route to
  // the maximize command. In headless there is no OS caption loop to swallow
  // the first command, so assert the double-click maximize path was hit.
  check('double-click strip toggles maximize', calls.includes('plugin:window|internal_toggle_maximize'), calls || '(none)');
}

// --- 4. tabs / buttons must NOT drag ---
const nonDrag = [
  ['tab', points.tab1],
  ['window minimize button', points.wcMin],
];
for (const [label, p] of nonDrag) {
  await cdp.eval(`window.__dragCalls = []`);
  await cdp.mousePress(p.x, p.y);
  calls = await cdp.eval(`(window.__dragCalls || []).join(',')`);
  check(`${label} does NOT drag`, calls === '', calls || '(none)');
}

// --- 5. clicks still work: create a 2nd tab, then click the first one ---
const plus = await cdp.eval(`(() => { const b = document.querySelector('.tab-btns button[title="新建会话"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await cdp.mousePress(plus.x, plus.y);
await waitFor(`document.querySelectorAll('.tab').length >= 2`, 15000, 'second tab created');
const tab2 = await cdp.eval(`(() => { const b = document.querySelectorAll('.tab')[1].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
await cdp.mousePress(tab2.x, tab2.y);
const active = await cdp.eval(`document.querySelectorAll('.tab')[1]?.classList.contains('active')`);
check('clicking a tab still activates it', active === true, `second tab active=${active}`);

// --- screenshot for the record ---
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(ROOT, 'spike', 'dragregion.png'), Buffer.from(data, 'base64'));
console.log('[drag] saved spike/dragregion.png');

console.log('\n===== drag-region results =====');
for (const r of results) console.log(r);
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);

cdp.close();
chrome.kill();
mock.kill();
vite.kill();
process.exit(failures === 0 ? 0 : 1);