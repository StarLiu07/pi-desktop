// RPC probe #6: fork with a real entryId from the session file, mirroring the app flow.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-rpc-probe6-'));
const PI_ENTRY = 'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'response' && msg.command === 'fork') {
        console.log('[FORK_RESP] success=' + msg.success + ' error=' + (msg.error ?? 'none'));
      }
      if (msg.type === 'response' && msg.command === 'get_state') {
        console.log('[STATE] sessionFile=' + (msg.data?.sessionFile ?? '?').split(/[\\/]/).pop());
      }
      if (msg.type === 'agent_end') console.log('[AGENT_END]');
    } catch {}
  }
});
child.stderr.on('data', () => {});
child.on('exit', () => process.exit(0));

const send = (req) => child.stdin.write(JSON.stringify(req) + '\n');
const at = (ms, fn) => setTimeout(fn, ms);

// Phase 1: create a session with one real message
at(3000, () => send({ id: 'g1', type: 'prompt', message: 'Reply with exactly: one', streamingBehavior: 'follow-up' }));
// Phase 2: read the last message id from the session file (like Rust list_sessions)
at(30000, () => {
  const file = readdirSync(sessionDir).find((f) => f.endsWith('.jsonl'));
  const content = readFileSync(join(sessionDir, file), 'utf8');
  let lastId = null;
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const v = JSON.parse(line);
      if (v.type === 'message' && v.id) lastId = v.id;
    } catch {}
  }
  console.log('[FILE] last message id: ' + lastId);
  // fork from the last USER message (the branch point), not the assistant reply
  let lastUserId = null;
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const v = JSON.parse(line);
      if (v.type === 'message' && v.message?.role === 'user' && v.id) lastUserId = v.id;
    } catch {}
  }
  console.log('[FILE] last user message id: ' + lastUserId);
  send({ id: 'g2', type: 'fork', entryId: lastUserId ?? lastId });
});
at(33000, () => send({ id: 'g3', type: 'get_state' }));
at(38000, () => { child.kill(); });
