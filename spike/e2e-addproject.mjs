// E2E for the add-project dialog (codex/zcode style): the project selector's
// 「添加项目…」opens a dialog where a path can be typed, validated live
// (exists / is-file / missing), missing folders get a 「创建并添加」flow, and
// 浏览… fills the input from the native picker (mock returns the repo root).
// Drives the real app (mock bridge + real pi) in headless Chrome.
//
// Run: node spike/e2e-addproject.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9227;
const SHOTS = join('spike', 'addproject');
const REPO_ROOT = process.cwd();
const NEW_DIR = join(tmpdir(), `pi-e2e-new-project-${Date.now()}`);
// Second recent project (besides the repo root) for the sidebar section test.
const SEED_DIR = join(tmpdir(), 'pi-e2e-seed-project');
const SEED_BASE = 'pi-e2e-seed-project';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kill the mock/vite children so a failed run doesn't hold the ports. */
function cleanup() {
  for (const p of [mock, vite, chrome]) {
    try { p.kill(); } catch {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// --- start mock bridge + vite ----------------------------------------------
mkdirSync(SEED_DIR, { recursive: true }); // mock spawns pi inside it on switch
const mock = spawn(process.execPath, [join(process.cwd(), 'spike', 'mock-server.mjs')], {
  env: {
    ...process.env,
    MOCK_PICK_DIR: REPO_ROOT,
    MOCK_RECENT_DIRS: `${REPO_ROOT};${SEED_DIR}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mock.stdout.on('data', (d) => process.stdout.write('[mock] ' + d));
mock.stderr.on('data', (d) => process.stderr.write('[mock-err] ' + d));
const vite = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'spike/vite.mock.config.ts', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (d) => process.stdout.write('[vite] ' + d));

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
const userData = mkdtempSync(join(tmpdir(), 'pi-addproject-chrome-'));
const chrome = spawn(CHROME, [
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

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
  console.log('[shot]', name);
}

/** Wait until the app is back on 'pi 已连接' (after a project restart). */
async function waitReady(cdp, what) {
  await sleep(600);
  for (let i = 0; i < 40; i++) {
    const ok = await evalJs(cdp, `!!document.querySelector('.conn-dot.ok')`);
    if (ok) {
      console.log('[waitReady]', what, '-> ready after', i, 'tries');
      return;
    }
    await sleep(500);
  }
  throw new Error('app not ready after ' + what);
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
  for (let i = 0; i < 120; i++) {
    if (await evalJs(cdp, `!!document.querySelector('.conn-dot.ok')`)) break;
    await sleep(500);
  }
  await sleep(800);

  // S1) Sidebar splits into 项目 and 任务 sections (ZCode/Codex style), with
  // the two seeded recent projects listed (neither current yet).
  const split = await evalJs(cdp, `(() => {
    const names = [...document.querySelectorAll('.project-item .name')].map((e) => e.textContent);
    return {
      projHeader: !!document.querySelector('.sidebar-section.proj .sidebar-header'),
      tasksHeader: !!document.querySelector('.sidebar-section.tasks .sidebar-header'),
      items: names,
      curBadges: document.querySelectorAll('.project-item .cur').length,
    };
  })()`);
  console.log('sidebar sections:', JSON.stringify(split));
  if (!split.projHeader || !split.tasksHeader) throw new Error('项目/任务 sections missing');
  if (split.items.length !== 2 || !split.items.includes('pi-desktop') || !split.items.includes(SEED_BASE)) {
    throw new Error('project list wrong: ' + JSON.stringify(split.items));
  }
  if (split.curBadges !== 0) throw new Error('no project should be current yet');
  await shot(cdp, '0-sidebar-sections.png');

  // S2) The 添加项目 ＋ in both section headers is hidden until hovered.
  const op0 = await evalJs(cdp, `getComputedStyle(document.querySelector('.proj-header .section-add')).opacity`);
  const opTasks0 = await evalJs(cdp, `getComputedStyle(document.querySelector('.sidebar-section.tasks .sidebar-header .section-add')).opacity`);
  console.log('add-button opacity before hover:', op0, '(tasks:', opTasks0 + ')');
  if (op0 !== '0' || opTasks0 !== '0') throw new Error('＋ should be hidden by default, opacity=' + op0 + '/' + opTasks0);

  // S2b) The 项目 module header folds/unfolds the project list. The header
  // carries no leading glyph (项目 must line up with 任务 below), so the
  // fold state is verified by the item count alone.
  const before = await evalJs(cdp, `document.querySelectorAll('.project-item').length`);
  const headerGlyph = await evalJs(cdp, `document.querySelectorAll('.proj-header .fld, .proj-header .chev, .proj-folder').length`);
  console.log('proj-header leading glyphs:', headerGlyph);
  if (headerGlyph !== 0) throw new Error('项目 header should carry no leading glyph (aligns with 任务)');
  await evalJs(cdp, `document.querySelector('.proj-header').click()`);
  await sleep(300);
  const folded = await evalJs(cdp, `document.querySelectorAll('.project-item').length`);
  console.log('after fold:', folded);
  if (folded !== 0) throw new Error('project list should be hidden after fold: ' + folded);
  await evalJs(cdp, `document.querySelector('.proj-header').click()`);
  await sleep(300);
  const unfolded = await evalJs(cdp, `document.querySelectorAll('.project-item').length`);
  console.log('after unfold:', unfolded);
  if (unfolded !== before) throw new Error('project list should be back after unfold: ' + unfolded);

  // S3) Real mouse move onto the 项目 header reveals it (CSS :hover).
  const rect = await evalJs(cdp, `(() => {
    const r = document.querySelector('.proj-header').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
  });
  await sleep(400);
  const op1 = await evalJs(cdp, `getComputedStyle(document.querySelector('.proj-header .section-add')).opacity`);
  console.log('add-button opacity on hover:', op1);
  if (op1 !== '1') throw new Error('＋ should appear on hover, opacity=' + op1);
  await shot(cdp, '0b-hover-reveal.png');

  // S3b) The 任务 header reveals its ＋ on hover the same way.
  const trect = await evalJs(cdp, `(() => {
    const r = document.querySelector('.sidebar-section.tasks .sidebar-header').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: trect.x + trect.w / 2, y: trect.y + trect.h / 2,
  });
  await sleep(400);
  const opTasks1 = await evalJs(cdp, `getComputedStyle(document.querySelector('.sidebar-section.tasks .sidebar-header .section-add')).opacity`);
  console.log('tasks add-button opacity on hover:', opTasks1);
  if (opTasks1 !== '1') throw new Error('tasks ＋ should appear on hover, opacity=' + opTasks1);

  // S4) Clicking it opens the add-project dialog; cancel keeps everything.
  await evalJs(cdp, `document.querySelector('.proj-header .section-add').click()`);
  await sleep(400);
  const dlg = await evalJs(cdp, `document.querySelector('.modal.add-project h2')?.textContent ?? null`);
  if (dlg !== '添加项目') throw new Error('＋ should open the add dialog, got ' + dlg);
  await evalJs(cdp, `[...document.querySelectorAll('.modal.add-project .actions button')].find((b) => b.textContent === '取消').click()`);
  await sleep(300);

  // S5) Clicking a 项目 item switches to it (restart pi, 当前 badge moves).
  await evalJs(cdp, `(() => {
    const el = [...document.querySelectorAll('.project-item')]
      .find((el) => el.querySelector('.name').textContent === ${JSON.stringify(SEED_BASE)});
    if (!el) throw new Error('seed project item not found');
    el.click();
  })()`);
  await waitReady(cdp, 'sidebar project switch');
  await sleep(800);
  const chip0 = await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .sel-name')?.textContent ?? null`);
  console.log('chip after sidebar switch:', chip0);
  if (chip0 !== SEED_BASE) throw new Error('chip should read ' + SEED_BASE + ' after sidebar switch, got ' + chip0);
  const badge = await evalJs(cdp, `(() => {
    const rows = [...document.querySelectorAll('.project-item')].map((el) => ({
      name: el.querySelector('.name').textContent,
      cur: !!el.querySelector('.cur'),
    }));
    return rows;
  })()`);
  console.log('sidebar items after switch:', JSON.stringify(badge));
  if (!badge.some((b) => b.name === SEED_BASE && b.cur)) throw new Error('当前 badge missing on seed project');
  await shot(cdp, '0c-sidebar-current.png');

  // 1) The project menu no longer offers 添加项目 (moved to the sidebar header).
  await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .status-select').click()`);
  await sleep(400);
  const menuText = await evalJs(cdp, `document.querySelector('.selector-menu').textContent`);
  console.log('menu contents:', JSON.stringify(menuText));
  if (menuText.includes('添加项目')) throw new Error('添加项目 option should have moved out of the chat-area menu');
  await shot(cdp, '1-menu.png');
  // Close the menu again.
  await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .status-select').click()`);
  await sleep(300);

  // 2) Open the dialog via the sidebar 项目 header ＋ (the only entry now).
  await evalJs(cdp, `document.querySelector('.proj-header .section-add').click()`);
  await sleep(400);
  const title = await evalJs(cdp, `document.querySelector('.modal.add-project h2')?.textContent ?? null`);
  console.log('dialog title:', title);
  if (title !== '添加项目') throw new Error('dialog did not open, title=' + title);
  const addDisabled0 = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').disabled`);
  if (!addDisabled0) throw new Error('add button should be disabled with empty input');
  await shot(cdp, '2-dialog-empty.png');

  // 3) Type a path that doesn't exist yet → 「创建并添加」 flow.
  await evalJs(cdp, `(() => {
    const inp = document.querySelector('.modal.add-project input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(NEW_DIR)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  // Debounced validation (300ms) + round trip to the mock.
  let hint = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    hint = await evalJs(cdp, `document.querySelector('.modal.add-project .proj-hint')?.textContent ?? null`);
    if (hint && hint.includes('自动创建')) break;
  }
  console.log('missing-path hint:', hint);
  if (!hint || !hint.includes('自动创建')) throw new Error('create hint missing, got ' + hint);
  const btnLabel = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').textContent`);
  const btnDisabled = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').disabled`);
  console.log('primary button:', btnLabel, 'disabled:', btnDisabled);
  if (btnLabel !== '创建并添加' || btnDisabled) throw new Error('expected enabled 创建并添加, got ' + btnLabel);
  await shot(cdp, '3-create-flow.png');

  // 4) Confirm → folder created + project switched (pi restarted).
  await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').click()`);
  await waitReady(cdp, 'create-and-add');
  await sleep(800);
  const chip = await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .sel-name')?.textContent ?? null`);
  console.log('chip after add:', chip);
  const newBase = NEW_DIR.split(/[\\/]/).filter(Boolean).pop();
  if (chip !== newBase) throw new Error('chip should read ' + newBase + ', got ' + chip);

  // 5) The new folder is now a recent project in the menu.
  await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .status-select').click()`);
  await sleep(400);
  const menu2 = await evalJs(cdp, `document.querySelector('.selector-menu').textContent`);
  if (!menu2.includes(newBase)) throw new Error('new project not in recent list');
  await shot(cdp, '4-menu-with-recent.png');
  // Close the menu again.
  await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .status-select').click()`);
  await sleep(300);

  // 6) A typed *file* path is rejected live (button stays disabled).
  await evalJs(cdp, `document.querySelector('.proj-header .section-add').click()`);
  await sleep(400);
  // Wait for the fresh dialog's reset (empty input) before typing.
  for (let i = 0; i < 20; i++) {
    const val = await evalJs(cdp, `document.querySelector('.modal.add-project input')?.value ?? null`);
    if (val === '') break;
    await sleep(200);
  }
  await evalJs(cdp, `(() => {
    const inp = document.querySelector('.modal.add-project input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(join(REPO_ROOT, 'package.json'))});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    hint = await evalJs(cdp, `document.querySelector('.modal.add-project .proj-hint')?.textContent ?? null`);
    if (hint && hint.includes('是文件')) break;
  }
  console.log('file-path hint:', hint);
  if (!hint || !hint.includes('是文件')) throw new Error('file-path error hint missing, got ' + hint);
  const btnDisabled2 = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').disabled`);
  if (!btnDisabled2) throw new Error('add button should be disabled for a file path');
  await shot(cdp, '5-file-path-rejected.png');

  // 7) 浏览… fills the input from the (mock) native picker → existing folder,
  //    「添加项目」 enabled. Cancel keeps the app untouched.
  await evalJs(cdp, `document.querySelector('.modal.add-project .browse-btn').click()`);
  await sleep(400);
  const inputVal = await evalJs(cdp, `document.querySelector('.modal.add-project input').value`);
  console.log('input after browse:', inputVal);
  if (inputVal !== REPO_ROOT) throw new Error('browse should fill repo root, got ' + inputVal);
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    hint = await evalJs(cdp, `document.querySelector('.modal.add-project .proj-hint')?.textContent ?? null`);
    if (hint && hint.includes('已存在')) break;
  }
  console.log('browse hint:', hint);
  if (!hint || !hint.includes('已存在')) throw new Error('exists hint missing, got ' + hint);
  const btnLabel2 = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').textContent`);
  const btnDisabled3 = await evalJs(cdp, `document.querySelector('.modal.add-project .actions button.primary').disabled`);
  if (btnLabel2 !== '添加项目' || btnDisabled3) throw new Error('expected enabled 添加项目 after browse');
  await shot(cdp, '6-browse-existing.png');
  await evalJs(cdp, `[...document.querySelectorAll('.modal.add-project .actions button')].find((b) => b.textContent === '取消').click()`);
  await sleep(300);
  const closed = await evalJs(cdp, `!document.querySelector('.modal.add-project')`);
  if (!closed) throw new Error('dialog should close on cancel');
  const chip2 = await evalJs(cdp, `document.querySelector('.inputbox-tools .project-select .sel-name')?.textContent ?? null`);
  if (chip2 !== newBase) throw new Error('cancel should not switch project, chip=' + chip2);

  console.log('E2E ADDPROJECT PASSED');
  await cdp.send('Browser.close');
  process.exit(0);
};

main().catch((err) => {
  console.error('E2E FAILED:', err.message);
  process.exit(1);
});
