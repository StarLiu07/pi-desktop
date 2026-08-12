// RPC probe #3: verify new_session / switch_session semantics for tab switching.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-rpc-probe3-'));
const PI_ENTRY = 'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = '';
let sessionFileA = null;
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
        if (msg.command === 'get_state' && msg.success) {
          const f = msg.data?.sessionFile;
          console.log('[STATE] sessionFile=' + f + (f === sessionFileA ? ' (A)' : ''));
          if (!sessionFileA) sessionFileA = f;
        } else {
          console.log('[RESP] ' + JSON.stringify(msg).slice(0, 220));
        }
      } else if (msg.type === 'agent_end') {
        console.log('[AGENT_END]');
      }
    } catch {}
  }
});
child.stderr.on('data', () => {});
child.on('exit', () => process.exit(0));

const send = (req) => {
  console.log('[REQ] ' + JSON.stringify(req).slice(0, 200));
  child.stdin.write(JSON.stringify(req) + '\n');
};
const at = (ms, fn) => setTimeout(fn, ms);

at(3000, () => send({ id: 's1', type: 'get_state' }));
at(6000, () => send({ id: 's2', type: 'new_session' }));
at(9000, () => send({ id: 's3', type: 'get_state' }));
at(12000, () => send({ id: 's4', type: 'prompt', message: 'Reply with exactly: hi', streamingBehavior: 'follow-up' }));
at(30000, () => send({ id: 's5', type: 'get_state' }));
// Try switching back to session A by file name
at(33000, () => {
  const fileA = sessionFileA?.split(/[\\/]/).pop();
  console.log('[INFO] switching back to file: ' + fileA);
  send({ id: 's6', type: 'switch_session', sessionPath: fileA });
});
at(36000, () => send({ id: 's7', type: 'get_state' }));
at(40000, () => send({ id: 's8', type: 'get_messages' }));
at(44000, () => { child.kill(); });
