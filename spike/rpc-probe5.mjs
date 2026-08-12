// RPC probe #5: does get_messages return message ids (needed for fork entryId)?
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-rpc-probe5-'));
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
        if (msg.command === 'get_messages' && msg.success) {
          const msgs = msg.data?.messages ?? [];
          console.log('[MESSAGES] count=' + msgs.length);
          if (msgs[0]) console.log('[MSG0] keys=' + Object.keys(msgs[0]).join(','));
        } else if (msg.command !== 'get_state') {
          console.log('[RESP] ' + JSON.stringify(msg).slice(0, 160));
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
  child.stdin.write(JSON.stringify(req) + '\n');
};
const at = (ms, fn) => setTimeout(fn, ms);

at(3000, () => send({ id: 'm1', type: 'prompt', message: 'Reply with exactly: fork-me', streamingBehavior: 'follow-up' }));
at(25000, () => send({ id: 'm2', type: 'get_messages' }));
at(30000, () => { child.kill(); });
