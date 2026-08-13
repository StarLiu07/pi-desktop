// RPC probe: no-project mode — spawn pi WITHOUT a cwd (exactly what
// start_pi_with_cwd(app, None) does when 无项目 is selected) and run one
// prompt through the full event flow.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-rpc-noproject-'));
// NOTE: no cwd option passed — pi inherits the launcher cwd (no project bound).
const PI_ENTRY = 'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});

let buf = '';
const events = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
});
child.stderr.on('data', (d) => process.stderr.write('[pi-stderr] ' + d));
child.on('exit', (code) => {
  console.log('\n[pi exited] code=' + code);
  process.exit(0);
});

const send = (req) => {
  console.log('[REQ] ' + JSON.stringify(req));
  child.stdin.write(JSON.stringify(req) + '\n');
};
const at = (ms, fn) => setTimeout(fn, ms);

const summarized = (m) => {
  switch (m.type) {
    case 'response':
      return `response command=${m.command} success=${m.success}${m.error ? ' error=' + m.error : ''}`;
    case 'message_start':
      return `message_start role=${m.message?.role}`;
    case 'message_update':
      return `message_update len=${(m.message?.content ?? []).length}`;
    case 'message_end':
      return `message_end role=${m.message?.role}`;
    case 'tool_execution_start':
      return `tool_start ${m.toolName} id=${String(m.toolCallId).slice(0, 8)}`;
    case 'tool_execution_end':
      return `tool_end ${m.toolName} id=${String(m.toolCallId).slice(0, 8)} isError=${m.isError}`;
    case 'turn_end':
      return `turn_end toolResults=${Array.isArray(m.toolResults) ? m.toolResults.length : 0}`;
    case 'agent_end':
      return `agent_end willRetry=${m.willRetry} msgs=${Array.isArray(m.messages) ? m.messages.length : '?'}`;
    default:
      return m.type;
  }
};

const dump = () => {
  console.log('\n=== EVENT SEQUENCE ===');
  events.forEach((e) => console.log(summarized(e)));
};

at(2000, () => send({ id: 'n1', type: 'get_state' }));
at(4000, () => send({ id: 'n2', type: 'new_session' }));
at(6000, () => send({ id: 'n3', type: 'prompt', message: '你好，这是一条无项目模式的测试消息。请只回复一句话。', streamingBehavior: 'follow-up' }));
at(9000, () => send({ id: 'n4', type: 'get_state' }));
at(12000, () => send({ id: 'n5', type: 'get_messages' }));
at(15000, () => { dump(); child.kill(); });
at(20000, () => { console.log('[TIMEOUT]'); dump(); child.kill(); });
