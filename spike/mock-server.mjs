// Mock bridge backend for Pi Desktop UI smoke tests (spike/).
// Spawns a real pi RPC process and exposes it over HTTP+SSE so the frontend
// can run in a plain browser with `vite.mock.config.ts`.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 4321);
const PI_ENTRY = process.env.PI_ENTRY ||
  'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-mock-bridge-'));
const child = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1' },
});
console.log(`[mock] pi spawned (pid ${child.pid}), session-dir ${sessionDir}`);

const eventClients = new Set();
const stderrClients = new Set();

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    for (const c of eventClients) c.write(`data: ${line}\n\n`);
  }
});
let errBuf = '';
child.stderr.on('data', (d) => {
  errBuf += d.toString();
  let idx;
  while ((idx = errBuf.indexOf('\n')) >= 0) {
    const line = errBuf.slice(0, idx).trim();
    errBuf = errBuf.slice(idx + 1);
    if (!line) continue;
    for (const c of stderrClients) c.write(`data: ${JSON.stringify(line)}\n\n`);
  }
});
child.on('exit', (code) => {
  console.log(`[mock] pi exited (${code})`);
  process.exit(0);
});

const sse = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  return res;
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/installed') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } else if (path === '/events') {
    eventClients.add(sse(res));
    req.on('close', () => eventClients.delete(res));
  } else if (path === '/stderr') {
    stderrClients.add(sse(res));
    req.on('close', () => stderrClients.delete(res));
  } else if (path === '/sessions') {
    const files = readdirSync(sessionDir).filter((f) => f.endsWith('.jsonl'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files.map((file) => ({ id: file, name: null, timestamp: null, cwd: null, message_count: 0, file, path: join(sessionDir, file), last_message_id: null }))));
  } else if (path === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      child.stdin.write(body + '\n');
      res.writeHead(202);
      res.end();
    });
  } else if (path === '/stop') {
    child.kill();
    res.writeHead(200);
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => console.log(`[mock] bridge on http://localhost:${PORT}`));
