// E2E: model selection must be unique per provider — pi serves the SAME
// model id under several providers (deepseek-v4-flash exists under deepseek /
// opencode-go / jbbtoken), so the menu must key options on provider+id:
//   1. exactly one row shows the ✓ when the menu opens
//   2. selecting the opencode-go copy actually switches provider
//      (trigger shows the provider, and only that row is ✓ afterwards)
//
// Run: node spike/mock-server.mjs & npx vite --config spike/vite.mock.config.ts --host 127.0.0.1 &
//      node spike/e2e-modelprovider.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9227;

// --- seed a session dir (real pi needs a writable session dir) ---------------
const fx = mkdtempSync(join(tmpdir(), 'pi-model-fx-'));
for (const f of readdirSync(join(process.cwd(), 'spike', 'fixtures'))) {
  if (f.endsWith('.jsonl')) copyFileSync(join(process.cwd(), 'spike', 'fixtures', f), join(fx, f));
}
console.log('[model] fixtures:', readdirSync(fx).join(', ') || '(none)');

// --- start mock bridge + vite ------------------------------------------------
const mock = spawn(process.execPath, [join(process.cwd(), 'spike', 'mock-server.mjs')], {
  env: { ...process.env, MOCK_FIXTURES_DIR: fx },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mock.stdout.on('data', (d) => process.stdout.write('[mock] ' + d));
mock.stderr.on('data', (d) => process.stderr.write('[mock-err] ' + d));
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

await waitHttp('http://127.0.0.1:4321/sessions', 'mock bridge');
await waitHttp('http://127.0.0.1:4322/', 'vite');

// --- headless chrome + CDP ----------------------------------------------------
const userData = mkdtempSync(join(tmpdir(), 'pi-model-chrome-'));
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
  throw new Error('CDP unreachable: ' + url);
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
    const v = await cdp.eval(expr);
    if (v) { console.log(`[model] ok: ${label}`); return v; }
    await sleep(1000);
  }
  throw new Error('timeout waiting for ' + label);
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`[model] ${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
};

// Page-side helpers.
const openModelMenu = `(() => {
  const sel = [...document.querySelectorAll('.inputbox-main .inputbox-select')]
    .find((s) => !s.querySelector('.sel-icon'));
  if (!sel) return false;
  sel.querySelector('.status-select').click();
  return true;
})()`;

// Click the option whose label starts with `label` inside the group whose
// header text is `group` (group headers and option buttons are siblings).
const clickInGroup = (group, label) => `(() => {
  const menu = document.querySelector('.selector-menu');
  if (!menu) return false;
  let inGroup = false;
  for (const n of menu.children) {
    if (n.classList.contains('selector-group')) { inGroup = n.textContent.trim() === ${JSON.stringify(group)}; continue; }
    if (inGroup && n.classList.contains('selector-option')
        && n.querySelector('.label')?.textContent.startsWith(${JSON.stringify(label)})) {
      n.scrollIntoView({ block: 'nearest' });
      n.click();
      return true;
    }
  }
  return false;
})()`;

// Selected rows across the whole menu (must always be exactly 1).
const selectedCount = `[...document.querySelectorAll('.selector-option.selected')].length`;
const ariaSelectedCount = `[...document.querySelectorAll('.selector-option[aria-selected="true"]')].length`;

try {
  await getJson(`http://127.0.0.1:${PORT}/json/version`);
  const tab = await newTab(APP_URL);
  const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // App boots against real pi; models load with it.
  await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 90000, 'app connected');
  await waitFor(
    cdp,
    `document.querySelector('.inputbox-main .inputbox-select .status-select .sel-name')?.textContent !== '选择模型'`,
    30000,
    'current model loaded',
  );

  // Guard: pi still serves the duplicate id (this regression test depends on it).
  await cdp.eval(openModelMenu);
  await waitFor(cdp, `!!document.querySelector('.selector-menu')`, 10000, 'model menu open');
  // Models load asynchronously after boot — wait until the menu is populated.
  await waitFor(cdp, `document.querySelectorAll('.selector-menu .selector-option').length >= 5`, 30000, 'model list populated');
  const dupRows = await cdp.eval(
    `[...document.querySelectorAll('.selector-option')]
       .filter((o) => o.querySelector('.label')?.textContent.startsWith('DeepSeek V4 Flash')).length`);
  const groups = await cdp.eval(
    `[...document.querySelectorAll('.selector-group')].map((g) => g.textContent.trim()).filter((g) => ['deepseek','opencode-go','jbbtoken'].includes(g))`);
  if (dupRows < 2 || !groups.includes('opencode-go')) {
    console.log('[model] SKIP: pi model catalog changed — duplicate-id rows=' + dupRows + ' groups=' + JSON.stringify(groups));
    cdp.close();
    throw new Error('catalog no longer has duplicate deepseek-v4-flash ids');
  }
  check('menu shows every duplicate-id row (regression needs it)', `${dupRows} rows / groups ${groups.join(',')}`, `${dupRows} rows / groups ${groups.join(',')}`);

  // 1. Exactly ONE selected row in the whole menu (no dual ✓).
  check('exactly one ✓ in menu', await cdp.eval(selectedCount), 1);
  check('exactly one aria-selected', await cdp.eval(ariaSelectedCount), 1);

  // 2. Select the deepseek copy, verify ✓ follows it.
  await cdp.eval(clickInGroup('deepseek', 'DeepSeek V4 Flash'));
  await waitFor(cdp, `document.querySelector('.inputbox-main .inputbox-select .status-select .sel-prov')?.textContent === 'deepseek'`, 30000, 'switched to provider=deepseek');
  await cdp.eval(openModelMenu);
  await waitFor(cdp, `!!document.querySelector('.selector-menu')`, 10000, 'model menu open (2)');
  check('deepseek copy selected only', await cdp.eval(selectedCount), 1);
  const deepseekSel = await cdp.eval(
    `(() => { const menu = document.querySelector('.selector-menu');
      let inGroup = false;
      for (const n of menu.children) {
        if (n.classList.contains('selector-group')) { inGroup = n.textContent.trim() === 'deepseek'; continue; }
        if (inGroup && n.classList.contains('selector-option') && n.classList.contains('selected')) return true;
      }
      return false; })()`);
  check('✓ sits in the deepseek group', deepseekSel, true);

  // 3. Select the opencode-go copy — the trigger must now say opencode-go and
  //    the ✓ must move to that group only (old code: find() picked deepseek,
  //    so this step could never switch providers).
  await cdp.eval(clickInGroup('opencode-go', 'DeepSeek V4 Flash'));
  await waitFor(cdp, `document.querySelector('.inputbox-main .inputbox-select .status-select .sel-prov')?.textContent === 'opencode-go'`, 30000, 'switched to provider=opencode-go');
  const title = await cdp.eval(
    `[...document.querySelectorAll('.inputbox-main .inputbox-select')]
       .find((s) => !s.querySelector('.sel-icon'))
       ?.querySelector('.status-select')?.title`);
  console.log('[model] trigger title after switch:', title);
  if (!title.includes('opencode-go')) { failed++; console.log('[model] FAIL trigger title lacks provider'); }
  await cdp.eval(openModelMenu);
  await waitFor(cdp, `!!document.querySelector('.selector-menu')`, 10000, 'model menu open (3)');
  check('still exactly one ✓', await cdp.eval(selectedCount), 1);
  const goSel = await cdp.eval(
    `(() => { const menu = document.querySelector('.selector-menu');
      let inGroup = false;
      for (const n of menu.children) {
        if (n.classList.contains('selector-group')) { inGroup = n.textContent.trim() === 'opencode-go'; continue; }
        if (inGroup && n.classList.contains('selector-option') && n.classList.contains('selected')) return true;
      }
      return false; })()`);
  check('✓ sits in the opencode-go group', goSel, true);
  const deepseekSelAfter = await cdp.eval(
    `(() => { const menu = document.querySelector('.selector-menu');
      let inGroup = false;
      for (const n of menu.children) {
        if (n.classList.contains('selector-group')) { inGroup = n.textContent.trim() === 'deepseek'; continue; }
        if (inGroup && n.classList.contains('selector-option') && n.classList.contains('selected')) return true;
      }
      return false; })()`);
  check('deepseek group no longer ✓', deepseekSelAfter, false);

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.cwd(), 'spike', 'e2e-modelprovider.png'), Buffer.from(data, 'base64'));
  console.log('[model] saved spike/e2e-modelprovider.png');

  cdp.close();
} finally {
  chrome.kill();
  mock.kill();
  vite.kill();
}

console.log(failed === 0 ? '[model] ALL PASS' : `[model] ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
