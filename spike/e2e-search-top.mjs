// Regression: the session search box sits at the very top of the sidebar,
// above both the 项目 and 任务 module headers.
//
// Run: node spike/e2e-search-top.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9231;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mock, vite, chrome;
function cleanup() {
  for (const p of [mock, vite, chrome]) {
    try { p.kill(); } catch {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

mock = spawn(process.execPath, [join(process.cwd(), 'spike', 'mock-server.mjs')], {
  stdio: 'ignore',
});
vite = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'spike/vite.mock.config.ts', '--host', '127.0.0.1'], {
  stdio: 'ignore',
});

async function waitHttp(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error('HTTP endpoint not ready: ' + url);
}
await waitHttp('http://127.0.0.1:4321/sessions');
await waitHttp('http://127.0.0.1:4322/');

const userData = mkdtempSync(join(tmpdir(), 'pi-searchtop-chrome-'));
chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
  '--user-data-dir=' + userData, '--no-first-run', '--disable-gpu',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

async function getJson(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP endpoint not reachable: ' + url);
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
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

await sleep(1500);
const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
const page = targets.find((t) => t.type === 'page');
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdp.send('Page.navigate', { url: APP_URL });
for (let i = 0; i < 120; i++) {
  if (await evalJs(cdp, `!!document.querySelector('.conn-dot.ok')`)) break;
  await sleep(500);
}
await sleep(800);

const order = await evalJs(cdp, `(() => {
  const aside = document.querySelector('.sidebar');
  const classes = [...aside.children].map((el) => el.className.split(' ')[0]);
  const search = document.querySelector('.sidebar-search');
  const projHeader = document.querySelector('.sidebar-section.proj .sidebar-header');
  const tasksHeader = document.querySelector('.sidebar-section.tasks .sidebar-header');
  return {
    children: classes,
    searchIsFirst: aside.firstElementChild === search,
    searchTopBelowHeader: search.getBoundingClientRect().top < projHeader.getBoundingClientRect().top,
    searchAboveTasks: search.getBoundingClientRect().top < tasksHeader.getBoundingClientRect().top,
    searchVisible: getComputedStyle(search).display !== 'none',
  };
})()`);
console.log('sidebar children:', JSON.stringify(order.children));
console.log('search position:', JSON.stringify(order));
if (!order.searchIsFirst || !order.searchTopBelowHeader || !order.searchAboveTasks || !order.searchVisible) {
  throw new Error('search box is not at the very top of the sidebar');
}

// The search still filters the session tree.
await evalJs(cdp, `(() => {
  const inp = document.querySelector('.sidebar-search');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, 'zzz-no-match-zzz');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(300);
const empty = await evalJs(cdp, `document.querySelector('.session-tree .sidebar-empty')?.textContent ?? null`);
console.log('filtered empty state:', empty);
if (!empty || !empty.includes('没有匹配')) throw new Error('search filtering broken, empty=' + empty);

console.log('E2E SEARCH-TOP PASSED');
await cdp.send('Browser.close');
process.exit(0);
