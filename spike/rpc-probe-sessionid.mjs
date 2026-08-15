// RPC probe: does pi's get_state return the session header id after
// switch_session, and does it accept a non-uuid header id at all?
// Seeds one file with uuid header id + one with a fake 'aaaa0003' id.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-probe-sid-'));
const PI_ENTRY = 'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

const realUuid = randomUUID();
const mk = (file, id, cwd) => {
  const t = '2026-08-10T09:00:00.000Z';
  writeFileSync(join(sessionDir, file), [
    JSON.stringify({ type: 'session', version: 3, id, timestamp: t, cwd }),
    JSON.stringify({ type: 'session_info', id: id + '-i', parentId: id, timestamp: t, name: '探针会话' }),
    JSON.stringify({ type: 'message', id: id + '-m', parentId: id + '-i', timestamp: t, message: { role: 'user', content: [{ type: 'text', text: '探针内容' }] } }),
  ].join('\n') + '\n');
};
mk(`2026-08-10T09-00-00-000Z_${realUuid}.jsonl`, realUuid, 'C:\\Users\\Sheldon');
mk('fake-id.jsonl', 'aaaa0003', 'D:\\pi-desktop');

const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = '';
const pending = [];
const rpc = (o) => {
  pending.push(o);
  child.stdin.write(JSON.stringify(o) + '\n');
};
let gotState = 0;
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'response' && msg.command === 'get_state') {
        gotState++;
        console.log(`[STATE ${gotState}] sessionId=${msg.data?.sessionId} success=${msg.success}`);
      } else if (msg.type === 'response' && msg.command !== 'get_state') {
        console.log('[RESP] ' + JSON.stringify(msg).slice(0, 140));
      }
    } catch {}
  }
});
child.on('exit', () => process.exit(0));

setTimeout(() => rpc({ id: 's1', type: 'get_state' }), 1500);
setTimeout(() => rpc({ id: 's2', type: 'switch_session', sessionPath: join(sessionDir, 'fake-id.jsonl') }), 2500);
setTimeout(() => rpc({ id: 's3', type: 'get_state' }), 4000);
setTimeout(() => rpc({ id: 's4', type: 'switch_session', sessionPath: join(sessionDir, `2026-08-10T09-00-00-000Z_${realUuid}.jsonl`) }), 5500);
setTimeout(() => rpc({ id: 's5', type: 'get_state' }), 7000);
setTimeout(() => child.kill(), 9000);
