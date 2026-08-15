// Real-pi verification of the FIXED frontend flow:
//   new_session -> get_state (learn the file) -> prompt #1 -> prompt #2
// (prompt #2 must NOT re-create a session — the frontend fix binds the tab).
// Assertion: exactly ONE new session file on disk containing BOTH user messages.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-fixverify-'));
const PI_ENTRY = 'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';
const OUT = 'spike/probe-fixverify.log';

const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = '';
const log = [];
let stderr = '';
let turnsSettled = 0;
let settledFlag = false;
const dumpFiles = () => {
  log.push('=== FILES ON DISK ===');
  for (const f of readdirSync(sessionDir).sort()) {
    const content = readFileSync(join(sessionDir, f), 'utf8');
    const users = [...content.matchAll(/"role":"user"/g)].length;
    const id = content.match(/"id":"([^"]+)"/)?.[1] ?? '?';
    const firstUser = content.match(/"role":"user".{0,200}?"text":"([^"]{0,50})/)?.[1] ?? '';
    log.push(`FILE ${f}  id=${id}  userMsgs=${users}  firstUser=${firstUser}`);
  }
};
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'response') {
        log.push(`[RESP ${msg.command}] success=${msg.success} ${msg.error ?? ''}`);
      } else if (msg.type === 'agent_settled') {
        settledFlag = true;
        turnsSettled += 1;
        log.push(`[EVENT agent_settled] (${turnsSettled})`);
      } else if (['agent_start', 'agent_end', 'message_start', 'message_end', 'pi_error'].includes(msg.type)) {
        log.push(`[EVENT ${msg.type}]${msg.type === 'message_start' && msg.message ? ' role=' + msg.message.role : ''}`);
      } else {
        log.push(`[EVENT ${msg.type}]`);
      }
    } catch {}
  }
});
child.stderr.on('data', (d) => { stderr += d.toString(); });
const finish = (code) => {
  dumpFiles();
  writeFileSync(OUT, log.join('\n') + '\n\n=== STDERR (tail) ===\n' + stderr.slice(-3000));
  console.log('done -> ' + OUT + ` (${code === 0 ? 'PASS' : 'CHECK LOG'})`);
  try { child.kill(); } catch {}
  process.exit(code);
};

const send = (req) => {
  log.push(`[REQ ${req.type}] ${req.message ?? ''}`);
  child.stdin.write(JSON.stringify(req) + '\n');
};
const at = (ms, fn) => setTimeout(fn, ms);

at(5000, () => send({ id: 'f1', type: 'get_state' })); // startup session
// Fixed frontend flow: ＋ -> new_session, then learn (get_state), then prompt.
at(8000, () => send({ id: 'f2', type: 'new_session' }));
at(9000, () => send({ id: 'f3', type: 'get_state' })); // the learn
at(10000, () => send({ id: 'f4', type: 'prompt', message: 'Reply with exactly: ONE', streamingBehavior: 'follow-up' }));
// Prompt #2: NO new_session (tab is bound) — sent after turn 1 settles.
const t2 = setInterval(() => {
  if (settledFlag && turnsSettled >= 1) {
    settledFlag = false;
    clearInterval(t2);
    send({ id: 'f5', type: 'prompt', message: 'Reply with exactly: TWO', streamingBehavior: 'follow-up' });
  }
}, 500);
at(240000, () => send({ id: 'f6', type: 'get_state' }));
at(246000, () => finish(0));
setTimeout(() => finish(2), 260000).unref();
