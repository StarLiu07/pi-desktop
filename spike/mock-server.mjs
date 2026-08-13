// Mock bridge backend for Pi Desktop UI smoke tests (spike/).
// Spawns a real pi RPC process and exposes it over HTTP+SSE so the frontend
// can run in a plain browser with `vite.mock.config.ts`.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 4321);
const PI_ENTRY = process.env.PI_ENTRY ||
  'C:/Users/Sheldon/AppData/Local/hermes/node/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';

process.on('uncaughtException', (e) => {
  console.error('[mock] UNCAUGHT:', e.stack || e);
  process.exit(1);
});
process.on('exit', (code) => console.log(`[mock] mock-server exiting (${code})`));

const sessionDir = mkdtempSync(join(tmpdir(), 'pi-mock-bridge-'));

// Seed the session dir with fixture sessions (MOCK_FIXTURES_DIR) so the
// sidebar shows cross-project groups immediately.
if (process.env.MOCK_FIXTURES_DIR) {
  for (const f of readdirSync(process.env.MOCK_FIXTURES_DIR)) {
    if (f.endsWith('.jsonl')) copyFileSync(join(process.env.MOCK_FIXTURES_DIR, f), join(sessionDir, f));
  }
  console.log('[mock] seeded fixtures into', sessionDir);
}

// Mock project store: { current, recent } like the real projects.json.
const projectState = { current: null, recent: [] };
const pickResult = process.env.MOCK_PICK_DIR || process.cwd();

function spawnPi(cwd) {
  const proc = spawn(process.execPath, [PI_ENTRY, '--mode', 'rpc', '--session-dir', sessionDir], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const t = JSON.parse(line).type;
        if (['agent_end', 'agent_settled', 'turn_end', 'pi_exit'].includes(t)) {
          console.log(`[mock] EVENT ${t}`);
        }
      } catch {}
      for (const c of eventClients) c.write(`data: ${line}\n\n`);
    }
  });
  proc.stderr.on('data', (d) => {
    errBuf += d.toString();
    let idx;
    while ((idx = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, idx).trim();
      errBuf = errBuf.slice(idx + 1);
      if (!line) continue;
      for (const c of stderrClients) c.write(`data: ${JSON.stringify(line)}\n\n`);
    }
  });
  // Only exit the bridge when the CURRENT pi process dies (a restart kills
  // the old one on purpose).
  proc.on('exit', (code) => {
    if (proc !== childRef.current) return;
    console.log(`[mock] pi exited (${code})`);
    process.exit(0);
  });
  return proc;
}
const childRef = { current: null };
childRef.current = spawnPi(undefined);
console.log(`[mock] pi spawned (pid ${childRef.current.pid}, cwd ${process.cwd()}), session-dir ${sessionDir}`);

const eventClients = new Set();
const stderrClients = new Set();

let buf = '';
let errBuf = '';

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
    // Parse name/preview/cwd from each file like the real list_sessions.
    const out = files.map((file) => {
      let name = null, preview = null, timestamp = null, cwd = null;
      try {
        for (const line of readFileSync(join(sessionDir, file), 'utf8').split('\n')) {
          if (!line) continue;
          const v = JSON.parse(line);
          if (v.type === 'session') {
            if (typeof v.cwd === 'string') cwd = v.cwd;
            if (typeof v.timestamp === 'string') timestamp = v.timestamp;
          } else if (v.type === 'session_info') {
            if (typeof v.name === 'string' && v.name.trim()) name = v.name.trim();
          } else if (v.type === 'message' && v.message?.role === 'user' && preview === null) {
            const text = (v.message.content || [])
              .filter((p) => typeof p.text === 'string')
              .map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
            if (text) preview = text.slice(0, 40);
          }
        }
      } catch {}
      return { id: file.replace(/\.jsonl$/, ''), name, preview, timestamp, cwd, message_count: 0, file, path: join(sessionDir, file), last_message_id: null };
    });
    res.end(JSON.stringify(out));
  } else if (path === '/projects') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projectState));
  } else if (path === '/set-project') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { dir } = JSON.parse(body || '{}');
      if (typeof dir !== 'string') {
        res.writeHead(400);
        res.end('bad dir');
        return;
      }
      if (dir === '') {
        // No-project mode: clear current, restart pi with the default cwd.
        projectState.current = null;
        childRef.current.kill();
        childRef.current = spawnPi(undefined);
        console.log(`[mock] set-project '' -> pi restarted (pid ${childRef.current.pid}, no project)`);
        res.writeHead(200);
        res.end();
        return;
      }
      projectState.recent = [dir, ...projectState.recent.filter((d) => d !== dir)].slice(0, 8);
      projectState.current = dir;
      // Restart pi with the new cwd, like the real set_project command.
      childRef.current.kill();
      childRef.current = spawnPi(dir);
      console.log(`[mock] set-project ${dir} -> pi restarted (pid ${childRef.current.pid})`);
      res.writeHead(200);
      res.end();
    });
  } else if (path === '/pick-project') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pickResult));
  } else if (path === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      childRef.current.stdin.write(body + '\n');
      res.writeHead(202);
      res.end();
    });
  } else if (path === '/stop') {
    childRef.current.kill();
    res.writeHead(200);
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => console.log(`[mock] bridge on http://localhost:${PORT}`));
