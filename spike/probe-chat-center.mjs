// Probe: verify the chat message column (.chat-inner) is horizontally centered
// in the window — AI output appears in the middle by default.
//
//   node spike/mock-server.mjs &          # or scroll-server.mjs
//   npx vite --config spike/vite.mock.config.ts &
//   node spike/probe-chat-center.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9237;
const W = 1600, H = 900;

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-center-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--remote-allow-origins=*',
  '--user-data-dir=' + userData,
  '--no-first-run',
  '--disable-gpu',
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label, extra = '') => {
  console.log(`[center] ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

async function getJson(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
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
    if (v) { console.log(`[center] ok: ${label}`); return v; }
    await sleep(200);
  }
  // Diagnostic dump on timeout.
  try {
    const diag = await cdp.eval(`({
      textarea: !!document.querySelector('.inputbox textarea'),
      chatInner: !!document.querySelector('.chat-inner'),
      userRows: document.querySelectorAll('.message-row.user').length,
      pending: !!document.querySelector('.message-row.user.pending'),
      statusEl: document.querySelector('[class*=status]')?.className || null,
      tabCount: document.querySelectorAll('.tab').length,
      url: location.href,
    })`);
    console.log('[center] TIMEOUT diag:', JSON.stringify(diag));
  } catch {}
  throw new Error('timeout waiting for ' + label);
}

await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await waitFor(cdp, `!!document.querySelector('.inputbox textarea')`, 60000, 'app booted');

// Send a prompt through the real input so a message column appears.
await cdp.eval(`document.querySelector('.inputbox textarea').focus()`);
await cdp.send('Input.insertText', { text: '居中验证' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

await waitFor(cdp, `!!document.querySelector('.chat-inner')`, 60000, 'chat-inner rendered');
await waitFor(cdp, `!!document.querySelector('.chat-inner .bubble')`, 60000, 'assistant bubble rendered');
await sleep(500); // let the stream settle

// Measure: chat-inner must be horizontally centered inside .chat.
const m = await cdp.eval(`(() => {
  const chat = document.querySelector('.chat');
  const inner = document.querySelector('.chat-inner');
  const ub = document.querySelector('.message-row.user .user-text');
  if (!chat || !inner) return null;
  const c = chat.getBoundingClientRect();
  const i = inner.getBoundingClientRect();
  const b = ub ? ub.getBoundingClientRect() : null;
  const cs = ub ? getComputedStyle(ub) : null;
  return {
    chatLeft: c.left, chatWidth: c.width, chatClientW: chat.clientWidth,
    innerLeft: i.left, innerWidth: i.width,
    viewportW: window.innerWidth,
    offset: Math.round(i.left - (c.left + (chat.clientWidth - i.width) / 2)),
    hasBubble: !!inner.querySelector('.bubble'),
    textLen: inner.innerText.length,
    userRight: b ? Math.round(b.right) : null,
    innerRight: Math.round(i.right),
    userGap: b ? Math.round(i.right - b.right) : null,
    userBg: cs ? cs.backgroundColor : null,
    userBorder: cs ? cs.borderTopWidth : null,
    userRadius: cs ? cs.borderTopLeftRadius : null,
  };
})()`);
console.log('[center] metrics:', JSON.stringify(m));

if (m) {
  check(m.innerWidth > 0 && m.innerWidth <= 760, `column width sane (${m.innerWidth}px, expect 0<w<=760)`);
  check(m.offset >= -1 && m.offset <= 1, `column horizontally centered`, `offset ${m.offset}px from exact center`);
  check(m.offset > -200, `column NOT at the old left-aligned position (offset > -200px)`);
  check(m.hasBubble, 'assistant message rendered in column');
  check(m.textLen > 0, 'column has content');
  // Sanity: centered means the left edge moved right vs the pre-fix layout.
  const minLeft = m.chatLeft + 44; // old layout: padding-left 44px
  check(m.innerLeft > minLeft + 40, `left edge moved right of old position`, `left ${Math.round(m.innerLeft)}px vs old ${Math.round(minLeft)}px`);

  // User message bubble: right-aligned inside the centered column + styled.
  check(m.userGap !== null && m.userGap >= -1 && m.userGap <= 1, `user bubble flush with column right edge (gap ${m.userGap}px)`);
  check(m.userRight !== null && m.userRight > m.innerLeft + m.innerWidth / 2, `user bubble on the right half (right ${m.userRight}px)`);
  check(m.userBg !== null && m.userBg !== 'rgba(0, 0, 0, 0)', `user bubble has background (${m.userBg})`);
  check(m.userRadius !== null && parseFloat(m.userRadius) > 8, `user bubble has rounded corners (radius ${m.userRadius})`);
}

await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'probe-chat-center.png'), Buffer.from(data, 'base64'));
  console.log('[center] saved spike/probe-chat-center.png');
}).catch(() => {});

cdp.close();
chrome.kill();
console.log(failures === 0 ? '[center] ALL PASS' : `[center] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
