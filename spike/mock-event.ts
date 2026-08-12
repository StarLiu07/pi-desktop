// Browser-side stand-in for @tauri-apps/api/event — subscribes to the mock
// bridge's SSE streams (same-origin via the vite proxy).
// Used only by the smoke-test vite config.
const BASE = '';

export interface UnlistenFn {
  (): void;
}

type EventCallback<T> = (event: { payload: T }) => void;

function subscribe<T>(path: string, cb: EventCallback<T>): Promise<UnlistenFn> {
  const es = new EventSource(`${BASE}/${path}`);
  es.onmessage = (ev) => {
    try {
      cb({ payload: JSON.parse(ev.data) });
    } catch {
      /* drop malformed lines */
    }
  };
  return Promise.resolve(() => es.close());
}

export function listen<T>(event: string, cb: EventCallback<T>): Promise<UnlistenFn> {
  if (event === 'pi-event') return subscribe('events', cb);
  if (event === 'pi-stderr') return subscribe('stderr', cb);
  return Promise.resolve(() => undefined);
}
