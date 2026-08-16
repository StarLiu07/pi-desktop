// E2E smoke driver: loads the Pi Desktop UI (mock bridge) in headless Chrome,
// sends a real prompt to pi, and verifies the usage stats line under the input box.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9223;

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-chrome-'));
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
  close() { try { this.ws.close(); } catch {} }
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = join(process.cwd(), 'spike', name);
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`[e2e] saved ${out}`);
}

async function waitFor(cdp, expr, timeoutMs = 90000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.eval(expr);
    if (v) { console.log(`[e2e] ok: ${label}`); return v; }
    await sleep(2000);
  }
  throw new Error('timeout waiting for ' + label);
}

// Chrome takes a moment to open the debugging port on first launch.
await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
console.log('[e2e] tab:', tab.id, tab.url);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

// App boots: pi connects, then the status bar shows the green dot.
await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 60000, 'app connected to pi');
console.log('[e2e] status:', await cdp.eval(`document.querySelector('.statusbar .sb-right')?.innerText?.trim()`));
await screenshot(cdp, 'e2e-1-empty.png');

// No usage before any message.
const pre = await cdp.eval(`document.querySelector('.sb-usage')?.innerText ?? null`);
console.log('[e2e] sb-usage before prompt:', JSON.stringify(pre));

// Focus the textarea (the app deliberately does not autofocus on boot —
// some IMEs pop a candidate window over the app) and type a prompt.
await cdp.eval(`document.querySelector('.inputbox-main textarea')?.focus()`);
const focused = await cdp.eval(`document.activeElement?.tagName + '|' + document.activeElement?.className`);
console.log('[e2e] focused element:', focused);
await cdp.send('Input.insertText', { text: 'Reply with exactly: one' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('[e2e] prompt sent');

// Wait for the assistant reply to land (message_end appends it to the list).
await waitFor(cdp, `[...document.querySelectorAll('.message-row')].some(r => r.classList.contains('assistant'))`, 120000, 'assistant message rendered');

// The usage stats must appear in the bottom status bar.
const statsText = await waitFor(cdp, `document.querySelector('.sb-usage')?.innerText ?? ''`, 30000, 'usage stats rendered');
console.log('[e2e] sb-usage text:', JSON.stringify(statsText));
await screenshot(cdp, 'e2e-2-usage.png');

// Also verify the hint line still renders.
const hint = await cdp.eval(`document.querySelector('.input-hint-text')?.innerText ?? null`);
console.log('[e2e] hint:', JSON.stringify(hint));

cdp.close();
chrome.kill();
console.log('[e2e] done');
process.exit(0);
