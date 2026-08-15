// E2E scroll regression: drives the app (fake bridge + vite mock config) in
// headless Chrome, replays a long streaming turn (thinking block open, then
// text, then collapse at message_end) and records scroll metrics throughout.
//
// Asserts the chat sticks to the bottom while content grows (streaming deltas,
// thinking-block collapse) and that a user who scrolled up is NOT yanked down.
//
//   node spike/scroll-server.mjs &          # fake bridge on :4321
//   npx vite --config spike/vite.mock.config.ts &   # app on :4322
//   node spike/e2e-scroll.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9233;

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-scroll-'));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label) => {
  console.log(`[scroll] ${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};

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
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitFor(cdp, expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.eval(expr);
    if (v) { console.log(`[scroll] ok: ${label}`); return v; }
    await sleep(200);
  }
  throw new Error('timeout waiting for ' + label);
}

// ---- boot ----------------------------------------------------------------
await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await waitFor(cdp, `!!document.querySelector('.inputbox textarea')`, 60000, 'app booted (textarea present)');
await sleep(600);

// Send a prompt through the real input (Enter submits).
await cdp.eval(`document.querySelector('.inputbox textarea').focus()`);
await cdp.send('Input.insertText', { text: '帮我改进聊天界面的自动滚动' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('[scroll] prompt sent');

// ---- sample scroll metrics throughout the stream --------------------------
const SNAP = `(() => {
  const el = document.querySelector('.chat');
  const inner = document.querySelector('.chat-inner');
  if (!el || !inner) return null;
  const details = inner.querySelector('.thinking-block');
  return {
    gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    top: Math.round(el.scrollTop),
    max: Math.round(el.scrollHeight - el.clientHeight),
    open: details ? details.open : null,
    textLen: (inner.innerText || '').length,
  };
})()`;

const samples = [];
let scrollUpT = null; // ms timestamp when we deliberately scrolled up
let wentBack = false; // we scrolled back to the bottom
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  const s = await cdp.eval(SNAP);
  if (s) {
    s.t = Date.now() - t0;
    samples.push(s);
    // Mid-stream: deliberately scroll up once to verify the stick logic, then
    // return to the bottom so the tail of the stream keeps being followed.
    if (scrollUpT === null && s.textLen > 900 && s.textLen < 1900 && s.max > 200) {
      await cdp.eval(`document.querySelector('.chat').scrollTop = 0`);
      scrollUpT = s.t;
      console.log(`[scroll] t=${s.t} scrolled up (textLen=${s.textLen})`);
    } else if (scrollUpT !== null && !wentBack && s.t > scrollUpT + 900 && s.textLen > 1400 && s.top < 5) {
      await cdp.eval(`document.querySelector('.chat').scrollTop = document.querySelector('.chat').scrollHeight`);
      wentBack = true;
      console.log(`[scroll] t=${s.t} scrolled back to bottom`);
    }
    if (s.open === false && s.textLen > 100 && s.textLen === samples[samples.length - 2]?.textLen) {
      break; // turn completed: block collapsed and text stable
    }
  }
  await sleep(90);
}

// Keep sampling briefly to capture the settled end state.
await sleep(800);
samples.push({ ...(await cdp.eval(SNAP)) , t: Date.now() - t0 });
const end = samples[samples.length - 1];
console.log(`[scroll] end: gap=${end?.gap} top=${end?.top} max=${end?.max} open=${end?.open} textLen=${end?.textLen} (${samples.length} samples)`);

// ---- analysis -------------------------------------------------------------
const finalLen = end?.textLen ?? 0;
const mid = samples.filter((s) => s.textLen > 400 && s.textLen < finalLen * 0.85);
console.log('[scroll] mid-stream gaps:', JSON.stringify(mid.map((s) => s.gap).slice(0, 80)));

// 1. Before we interfere, the view follows the growing stream (pinned).
const beforeScroll = mid.filter((s) => scrollUpT === null || s.t < scrollUpT);
check(
  beforeScroll.length > 0 && Math.max(...beforeScroll.map((s) => s.gap)) <= 5,
  `follows streaming growth (max mid-stream gap ${beforeScroll.length ? Math.max(...beforeScroll.map((s) => s.gap)) : 'n/a'}px, expect <=5)`,
);

// 2. Scrolling up mid-stream must NOT be yanked back down (stick logic).
//    (s.t > scrollUpT: the sample at scrollUpT is the pre-scroll position.)
const stuck = samples.filter((s) => scrollUpT !== null && s.t > scrollUpT && s.t < scrollUpT + 900);
console.log('[scroll] stuck samples:', JSON.stringify(stuck.map((s) => ({ t: s.t, top: s.top, max: s.max, gap: s.gap, open: s.open, len: s.textLen }))));
check(
  stuck.length > 0 && Math.max(...stuck.map((s) => s.top)) < 5,
  `scrolled-up view stays up (max scrollTop ${stuck.length ? Math.max(...stuck.map((s) => s.top)) : 'n/a'}px, expect <5)`,
);

// 3. The thinking block collapsed at the end (the reported trigger).
check(end?.open === false, 'thinking block collapsed after message_end');

// 4. After the collapse the view is pinned to the bottom — the reported bug.
check(end?.gap !== undefined && end.gap <= 5, `pinned to bottom at end (gap ${end?.gap}px, expect <=5)`);

await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'e2e-scroll.png'), Buffer.from(data, 'base64'));
  console.log('[scroll] saved spike/e2e-scroll.png');
}).catch(() => {});

cdp.close();
chrome.kill();
console.log(failures === 0 ? '[scroll] ALL PASS' : `[scroll] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
