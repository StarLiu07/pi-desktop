// E2E driver for the animated folder icons (DSH workspace style):
//  - project rows: current project shows an open (accent) folder
//  - session group labels: folder morphs with the group collapse, chevron rotates
// The 项目 module header itself carries no glyph (its label must line up
// with 任务 below), so the module fold is verified by the item count.
// Verifies DOM classes, computed CSS transforms (mid- and post-animation),
// and captures screenshots for visual review.
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://localhost:4173/';
const PORT = 9224;

const userData = mkdtempSync(join(tmpdir(), 'pi-folder-e2e-'));
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
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
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

async function waitFor(cdp, expr, timeoutMs = 30000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cdp.eval(expr);
    if (v) { console.log(`[e2e] ok: ${label}`); return v; }
    await sleep(200);
  }
  throw new Error('timeout waiting for ' + label);
}

const passes = [];
const check = (name, cond, detail = '') => {
  console.log(`[e2e] ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  passes.push({ name, ok: !!cond });
};

await getJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await newTab('about:blank');
const cdp = await Cdp.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
// Headless Chrome defaults to prefers-reduced-motion: reduce, which our CSS
// honors (transitions off). Emulate a normal user so the morph actually runs.
await cdp.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

// Inject the Tauri mock before any app script runs.
const mock = readFileSync(join(process.cwd(), 'spike', 'mock-tauri.js'), 'utf8');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: mock });
await cdp.send('Page.navigate', { url: APP_URL });

// Shell ready: 项目 rows + session groups rendered.
await waitFor(cdp, `document.querySelectorAll('.project-item').length === 3`, 30000, 'project rows rendered');
await waitFor(cdp, `document.querySelectorAll('.session-group-label').length === 3`, 30000, 'session groups rendered');
await waitFor(cdp, `document.querySelector('.conn-dot')?.classList.contains('ok')`, 30000, 'app connected (mock)');

// ---------- 1. initial expanded state ----------
const noHdrGlyph = await cdp.eval(`document.querySelectorAll('.proj-header .fld, .proj-header .chev, .proj-folder').length`);
check('项目 header carries no leading glyph (aligns with 任务)', noHdrGlyph === 0);
const groupFoldersOpen = await cdp.eval(`[...document.querySelectorAll('.session-group-label .fld')].every(f => f.classList.contains('open'))`);
check('group folders open while groups expanded', groupFoldersOpen === true);
const currentRowOpen = await cdp.eval(`document.querySelector('.project-item.current .fld').classList.contains('open')`);
check('current project row folder open', currentRowOpen === true);
const otherRowsClosed = await cdp.eval(`[...document.querySelectorAll('.project-item:not(.current) .fld')].every(f => !f.classList.contains('open'))`);
check('other project rows folder closed', otherRowsClosed === true);
const currentTint = await cdp.eval(`getComputedStyle(document.querySelector('.project-item.current .fld')).color`);
console.log('[e2e] current project folder color:', currentTint);
check('current project folder tinted accent', /250, 178, 131|250\s*178\s*131|fab283/i.test(currentTint), currentTint);
await screenshot(cdp, 'folder-1-expanded.png');

// ---------- 2. collapse the 项目 module ----------
await cdp.eval(`document.querySelector('.proj-header').click()`);
await sleep(400);
const projListHidden = await cdp.eval(`document.querySelectorAll('.project-item').length === 0`);
check('project list hidden while folded', projListHidden === true);
await screenshot(cdp, 'folder-2-collapsed.png');

// ---------- 3. expand again ----------
await cdp.eval(`document.querySelector('.proj-header').click()`);
await sleep(400);
const projListBack = await cdp.eval(`document.querySelectorAll('.project-item').length === 3`);
check('project list back after unfold', projListBack === true);
await screenshot(cdp, 'folder-3-expanded-again.png');

// ---------- 4. collapse / expand a session group ----------
await cdp.eval(`document.querySelectorAll('.session-group-label')[0].click()`);
await sleep(400);
const g1 = await cdp.eval(`(() => {
  const label = document.querySelectorAll('.session-group-label')[0];
  const fld = label.querySelector('.fld');
  const chev = label.querySelector('.chev');
  return {
    folderOpen: fld.classList.contains('open'),
    chevOpen: chev.classList.contains('open'),
    chevTransform: getComputedStyle(chev).transform,
    groupRows: label.parentElement.querySelectorAll('.session-item').length,
  };
})()`);
check('group 1 folder closed after collapse', g1.folderOpen === false);
// Collapsed chevron carries no rotation → computed 'none'; open = rotate(90deg).
check('group 1 chevron at rest (collapsed)', g1.chevOpen === false && g1.chevTransform === 'none', g1.chevTransform);
check('group 1 sessions hidden', g1.groupRows === 0);
await screenshot(cdp, 'folder-4-group-collapsed.png');

await cdp.eval(`document.querySelectorAll('.session-group-label')[0].click()`);
await sleep(400);
const g2 = await cdp.eval(`(() => {
  const label = document.querySelectorAll('.session-group-label')[0];
  return {
    folderOpen: label.querySelector('.fld').classList.contains('open'),
    chevOpen: label.querySelector('.chev').classList.contains('open'),
    chevTransform: getComputedStyle(label.querySelector('.chev')).transform,
    rows: label.parentElement.querySelectorAll('.session-item').length,
  };
})()`);
check('group 1 folder open after expand', g2.folderOpen === true);
check('group 1 chevron open', g2.chevOpen === true);
check('group 1 chevron rotated 90deg (open)', /matrix\(0, 1, -1, 0, 0, 0\)/.test(g2.chevTransform), g2.chevTransform);
check('group 1 sessions visible again', g2.rows === 5);
await screenshot(cdp, 'folder-5-group-expanded.png');

// ---------- 5. accent tint on the current group's open folder ----------
const curTint = await cdp.eval(`getComputedStyle(document.querySelector('.session-group-label.current .fld')).color`);
check('current group folder tinted accent when open', /250, 178, 131/.test(curTint), curTint);
// Collapse the current group → tint must disappear (DSH: expanded && containsCurrent).
await cdp.eval(`document.querySelector('.session-group-label.current').click()`);
await sleep(400);
const curTintCollapsed = await cdp.eval(`getComputedStyle(document.querySelector('.session-group-label.current .fld')).color`);
console.log('[e2e] current group folder color while collapsed:', curTintCollapsed);
check('current group tint cleared while collapsed', !/250, 178, 131/.test(curTintCollapsed), curTintCollapsed);
await screenshot(cdp, 'folder-6-current-collapsed.png');

// ---------- 6. SVG glyphs actually paint (non-empty, sized) ----------
const bbox = await cdp.eval(`(() => {
  const s = document.querySelector('.session-group-label .fld');
  const r = s.getBoundingClientRect();
  return { w: r.width, h: r.height, paths: s.querySelectorAll('path').length };
})()`);
console.log('[e2e] group folder box:', JSON.stringify(bbox));
check('group folder renders ~12px', Math.abs(bbox.w - 12) < 1 && Math.abs(bbox.h - 12) < 1, JSON.stringify(bbox));
check('folder svg has 3 paths', bbox.paths === 3, String(bbox.paths));

// ---------- 7. glyphs actually paint (canvas pixel probe) ----------
const paint = await cdp.eval(`(async () => {
  const probe = async (sel) => {
    const svg = document.querySelector(sel);
    svg.style.color = getComputedStyle(svg).color; // resolve currentColor for standalone SVG
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;base64,' + btoa(xml); });
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); // white bg so glyph pixels register
    g.drawImage(img, 8, 8, 48, 48);
    const d = g.getImageData(0, 0, 64, 64).data;
    let painted = 0; const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const [r, g2, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 245 && g2 > 245 && b > 245) continue; // bg
      painted++;
      colors.add((r >> 4) + ',' + (g2 >> 4) + ',' + (b >> 4));
    }
    return { painted, shades: colors.size };
  };
  const closed = await probe('.session-group-label.collapsed .fld');
  const open = await probe('.session-group-label:not(.collapsed) .fld');
  return { closed, open };
})()`);
console.log('[e2e] paint probe:', JSON.stringify(paint));
check('closed group folder paints pixels', paint.closed.painted > 300, String(paint.closed.painted));
check('open group folder paints pixels', paint.open.painted > 300, String(paint.open.painted));
check('folder glyphs use layered shades (back/front)', paint.closed.shades >= 2 && paint.open.shades >= 2, JSON.stringify(paint.closed.shades) + '/' + JSON.stringify(paint.open.shades));

const failed = passes.filter((p) => !p.ok).length;
console.log(`[e2e] ${passes.length - failed}/${passes.length} checks passed`);
cdp.close();
chrome.kill();
process.exit(failed ? 1 : 0);
