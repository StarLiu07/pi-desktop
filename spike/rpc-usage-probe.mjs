// RPC probe: verify usage (tokens/cache/cost) arrives on assistant messages
// via message_end / agent_end / get_messages.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-usage-probe-'));
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
      if (msg.type === 'message_end' || (msg.type === 'agent_end' && msg.messages)) {
        const msgs = msg.messages ?? [msg.message];
        for (const m of msgs) {
          if (m?.role === 'assistant') {
            console.log(
              `[${msg.type}] assistant usage=`,
              JSON.stringify(m.usage ?? null),
              ' stopReason=' + (m.stopReason ?? '?'),
            );
          }
        }
      }
      if (msg.type === 'response' && msg.command === 'get_messages') {
        for (const m of msg.data?.messages ?? []) {
          if (m.role === 'assistant')
            console.log('[get_messages] assistant usage=', JSON.stringify(m.usage ?? null));
        }
        console.log('[get_messages] done');
        child.kill();
        process.exit(0);
      }
    } catch {}
  }
});
child.stderr.on('data', () => {});
child.on('exit', () => process.exit(0));

const send = (req) => child.stdin.write(JSON.stringify(req) + '\n');
setTimeout(() => send({ id: 'u1', type: 'prompt', message: 'Reply with exactly: one', streamingBehavior: 'follow-up' }), 3000);
setTimeout(() => send({ id: 'u2', type: 'get_messages' }), 30000);
setTimeout(() => { child.kill(); }, 40000);
