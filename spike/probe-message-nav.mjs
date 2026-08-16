// Probe: verify the ZCode-style message rail (.msg-nav) in the chat —
// one bar per user message on the left edge, the bar for the message at the
// cursor line highlighted, click jumps to the message, user scroll releases
// the pin, Ctrl+Alt+[ / ] navigate.
//
//   node spike/nav-server.mjs &          # scripted multi-turn fake bridge
//   npx vite --config spike/vite.mock.config.ts &
//   node spike/probe-message-nav.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9238;
const W = 1600, H = 900;

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-nav-'));
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
  console.log(`[nav] ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// The rail's own hit-test algorithm, recomputed here from the measured turn
// spans so the assertion is independent of the component's internals.
const CURSOR_LINE = 100;
function expectedActive(spans, clientHeight) {
  const line = CURSOR_LINE;
  const shown = spans.filter((m) => m.bottom > 0 && m.top < clientHeight);
  const hit = shown.find((m) => m.top <= line && m.bottom >= line);
  if (hit) return hit.idx;
  let best = null;
  let bestDist = Infinity;
  for (const m of shown) {
    const d = Math.abs(m.top - line);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  if (best) return best.idx;
  for (let i = spans.length - 1; i >= 0; i--) if (spans[i].top <= line) return spans[i].idx;
  return spans.length > 0 ? 0 : -1;
}

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
    if (v) { console.log(`[nav] ok: ${label}`); return v; }
    await sleep(200);
  }
  try {
    const diag = await cdp.eval(`({
      textarea: !!document.querySelector('.inputbox textarea'),
      userRows: document.querySelectorAll('.message-row.user').length,
      nav: !!document.querySelector('.msg-nav'),
      markers: document.querySelectorAll('.msg-nav-marker').length,
      agentDots: !!document.querySelector('.agent-dots'),
      url: location.href,
    })`);
    console.log('[nav] TIMEOUT diag:', JSON.stringify(diag));
  } catch {}
  throw new Error('timeout waiting for ' + label);
}

// ---- rail state snapshot ------------------------------------------------
const railState = `(() => {
  const chat = document.querySelector('.chat');
  const rows = document.querySelectorAll('.message-row.user');
  const markers = document.querySelectorAll('.msg-nav-marker');
  const chatRect = chat.getBoundingClientRect();
  const spans = [];
  document.querySelectorAll('.message-row').forEach((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top - chatRect.top;
    if (el.classList.contains('user')) spans.push({ idx: spans.length, top, bottom: top });
    else if (spans.length) spans[spans.length - 1].bottom = Math.max(spans[spans.length - 1].bottom, r.bottom - chatRect.top);
  });
  const inner = document.querySelector('.chat-inner');
  if (inner && spans.length) spans[spans.length - 1].bottom = Math.max(spans[spans.length - 1].bottom, inner.getBoundingClientRect().bottom - chatRect.top);
  const innerEl = document.querySelector('.chat-inner');
  const innerRect = innerEl ? innerEl.getBoundingClientRect() : null;
  const activeIdx = [...markers].findIndex((m) => m.classList.contains('active'));
  const activeMarker = activeIdx >= 0 ? markers[activeIdx] : null;
  const otherMarker = markers.length > 1 ? markers[(activeIdx + 1) % markers.length] : null;
  // The visible bar lives in ::before; the button itself is the big hit area.
  const aStyle = activeMarker ? getComputedStyle(activeMarker, '::before') : null;
  const oStyle = otherMarker ? getComputedStyle(otherMarker, '::before') : null;
  const aBtn = activeMarker ? getComputedStyle(activeMarker) : null;
  return {
    markerCount: markers.length,
    activeIdx,
    activeW: aStyle ? aStyle.width : null,
    activeH: aStyle ? aStyle.height : null,
    activeBg: aStyle ? aStyle.backgroundColor : null,
    otherW: oStyle ? oStyle.width : null,
    otherBg: oStyle ? oStyle.backgroundColor : null,
    hitW: aBtn ? aBtn.width : null,
    hitH: aBtn ? aBtn.height : null,
    fracs: [...markers].map((m) => parseFloat(m.style.top)),
    titles: [...markers].map((m) => m.title || ''),
    scrollTop: chat.scrollTop,
    scrollHeight: chat.scrollHeight,
    clientHeight: chat.clientHeight,
    spans: spans.map((s) => ({ idx: s.idx, top: s.top, bottom: s.bottom })),
    rowTopRel: [...rows].map((el) => Math.round(el.getBoundingClientRect().top - chatRect.top)),
    innerTopRel: innerRect ? innerRect.top - chatRect.top : 0,
    innerHeight: innerRect ? innerRect.height : 0,
  };
})()`;

const sendPrompt = async (cdp, text) => {
  await cdp.eval(`document.querySelector('.inputbox textarea').focus()`);
  await cdp.send('Input.insertText', { text });
  // Give the text commit a beat — Enter pressed too early reads an empty value.
  await sleep(150);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
};

await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab(APP_URL);
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await waitFor(cdp, `!!document.querySelector('.inputbox textarea')`, 60000, 'app booted');

// After the first turn there is a single user message: no rail yet.
await sendPrompt(cdp, '标记一 第一轮对话');
// Wait for the turn to fully settle (agent idle), otherwise the next prompt
// is silently dropped by the sendPrompt agentActive guard. `.stop-btn` is the
// only reliable "agent active" signal — the streaming assistant row is already
// in the DOM and the agent dots are hidden while streaming.
const turnDone = (n) =>
  `!document.querySelector('.stop-btn') && document.querySelectorAll('.message-row.assistant').length === ${n}`;
await waitFor(cdp, turnDone(1), 60000, 'turn 1 done');
await sleep(400);
let s = await cdp.eval(railState);
check(s.markerCount === 0, `no rail with a single user message (markers=${s.markerCount})`);

// Two turns: rail appears with one bar per user message.
await sendPrompt(cdp, '标记二 第二轮对话');
await waitFor(cdp, turnDone(2), 60000, 'turn 2 done');
await sleep(400);
s = await cdp.eval(railState);
check(s.markerCount === 2, `rail shows one marker per user message (${s.markerCount})`);

// Four turns total, then verify geometry and highlight behavior.
await sendPrompt(cdp, '标记三 第三轮对话');
await waitFor(cdp, turnDone(3), 60000, 'turn 3 done');
await sleep(300);
await sendPrompt(cdp, '标记四 第四轮对话');
await waitFor(cdp, turnDone(4), 60000, 'turn 4 done');
await sleep(500);

s = await cdp.eval(railState);
check(s.markerCount === 4, `four markers for four user messages (${s.markerCount})`);
check(s.markerCount === s.spans.length, 'marker count matches turn spans');
check(s.fracs.every((f) => f >= 0 && f <= 100), 'all marker fractions inside the rail', JSON.stringify(s.fracs));
// The bars form a FIXED cluster centered on the rail — selecting a message
// only moves the white highlight between bars, the bars never jump around.
const stepPct = (14 / s.clientHeight) * 100;
const clusterSpan = Math.max(...s.fracs) - Math.min(...s.fracs);
check(
  s.fracs.length > 1 && clusterSpan <= (s.fracs.length - 1) * stepPct + 0.6,
  'bars pack into a tight cluster',
  `span=${clusterSpan.toFixed(2)}% step=${stepPct.toFixed(2)}% fracs=${s.fracs.join(', ')}`,
);
const clusterCenter = (Math.max(...s.fracs) + Math.min(...s.fracs)) / 2;
check(Math.abs(clusterCenter - 50) < 1, `cluster centered on the rail (center=${clusterCenter.toFixed(2)}%)`);
check(s.activeIdx === expectedActive(s.spans, s.clientHeight), `highlight follows the cursor line (active=${s.activeIdx}, expect ${expectedActive(s.spans, s.clientHeight)})`, `spans=${JSON.stringify(s.spans)}`);
if (s.activeW !== null && s.otherW !== null) {
  check(parseFloat(s.activeW) > parseFloat(s.otherW), `active bar wider than inactive (${s.activeW} vs ${s.otherW})`);
  check(s.activeBg === 'rgb(255, 255, 255)', `active bar is white (${s.activeBg})`);
  check(s.otherBg !== 'rgb(255, 255, 255)', `inactive bar is dim (${s.otherBg})`);
}
// Regression: the clickable zone must be far bigger than the 2px bar itself —
// the button is a full-rail-width × 16px transparent hit area, the slim white
// bar is only its ::before decoration. (Previously the bar was the button, so
// switching messages needed pixel-precise clicks.)
if (s.hitW !== null && s.hitH !== null) {
  check(parseFloat(s.hitW) >= 40 && parseFloat(s.hitH) >= 14,
    `marker hit area is big and easy to aim (${s.hitW}×${s.hitH})`);
  check(parseFloat(s.hitH) > parseFloat(s.activeH || s.otherH || '0'),
    `hit area taller than the visible bar (${s.hitH} vs ${s.activeH || s.otherH})`);
}

// Scroll to top (then a wheel gesture so the pin is free): the first turn
// spans the cursor line -> marker 0 active.
await cdp.eval(`(() => { const chat = document.querySelector('.chat'); chat.scrollTo({ top: 0 }); chat.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true })); })()`);
await sleep(300);
s = await cdp.eval(railState);
check(s.activeIdx === expectedActive(s.spans, s.clientHeight) && s.activeIdx === 0, `top view highlights marker 0 (active=${s.activeIdx})`, `scrollTop=${s.scrollTop}`);

// Click marker 3: the fourth message jumps to the cursor line and its bar
// stays highlighted (pinned) even though the scroll event fires.
await cdp.eval(`document.querySelectorAll('.msg-nav-marker')[3].click()`);
await sleep(400);
s = await cdp.eval(railState);
check(s.activeIdx === 3, `click on marker 3 pins it (active=${s.activeIdx})`);
check(s.rowTopRel[3] >= 95 && s.rowTopRel[3] <= 105, `clicked message lands on the cursor line (top=${s.rowTopRel[3]}px, expect ~100)`);

// Selecting a different message must not move the bars — the cluster is
// fixed, only the white highlight moves between bars (regression: a cluster
// that followed the active message snapped to the rail top when the first
// message was selected).
const fracsBefore = s.fracs.slice();
await cdp.eval(`document.querySelectorAll('.msg-nav-marker')[0].click()`);
await sleep(400);
s = await cdp.eval(railState);
check(s.activeIdx === 0, `click on marker 0 selects the first message (active=${s.activeIdx})`);
check(s.rowTopRel[0] >= 20 && s.rowTopRel[0] <= 40, `first message at its top-most position (top=${s.rowTopRel[0]}px — nothing above it to scroll to the cursor line)`);
check(
  s.fracs.every((f, i) => Math.abs(f - fracsBefore[i]) < 0.01),
  'bars stay put when another message is selected',
  `before=${fracsBefore.join(', ')} after=${s.fracs.join(', ')}`,
);

// A user wheel releases the pin; the highlight follows the cursor line again.
await cdp.eval(`document.querySelector('.chat').dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true }))`);
await cdp.eval(`(() => { const chat = document.querySelector('.chat'); chat.scrollTo({ top: 0 }); })()`);
await sleep(400);
s = await cdp.eval(railState);
check(s.activeIdx === expectedActive(s.spans, s.clientHeight) && s.activeIdx === 0, `after user scroll the highlight follows the cursor line (active=${s.activeIdx})`, `scrollTop=${s.scrollTop}`);

// Ctrl+Alt+] moves to the next user message (ZCode's mod+alt+]).
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', altKey: true, ctrlKey: true, bubbles: true }))`);
await sleep(400);
s = await cdp.eval(railState);
check(s.activeIdx === 1, `Ctrl+Alt+] jumps to the next message (active=${s.activeIdx})`);
check(s.rowTopRel[1] >= 95 && s.rowTopRel[1] <= 105, `next message lands on the cursor line (top=${s.rowTopRel[1]}px)`);

// Hovering a bar floats a preview popover with the hovered user message.
// Move the real mouse onto marker 1 (the messages are 标记一..标记四).
const markerBox = await cdp.eval(`(() => {
  const r = document.querySelectorAll('.msg-nav-marker')[1].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: markerBox.x, y: markerBox.y });
await sleep(350);
const popState = await cdp.eval(`(() => {
  const pop = document.querySelector('.msg-nav-pop');
  if (!pop) return null;
  const r = pop.getBoundingClientRect();
  const nav = document.querySelector('.msg-nav').getBoundingClientRect();
  const chat = document.querySelector('.chat').getBoundingClientRect();
  return {
    text: pop.textContent,
    left: Math.round(r.left - chat.left),
    top: Math.round(r.top - chat.top),
    width: Math.round(r.width),
    navRight: Math.round(nav.right - chat.left),
    codeBadges: pop.querySelectorAll('code').length,
  };
})()`);
check(popState !== null, 'hovering a bar shows the preview popover');
if (popState) {
  check(popState.text.includes('标记二'), `popover shows the hovered message (${popState.text.slice(0, 24)}…)`);
  check(popState.text.includes('标记三') === false, 'popover does not show other messages');
  check(popState.left > popState.navRight + 8, `popover floats right of the rail (left=${popState.left}px, rail right=${popState.navRight}px)`);
  check(popState.width >= 280, `popover has a readable width (${popState.width}px)`);
}

// Moving the pointer from the 2px bar onto the popover (crossing the gap)
// must not close it — the hide grace bridges the gap.
const popBox = await cdp.eval(`(() => {
  const r = document.querySelector('.msg-nav-pop').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: popBox.x, y: popBox.y });
await sleep(450);
const stillOpen = await cdp.eval(`!!document.querySelector('.msg-nav-pop')`);
check(stillOpen, 'popover stays open while the pointer rests on it');

// Screenshot with the preview open (pointer resting on the popover).
await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'probe-message-nav-hover.png'), Buffer.from(data, 'base64'));
  console.log('[nav] saved spike/probe-message-nav-hover.png');
}).catch(() => {});

// Leaving the popover hides it.
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 800 });
await sleep(450);
const closed = await cdp.eval(`!document.querySelector('.msg-nav-pop')`);
check(closed, 'popover hides after the pointer leaves');

await cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(join(process.cwd(), 'spike', 'probe-message-nav.png'), Buffer.from(data, 'base64'));
  console.log('[nav] saved spike/probe-message-nav.png');
}).catch(() => {});

cdp.close();
chrome.kill();
console.log(failures === 0 ? '[nav] ALL PASS' : `[nav] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
