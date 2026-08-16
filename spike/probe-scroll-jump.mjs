// E2E probe for the ZCode-style "jump to latest" button (spike/probe-scroll-jump.mjs).
//
// Boots the app (scripted fake bridge + vite mock config) in headless Chrome,
// replays three growing turns so the conversation overflows, then checks:
//   - the button is hidden while pinned to the bottom,
//   - it fades in when the user scrolls up more than a viewport,
//   - geometry: circular, semi-transparent, bottom-center of the chat area,
//   - clicking it returns to the bottom, hides the button and re-pins the view.
//
//   node spike/probe-scroll-jump.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9234;

const servers = [];
const spawnSrv = (cmd, args, name) => {
  const p = spawn(cmd, args, { shell: true, stdio: 'ignore' });
  servers.push(p);
  console.log(`[jump] started ${name} (pid ${p.pid})`);
};
spawnSrv(process.execPath, ['spike/nav-server.mjs'], 'fake bridge');
spawnSrv('npx', ['vite', '--config', 'spike/vite.mock.config.ts', '--host', '127.0.0.1'], 'vite');

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-jump-'));
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
servers.push(chrome);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, label, detail) => {
  console.log(`[jump] ${cond ? 'PASS' : 'FAIL'} ${label}${detail !== undefined ? ' — ' + detail : ''}`);
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
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitFor(cdp, expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await cdp.eval(expr);
      if (v) { console.log(`[jump] ok: ${label}`); return v; }
    } catch {}
    await sleep(200);
  }
  throw new Error('timeout waiting for ' + label);
}

const JUMP_STATE = `(() => {
  const el = document.querySelector('.chat-jump');
  const chat = document.querySelector('.chat');
  if (!el || !chat) return null;
  const cs = getComputedStyle(el);
  return {
    visible: el.classList.contains('visible'),
    opacity: cs.opacity,
    pe: cs.pointerEvents,
    radius: cs.borderRadius,
    bg: cs.backgroundColor,
    bottom: cs.bottom,
    left: cs.left,
    transform: cs.transform,
    w: cs.width,
    h: cs.height,
    btnTop: Math.round(el.getBoundingClientRect().top),
    btnBottom: Math.round(el.getBoundingClientRect().bottom),
    btnLeft: Math.round(el.getBoundingClientRect().left),
    btnRight: Math.round(el.getBoundingClientRect().right),
    wrapLeft: Math.round(chat.parentElement.getBoundingClientRect().left),
    wrapRight: Math.round(chat.parentElement.getBoundingClientRect().right),
    gap: Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight),
    top: Math.round(chat.scrollTop),
    max: Math.round(chat.scrollHeight - chat.clientHeight),
    textLen: (chat.innerText || '').length,
  };
})()`;

// ---- boot ----------------------------------------------------------------
await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await waitFor(cdp, `!!document.querySelector('.inputbox textarea')`, 60000, 'app booted (textarea present)');
await sleep(600);

// Replay three growing turns through the real input; each settles when the
// text stops growing and the agent dots disappear.
const sendPrompt = async (text) => {
  await cdp.eval(`document.querySelector('.inputbox textarea').focus()`);
  await cdp.send('Input.insertText', { text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  let prev = -1, stable = 0;
  while (true) {
    await sleep(400);
    const len = await cdp.eval(`(document.querySelector('.chat-inner')?.innerText || '').length`);
    const active = await cdp.eval(`!!document.querySelector('.agent-dots')`);
    if (len === prev) { if (stable++ >= 3) break; } else { stable = 0; prev = len; }
    if (active && stable === 0) continue;
  }
};

console.log('[jump] sending 3 turns…');
await sendPrompt('第一轮：确认滚动跟随');
await sendPrompt('第二轮：内容继续增长');
await sendPrompt('第三轮：足够长的内容以产生溢出');
const s0 = await cdp.eval(JUMP_STATE);
console.log('[jump] settled:', JSON.stringify({ gap: s0.gap, max: s0.max, textLen: s0.textLen }));

// ---- assertions -----------------------------------------------------------
check(s0.max > 200, 'conversation overflows the chat viewport', `max=${s0.max}px`);
check(s0.visible === false, 'button hidden while pinned to bottom', `visible=${s0.visible}`);
check(s0.opacity === '0', 'button opacity 0 while pinned', `opacity=${s0.opacity}`);
check(s0.pe === 'none', 'button pointer-events none while pinned', `pe=${s0.pe}`);
check(s0.radius === '50%', 'button is a circle (border-radius 50%)', `radius=${s0.radius}`);
const btnCx = (s0.btnLeft + s0.btnRight) / 2, wrapCx = (s0.wrapLeft + s0.wrapRight) / 2;
check(Math.abs(btnCx - wrapCx) <= 2, 'button horizontally centered in chat area', `btnCx=${btnCx} wrapCx=${wrapCx}`);
check(s0.w === '32px' && s0.h === '32px', 'button is 32×32 px', `${s0.w}×${s0.h}`);
check(/0\.92/.test(s0.bg), 'button has translucent background', s0.bg);
check(s0.btnBottom < s0.wrapRight || s0.bottom === '28px', 'button floats near the chat bottom', `bottom=${s0.bottom}`);

// Scroll far up: the button must fade in (threshold: more than one viewport).
await cdp.eval(`document.querySelector('.chat').scrollTop = 0`);
await sleep(450);
const s1 = await cdp.eval(JUMP_STATE);
check(s1.visible === true, 'button visible after scrolling up', `gap=${s1.gap}px`);
check(s1.opacity === '1', 'button fully opaque when visible', `opacity=${s1.opacity}`);
check(s1.pe === 'auto', 'button clickable when visible', `pe=${s1.pe}`);

// Clicking it returns to the bottom and hides the button.
await cdp.eval(`document.querySelector('.chat-jump').click()`);
await sleep(450);
const s2 = await cdp.eval(JUMP_STATE);
check(s2.gap <= 2, 'click scrolls to the bottom', `gap=${s2.gap}px`);
check(s2.visible === false, 'button hidden again after jump', `visible=${s2.visible}`);

// While pinned again, a fourth turn streaming in must not get stuck: the
// view stays at the bottom (the re-pin survived the click).
await sendPrompt('第四轮：验证回到底部后仍自动跟随');
const s3 = await cdp.eval(JUMP_STATE);
check(s3.gap <= 5, 'view stays pinned while the 4th turn streams', `gap=${s3.gap}px`);

// Scroll up once more so the screenshot shows the button mid-fade state.
await cdp.eval(`document.querySelector('.chat').scrollTop = 0`);
await sleep(500);
await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'probe-scroll-jump.png'), Buffer.from(data, 'base64'));
  console.log('[jump] saved spike/probe-scroll-jump.png');
}).catch(() => {});

cdp.close();
for (const p of servers) { try { p.kill(); } catch {} }
console.log(failures === 0 ? '[jump] ALL PASS' : `[jump] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
