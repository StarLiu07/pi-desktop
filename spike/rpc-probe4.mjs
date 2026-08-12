// RPC probe #4: calibrate the `fork` command semantics.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-rpc-probe4-'));
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
      if (msg.type === 'response') {
        console.log('[RESP] ' + JSON.stringify(msg).slice(0, 300));
      } else if (msg.type === 'session_info_changed') {
        console.log('[INFO_CHANGED] ' + JSON.stringify(msg).slice(0, 200));
      }
    } catch {}
  }
});
child.stderr.on('data', () => {});
child.on('exit', () => process.exit(0));

const send = (req) => {
  console.log('[REQ] ' + JSON.stringify(req));
  child.stdin.write(JSON.stringify(req) + '\n');
};
const at = (ms, fn) => setTimeout(fn, ms);

at(3000, () => send({ id: 'f1', type: 'get_state' }));
at(6000, () => send({ id: 'f2', type: 'fork' })); // no entryId
at(9000, () => send({ id: 'f3', type: 'get_state' }));
at(12000, () => send({ id: 'f4', type: 'get_messages' }));
at(15000, () => send({ id: 'f5', type: 'get_state' }));
at(18000, () => { child.kill(); });
