// Scripted fake bridge for the session-binding regression (spike/e2e-sessionbind.mjs).
// No real pi. Counts and logs every RPC it receives, serves the same endpoints
// as mock-server.mjs, and scripts two deterministic assistant turns.
//
// The reported bug: messages sent in one fresh conversation each landed in a
// SEPARATE session file (one user message per file, context lost). Root cause:
// the tab never learned its own session file (pi emits no event carrying it),
// so `sendPrompt` re-sent `new_session` before EVERY message.
//
// This bridge makes the bug observable: get_state reports a sessionFile that
// increments with every new_session (`...-<n>.jsonl`). After the fix a fresh
// tab sends exactly ONE new_session, so both prompts see the SAME file.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4321);

const eventClients = new Set();
const pendingRpc = [];
const rpcLog = [];
let newSessionCount = 0;

function emit(obj) {
  const line = JSON.stringify(obj);
  for (const c of eventClients) c.write(`data: ${line}\n\n`);
}
function respond(req, success, data, error) {
  pendingRpc.push(JSON.stringify({ id: req.id, type: 'response', command: req.type, success, data, error }));
  flush();
}
function flush() {
  if (eventClients.size === 0 || pendingRpc.length === 0) return;
  for (const c of eventClients) for (const line of pendingRpc) c.write(`data: ${line}\n\n`);
  pendingRpc.length = 0;
}

const sse = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 1500\n\n');
  return res;
};

// ---- scripted assistant turn (one user message + one short reply) ----------
async function streamTurn(userText) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const reply = { role: 'assistant', content: [{ type: 'text', text: `回答：${userText}` }] };
  emit({ type: 'agent_start' });
  await delay(150);
  emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: userText }] } });
  await delay(150);
  emit({ type: 'message_start', message: { ...reply, content: [{ type: 'text', text: '' }] } });
  await delay(200);
  emit({ type: 'message_update', message: reply });
  await delay(200);
  emit({ type: 'message_end', message: reply });
  emit({
    type: 'agent_end',
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
      reply,
    ],
    willRetry: false,
  });
  emit({ type: 'agent_settled' });
  console.log('[bind-server] turn done:', userText);
}

// ---- HTTP endpoints (same contract as mock-server.mjs) ----------------------
const server = createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path === '/events') {
    eventClients.add(sse(res));
    req.on('close', () => eventClients.delete(res));
    flush();
  } else if (path === '/stderr') {
    eventClients.add(sse(res));
    req.on('close', () => eventClients.delete(res));
  } else if (path === '/installed') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } else if (path === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  } else if (path === '/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"current":null,"recent":[]}');
  } else if (path === '/rpc-log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpcLog));
  } else if (path === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let req;
      try {
        req = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      rpcLog.push({ type: req.type, message: req.message ?? null });
      console.log(`[bind-server] rpc ${req.type}`);
      res.writeHead(202);
      res.end();
      switch (req.type) {
        case 'get_state':
          // sessionFile increments with every new_session — the bug scatters
          // prompts across files, the fix keeps them on ...-1.jsonl.
          rpcLog[rpcLog.length - 1].sessionFile = `C:/tmp/pi-sessionbind-${newSessionCount}.jsonl`;
          respond(req, true, {
            sessionId: `sess-${newSessionCount}`,
            sessionFile: `C:/tmp/pi-sessionbind-${newSessionCount}.jsonl`,
            model: { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', api: 'deepseek', provider: 'deepseek', reasoning: true },
            thinkingLevel: 'medium',
          });
          break;
        case 'new_session':
          newSessionCount += 1;
          respond(req, true, { cancelled: false });
          break;
        case 'get_messages':
          respond(req, true, { messages: [] });
          break;
        case 'get_available_models':
          respond(req, true, { models: [] });
          break;
        case 'prompt':
          respond(req, true, {});
          const text = req.message ?? '?';
          setTimeout(() => streamTurn(text), 300);
          break;
        default:
          respond(req, true, {});
      }
    });
  } else if (path === '/stop') {
    res.writeHead(200);
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => console.log(`[bind-server] fake bridge on http://localhost:${PORT}`));
