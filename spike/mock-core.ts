// Browser-side stand-in for @tauri-apps/api/core — routes invoke() calls to
// spike/mock-server.mjs over HTTP (same-origin via the vite proxy).
// Used only by the smoke-test vite config.
const BASE = '';

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'pi_installed': {
      const r = await fetch(`${BASE}/installed`);
      const d = await r.json();
      return d.ok === true;
    }
    case 'send_rpc': {
      await fetch(`${BASE}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args?.request ?? {}),
      });
      return;
    }
    case 'list_sessions': {
      const r = await fetch(`${BASE}/sessions`);
      return r.json();
    }
    case 'list_projects': {
      const r = await fetch(`${BASE}/projects`);
      return r.json();
    }
    case 'set_project': {
      await fetch(`${BASE}/set-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: args?.dir }),
      });
      return;
    }
    case 'pick_project': {
      const r = await fetch(`${BASE}/pick-project`);
      return r.json();
    }
    case 'stop_pi':
    case 'start_pi': {
      await fetch(`${BASE}/stop`);
      return;
    }
    default:
      throw new Error(`mock invoke: unhandled command ${cmd}`);
  }
}
