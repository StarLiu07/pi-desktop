// Quick probe: render the sidebar with REAL session data (mock seeded from the
// real session dir) and dump the group structure, then screenshot.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:4322/';
const PORT = 9225;

const userData = mkdtempSync(join(tmpdir(), 'pi-e2e-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
  '--user-data-dir=' + userData, '--no-first-run', '--disable-gpu',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('CDP unreachable');
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
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

const main = async () => {
  await sleep(1500);
  const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  for (let i = 0; i < 120; i++) {
    const st = await evalJs(cdp, `document.querySelector('.status-state')?.textContent`);
    if (st === 'pi 已连接') break;
    await sleep(500);
  }
  await sleep(1000);
  const dump = await evalJs(cdp, `(() => {
    const groups = [...document.querySelectorAll('.session-group')].map((g) => ({
      label: g.querySelector('.session-group-label .label')?.textContent,
      cur: !!g.querySelector('.session-group-label .cur'),
      items: [...g.querySelectorAll('.session-item .name')].map((n) => n.textContent),
    }));
    const flat = [...document.querySelectorAll('.session-tree > .session-item .name')].map((n) => n.textContent);
    return JSON.stringify({ groups, flat }, null, 1);
  })()`);
  console.log(dump);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join('spike', 'project', '7-realsessions.png'), Buffer.from(r.data, 'base64'));
  console.log('[shot] 7-realsessions.png');
  await cdp.send('Browser.close');
  process.exit(0);
};
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
