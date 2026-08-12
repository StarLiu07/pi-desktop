// Thin wrapper around Tauri IPC for the pi RPC bridge.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PiEvent } from './types';

export interface SessionListItem {
  id: string;
  name: string | null;
  timestamp: string | null;
  cwd: string | null;
  message_count: number;
  file: string;
  path: string;
  last_message_id: string | null;
}

/** Send one JSONL request object to the pi subprocess. */
export function sendRpc(request: Record<string, unknown>): Promise<void> {
  return invoke('send_rpc', { request });
}

export function stopPi(): Promise<void> {
  return invoke('stop_pi');
}

export function startPi(): Promise<void> {
  return invoke('start_pi');
}

export function piInstalled(): Promise<boolean> {
  return invoke('pi_installed');
}

export function listSessions(): Promise<SessionListItem[]> {
  return invoke('list_sessions');
}

/** Subscribe to the pi event stream. Returns an unlisten function. */
export function onPiEvent(cb: (event: PiEvent) => void): Promise<UnlistenFn> {
  return listen<PiEvent>('pi-event', (ev) => cb(ev.payload));
}

/** Subscribe to free-form pi stderr logs (provider catalogs, warnings…). */
export function onPiStderr(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>('pi-stderr', (ev) => cb(ev.payload));
}
