// E2E driver for the project (workspace folder) feature: loads the Pi Desktop
// UI (mock bridge) in headless Chrome, switches project via the topbar picker
// (mock pick returns the repo root), sends a prompt, and screenshots every
// stage. Run: node spike/e2e-project.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9224;
const SHOTS = join('spike', 'project');

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

/** Wait until the app is back on 'pi 已连接' (after a project restart). */
async function waitReady(cdp, what) {
  // The click that triggered the switch is async: give React a beat to flip
  // into 'connecting' first, or the first poll reads the stale ready state.
  await sleep(600);
  for (let i = 0; i < 40; i++) {
    const st = await evalJs(cdp, `document.querySelector('.status-state')?.textContent ?? null`);
    if (st === 'pi 已连接') {
      console.log('[waitReady]', what, '-> ready after', i, 'tries');
      return;
    }
    await sleep(500);
  }
  throw new Error('app not ready after ' + what);
}

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

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
  console.log('[shot]', name);
}

const main = async () => {
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
  // Wait for the app to reach 'ready' (pi connected + models loaded).
  for (let i = 0; i < 120; i++) {
    const state = await evalJs(cdp, `(() => {
      const s = document.querySelector('.status-state');
      return s ? s.textContent : null;
    })()`);
    if (state === 'pi 已连接') break;
    await sleep(500);
  }
  await sleep(800);

  // 1) Project chip exists and shows the placeholder label.
  const chip = await evalJs(cdp, `(() => {
    const el = document.querySelector('.topbar .project-select .sel-name');
    return el ? el.textContent : null;
  })()`);
  console.log('project chip label:', chip);
  if (chip !== '选择项目') throw new Error('chip should read 选择项目 initially, got ' + chip);

  // 1b) Sidebar already groups the seeded fixture sessions by project.
  const groups0 = await evalJs(cdp, `[...document.querySelectorAll('.session-group-label .label')].map((e) => e.textContent)`);
  console.log('initial sidebar groups:', JSON.stringify(groups0));
  if (!groups0.includes('pi-desktop') || !groups0.includes('Sheldon')) {
    throw new Error('fixture groups missing, got ' + JSON.stringify(groups0));
  }
  await shot(cdp, '1-initial.png');

  // 2) Open the project menu — 「无项目」+ pick option (no recents yet).
  await evalJs(cdp, `document.querySelector('.topbar .project-select .status-select').click()`);
  await sleep(400);
  await shot(cdp, '2-project-menu.png');
  const menuText = await evalJs(cdp, `document.querySelector('.topbar .selector-menu').textContent`);
  console.log('menu contents:', JSON.stringify(menuText));
  if (!menuText.includes('无项目')) throw new Error('no-project option missing');
  if (!menuText.includes('选择其他文件夹')) throw new Error('pick option missing');

  // 3) Pick a folder (mock returns the repo root D:\pi-desktop).
  await evalJs(cdp, `(() => {
    const options = [...document.querySelectorAll('.topbar .selector-menu .selector-option')];
    const pick = options.find((o) => o.textContent.includes('选择其他文件夹'));
    pick.click();
  })()`);
  await waitReady(cdp, 'project pick');
  await sleep(800);
  const dbg = await evalJs(cdp, `(() => {
    const tb = document.querySelector('.topbar');
    const sb = document.querySelector('.statusbar');
    return JSON.stringify({
      topbar: tb ? tb.className : null,
      hasProjectSelect: !!document.querySelector('.project-select'),
      statusText: document.querySelector('.status-state')?.textContent ?? null,
      bodySnippet: document.body.textContent.slice(0, 200),
    });
  })()`);
  console.log('debug after pick:', dbg);
  const chip2 = await evalJs(cdp, `(() => {
    const el = document.querySelector('.topbar .project-select .sel-name');
    return el ? el.textContent : null;
  })()`);
  console.log('chip after pick:', chip2);
  if (chip2 !== 'pi-desktop') throw new Error('chip should read pi-desktop after pick, got ' + chip2);
  const status2 = await evalJs(cdp, `document.querySelector('.status-state').textContent`);
  if (status2 !== 'pi 已连接') throw new Error('not reconnected after project switch, got ' + status2);
  await shot(cdp, '3-project-picked.png');

  // 4) Open the menu again — pi-desktop is now a recent project and selected.
  await evalJs(cdp, `document.querySelector('.topbar .project-select .status-select').click()`);
  await sleep(400);
  const menu2 = await evalJs(cdp, `document.querySelector('.topbar .selector-menu').textContent`);
  console.log('menu after pick:', JSON.stringify(menu2));
  if (!menu2.includes('pi-desktop')) throw new Error('recent project not in menu');
  if (!menu2.includes('无项目')) throw new Error('no-project option gone after pick');
  await shot(cdp, '4-project-menu-with-recent.png');

  // 5) Send a real prompt — the session belongs to the picked project.
  await evalJs(cdp, `(() => {
    const ta = document.querySelector('.input-box textarea, textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请用一句话介绍你自己');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(300);
  await evalJs(cdp, `(() => {
    const btn = document.querySelector('.send-btn, button[title*="发送"]');
    if (btn) btn.click();
    else document.querySelector('.input-box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  // Wait for the assistant message row.
  for (let i = 0; i < 180; i++) {
    const hasAssistant = await evalJs(cdp, `!!document.querySelector('.message-row.assistant')`);
    if (hasAssistant) break;
    await sleep(500);
  }
  await sleep(3000);
  await shot(cdp, '5-chat-with-project.png');

  // 6) Sidebar: current project group first with the 「当前」 badge, the
  // chat session under it, and other projects below.
  await sleep(1500);
  const groupInfo = await evalJs(cdp, `[...document.querySelectorAll('.session-group')].map((g) => ({
    label: g.querySelector('.session-group-label .label')?.textContent,
    current: !!g.querySelector('.session-group-label .cur'),
    count: g.querySelectorAll('.session-item').length,
  }))`);
  console.log('sidebar groups:', JSON.stringify(groupInfo));
  if (groupInfo[0]?.label !== 'pi-desktop' || !groupInfo[0]?.current) {
    throw new Error('current project group should be first with badge, got ' + JSON.stringify(groupInfo));
  }
  if (groupInfo[0]?.count < 2) throw new Error('chat session missing from current group');
  if (groupInfo[1]?.label !== 'Sheldon') throw new Error('second group should be Sheldon');
  await shot(cdp, '6-sidebar-grouped.png');

  // 7) Switch back to NO-project mode — menu must offer 「无项目」.
  // Ensure the menu is freshly open (React's open state may be stale after
  // earlier DOM poking): close if open, then open.
  const menuCurrentlyOpen = await evalJs(cdp, `!!document.querySelector('.topbar .selector-menu')`);
  if (menuCurrentlyOpen) {
    await evalJs(cdp, `document.querySelector('.topbar .project-select .status-select').click()`);
    await sleep(300);
  }
  await evalJs(cdp, `document.querySelector('.topbar .project-select .status-select').click()`);
  await sleep(400);
  await shot(cdp, '7-menu-with-no-project.png');
  await evalJs(cdp, `(() => {
    const options = [...document.querySelectorAll('.topbar .selector-menu .selector-option')];
    const np = options.find((o) => o.textContent.includes('无项目'));
    if (!np) throw new Error('no-project option missing');
    np.click();
  })()`);
  await waitReady(cdp, 'no-project switch');
  await sleep(800);
  const chip3 = await evalJs(cdp, `(() => {
    const el = document.querySelector('.topbar .project-select .sel-name');
    return el ? el.textContent : null;
  })()`);
  console.log('chip after no-project:', chip3);
  if (chip3 !== '无项目') throw new Error('chip should read 无项目, got ' + chip3);
  const status3 = await evalJs(cdp, `document.querySelector('.status-state').textContent`);
  if (status3 !== 'pi 已连接') throw new Error('not reconnected after no-project, got ' + status3);
  await shot(cdp, '8-no-project-mode.png');

  // 8) Chat in no-project mode — session lands in the default-cwd group.
  await evalJs(cdp, `(() => {
    const ta = document.querySelector('.input-box textarea, textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '无项目模式下测试一条消息');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(300);
  await evalJs(cdp, `(() => {
    const btn = document.querySelector('.send-btn, button[title*="发送"]');
    if (btn) btn.click();
    else document.querySelector('.input-box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  for (let i = 0; i < 180; i++) {
    const hasAssistant = await evalJs(cdp, `!!document.querySelector('.message-row.assistant')`);
    if (hasAssistant) break;
    await sleep(500);
  }
  // Wait for agent_settled -> refreshSessions to surface the new session.
  let allNames = [];
  let diag = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    allNames = await evalJs(cdp, `[...document.querySelectorAll('.session-item .name')].map((n) => n.textContent)`);
    if (allNames.some((n) => n.includes('无项目模式下测试一条消息'))) break;
    if (i === 20) {
      diag = await evalJs(cdp, `(async () => {
        const r = await fetch('/sessions');
        const s = await r.json();
        return JSON.stringify({
          mockFiles: s.map((x) => x.file),
          treeText: document.querySelector('.session-tree')?.textContent.slice(0, 300),
          userRows: [...document.querySelectorAll('.message-row.user')].map((r) => r.textContent.slice(0, 30)),
          assistantRows: document.querySelectorAll('.message-row.assistant').length,
        });
      })()`);
    }
  }
  if (diag) console.log('[diag at 10s]', diag);
  const noProjGroup = await evalJs(cdp, `[...document.querySelectorAll('.session-group')].map((g) => ({
    label: g.querySelector('.session-group-label .label')?.textContent,
    items: g.querySelectorAll('.session-item').length,
  }))`);
  console.log('sidebar after no-project chat:', JSON.stringify(noProjGroup));
  if (!allNames.some((n) => n.includes('无项目模式下测试一条消息'))) {
    throw new Error('no-project chat session not in sidebar');
  }
  await shot(cdp, '9-no-project-chat.png');

  console.log('E2E PROJECT PASSED (incl. no-project mode)');
  await cdp.send('Browser.close');
  process.exit(0);
};

main().catch((err) => {
  console.error('E2E FAILED:', err.message);
  process.exit(1);
});
