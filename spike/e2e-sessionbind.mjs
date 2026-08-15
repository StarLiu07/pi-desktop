// E2E regression: messages in one fresh conversation must stay in ONE session
// file. The reported bug: user opened a new conversation (＋), sent 3 messages,
// and found them scattered across 3 session files (one user message each) —
// the assistant lost all previous context per message.
//
// Root cause: pi's event stream carries no event with the session file (only
// get_state knows it), so the tab never learned its own file and `sendPrompt`
// re-sent `new_session` before EVERY message. The fix learns the session file
// right after `new_session` and binds it to the tab.
//
// This test drives the app against a scripted fake bridge (sessionbind-server.mjs)
// whose get_state reports a sessionFile that increments per new_session:
//   - fixed:  1 new_session total -> both prompts see ...-1.jsonl
//   - broken: 2 new_session      -> prompt #2 is preceded by a fresh session
//
// Run: node spike/e2e-sessionbind.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9241;

// --- start fake bridge + vite ------------------------------------------------
const bridge = spawn(process.execPath, [join(process.cwd(), 'spike', 'sessionbind-server.mjs')], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
bridge.stdout.on('data', (d) => process.stdout.write('[bridge] ' + d));
bridge.stderr.on('data', (d) => process.stderr.write('[bridge-err] ' + d));
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

await waitHttp('http://127.0.0.1:4321/sessions', 'fake bridge');
await waitHttp('http://127.0.0.1:4322/', 'vite');

// --- headless chrome + CDP ----------------------------------------------------
const userData = mkdtempSync(join(tmpdir(), 'pi-bind-chrome-'));
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
    if (v) return v;
    await sleep(200);
  }
  throw new Error('timeout waiting for ' + label);
}

let failures = 0;
const check = (cond, label) => {
  console.log(`[bind] ${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};

// ---- boot ----------------------------------------------------------------
await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await waitFor(cdp, `!!document.querySelector('.inputbox textarea')`, 60000, 'app booted (textarea present)');
await sleep(600);

// ---- open a NEW conversation (sidebar 任务「＋」) --------------------------
await cdp.eval(`document.querySelector('.tasks .section-add').click()`);
await sleep(500);

// ---- send two messages in that conversation --------------------------------
const sendMessage = async (text) => {
  await cdp.eval(`document.querySelector('.inputbox textarea').focus()`);
  await cdp.send('Input.insertText', { text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  // Wait for the turn to FULLY complete (assistant reply rendered, agent
  // settled → send button back), otherwise the next message is dropped by
  // InputBar's agentActive guard.
  await waitFor(
    cdp,
    `[...document.querySelectorAll('.message-row.user .user-text')].some((n) => n.textContent === ${JSON.stringify(text)})`,
    30000,
    `user message rendered: ${text}`,
  );
  await waitFor(
    cdp,
    `[...document.querySelectorAll('.message-row.assistant .bubble')].some((n) => n.textContent.includes(${JSON.stringify('回答：' + text)}))`,
    30000,
    `assistant reply rendered: ${text}`,
  );
  await waitFor(cdp, `!!document.querySelector('.send-btn')`, 30000, 'agent settled (send button back)');
};

await sendMessage('第一条消息');
await sendMessage('第二条消息');
await sleep(800);

// ---- assertions ------------------------------------------------------------
const log = await getJson('http://127.0.0.1:4321/rpc-log');
const types = log.map((r) => r.type);
console.log('[bind] rpc sequence:', JSON.stringify(types));

// 1. The two prompts must NOT each create their own session: exactly one
//    new_session for the whole fresh-tab conversation.
check(
  types.filter((t) => t === 'new_session').length === 1,
  `exactly one new_session for two messages (got ${types.filter((t) => t === 'new_session').length})`,
);

// 2. Both prompts were sent (sanity: the flow actually ran).
check(
  types.filter((t) => t === 'prompt').length === 2,
  `both prompts sent (got ${types.filter((t) => t === 'prompt').length})`,
);

// 3. The session file seen at prompt #2 equals the one at prompt #1 (the tab
//    stayed bound to the single session created by the one new_session).
const newSessionsBefore = (i) => types.slice(0, i).filter((t) => t === 'new_session').length;
const p1 = types.indexOf('prompt');
const p2 = types.indexOf('prompt', p1 + 1);
check(
  p1 >= 0 && p2 > p1 && newSessionsBefore(p1) === newSessionsBefore(p2) && newSessionsBefore(p1) === 1,
  `both prompts on the same session (new_session count before prompt #1 = ${p1 >= 0 ? newSessionsBefore(p1) : 'n/a'}, before prompt #2 = ${p2 > p1 ? newSessionsBefore(p2) : 'n/a'})`,
);

// 4. The tab actually bound the new session: the last get_state (the learn
//    right after new_session) reported the session created by it (…-1.jsonl),
//    not the startup session (…-0.jsonl).
const files = log.filter((r) => r.type === 'get_state' && r.sessionFile).map((r) => r.sessionFile);
check(
  files.length >= 2 && files[files.length - 1].endsWith('-1.jsonl'),
  `tab bound to the new session file (get_state files: ${JSON.stringify(files)})`,
);

// 5. UI: both turns rendered in the same tab (2 user + 2 assistant rows).
const rows = await cdp.eval(`document.querySelectorAll('.message-row').length`);
check(rows === 4, `both turns rendered in one tab (${rows} message rows, expect 4)`);

await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'e2e-sessionbind.png'), Buffer.from(data, 'base64'));
  console.log('[bind] saved spike/e2e-sessionbind.png');
}).catch(() => {});

// ---- teardown ---------------------------------------------------------------
cdp.close();
chrome.kill();
bridge.kill();
vite.kill();
console.log(failures === 0 ? '[bind] ALL PASS' : `[bind] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
