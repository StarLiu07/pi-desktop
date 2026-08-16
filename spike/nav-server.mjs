// Scripted fake bridge for the message-rail probe (spike/probe-message-nav.mjs).
// No real pi: every `prompt` RPC replays a deterministic turn — a user message
// plus an assistant reply whose length grows with the turn number, so the four
// turns spread across the scrollable content and the rail markers land at
// different heights. Serves the same /installed + /rpc + /sessions + /projects
// contract as mock-server.mjs, so `vite.mock.config.ts` works unchanged.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4321);

const eventClients = new Set();
const pendingRpc = []; // rpc response lines buffered until an SSE client connects

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

const wrap = (text, width) => {
  const out = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.join('\n');
};

let turnCount = 0;
const userTexts = [
  '标记一 第一轮对话',
  '标记二 第二轮对话',
  '标记三 第三轮对话',
  '标记四 第四轮对话',
];

async function streamTurn(text) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const turn = ++turnCount;
  // 模拟用户实际会话形态:前三轮是短消息(用户连发、回复仅一两行),第四轮
  // 回复超长——用户消息都挤在内容顶部、下面一大段 AI 输出,与用户截图里
  // "3 条用户消息挤在顶部 + 长回复"的会话一致;rail 标记应聚成紧凑小簇。
  // turnCount 跨多次探针运行持续累加,用 % 4 而不是 === 4 判断。
  const reply = wrap(`这是第 ${turn} 轮的脚本化回复。`.repeat(turn % 4 === 0 ? 400 : 8).replaceAll(' ', ''), 40);
  const assistant = (body) => ({
    role: 'assistant',
    content: [{ type: 'text', text: body }],
    model: 'deepseek-v4-flash',
  });
  emit({ type: 'agent_start' });
  await delay(150);
  emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text }] } });
  await delay(200);
  emit({ type: 'message_start', message: assistant('') });
  await delay(150);
  emit({ type: 'message_update', message: assistant(reply.slice(0, Math.floor(reply.length / 2))) });
  await delay(150);
  emit({ type: 'message_update', message: assistant(reply) });
  await delay(150);
  emit({ type: 'message_end', message: assistant(reply) });
  await delay(150);
  emit({
    type: 'agent_end',
    messages: [
      { role: 'user', content: [{ type: 'text', text }] },
      assistant(reply),
    ],
    willRetry: false,
  });
  emit({ type: 'agent_settled' });
  console.log(`[nav-server] turn ${turn} done (${text})`);
}

// ---- HTTP endpoints (same contract as mock-server.mjs) -------------------
const server = createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path === '/events') {
    eventClients.add(sse(res));
    req.on('close', () => eventClients.delete(res));
    flush();
  } else if (path === '/stderr') {
    eventClients.add(sse(res)); // unused by the UI; keep the connection open
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
      console.log(`[nav-server] rpc ${req.type}`);
      res.writeHead(202);
      res.end();
      switch (req.type) {
        case 'get_state':
          respond(req, true, {
            sessionId: 's1',
            sessionFile: 'C:/tmp/pi-nav-test.jsonl',
            model: { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', api: 'deepseek', provider: 'deepseek', reasoning: true },
            thinkingLevel: 'medium',
          });
          break;
        case 'get_messages':
          respond(req, true, { messages: [] });
          break;
        case 'get_available_models':
          respond(req, true, { models: [] });
          break;
        case 'prompt':
          respond(req, true, {});
          setTimeout(() => streamTurn(String(req.message ?? '')), 200);
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

server.listen(PORT, () => console.log(`[nav-server] fake bridge on http://localhost:${PORT}`));
