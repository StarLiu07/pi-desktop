// Scripted fake bridge for the scroll-follow regression (spike/e2e-scroll.mjs).
// No real pi: on the first `prompt` RPC it replays a deterministic assistant
// turn — long thinking block streamed while open, long text streamed after,
// then message_end (which collapses the thinking block in the UI). The UI
// boots from the same /installed + /rpc + /sessions + /projects endpoints the
// real mock bridge serves, so `vite.mock.config.ts` works unchanged.
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

// ---- scripted assistant turn --------------------------------------------
// Enough content to overflow the chat viewport (window 1280x900): the reply
// must scroll to be fully visible.
const wrap = (text, width) => {
  const out = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.join('\n');
};
const THINK_FULL = wrap(
  '让我先分析这个需求。用户想要一个能自动跟随滚动到消息底部的聊天界面，'
    .repeat(30)
    .replaceAll(' ', ''),
  44,
);
const TEXT_FULL = wrap(
  '好的，我已经完成了修改。下面是具体的实现方式与验证结果。'
    .repeat(70)
    .replaceAll(' ', ''),
  58,
);

const mkMsg = (thinking, text) => ({
  role: 'assistant',
  content: [
    { type: 'thinking', thinking },
    { type: 'text', text },
  ],
  model: 'deepseek-v4-flash',
});

async function streamReply() {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  emit({ type: 'agent_start' });
  await delay(250);
  emit({
    type: 'message_start',
    message: { role: 'user', content: [{ type: 'text', text: '帮我改进聊天界面的自动滚动' }] },
  });
  await delay(250);
  // Thinking streams first (block open while streaming).
  emit({ type: 'message_start', message: mkMsg('', '') });
  const thinkSteps = 4;
  for (let i = 1; i <= thinkSteps; i++) {
    await delay(420);
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'x' },
      message: mkMsg(THINK_FULL.slice(0, Math.floor((THINK_FULL.length * i) / thinkSteps)), ''),
    });
  }
  // Then the reply text streams.
  const textSteps = 6;
  for (let i = 1; i <= textSteps; i++) {
    await delay(420);
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'x' },
      message: mkMsg(THINK_FULL, TEXT_FULL.slice(0, Math.floor((TEXT_FULL.length * i) / textSteps))),
    });
  }
  // Turn completes: streaming stops -> thinking block collapses.
  await delay(420);
  emit({ type: 'message_end', message: mkMsg(THINK_FULL, TEXT_FULL) });
  await delay(200);
  emit({
    type: 'agent_end',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '帮我改进聊天界面的自动滚动' }] },
      mkMsg(THINK_FULL, TEXT_FULL),
    ],
    willRetry: false,
  });
  emit({ type: 'agent_settled' });
  console.log('[scroll-server] scripted turn done');
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
      console.log(`[scroll-server] rpc ${req.type}`);
      res.writeHead(202);
      res.end();
      switch (req.type) {
        case 'get_state':
          respond(req, true, {
            sessionId: 's1',
            sessionFile: 'C:/tmp/pi-scroll-test.jsonl',
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
          setTimeout(streamReply, 300);
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

server.listen(PORT, () => console.log(`[scroll-server] fake bridge on http://localhost:${PORT}`));
