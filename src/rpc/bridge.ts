// Thin wrapper around Tauri IPC for the pi RPC bridge.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PiEvent } from './types';

export interface SessionListItem {
  id: string;
  name: string | null;
  /** Display fallback for unnamed sessions (first user message, truncated). */
  preview: string | null;
  timestamp: string | null;
  cwd: string | null;
  message_count: number;
  file: string;
  path: string;
  last_message_id: string | null;
}

export interface NameResult {
  path: string;
  name: string | null;
  error: string | null;
}

/** Current project + recent projects (absolute folder paths). */
export interface ProjectsState {
  current: string | null;
  recent: string[];
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

/** Generate display names for the given session files (uses the pi default
 *  model via a Node helper; already-named sessions are skipped). */
export function nameSessions(paths: string[]): Promise<NameResult[]> {
  return invoke('name_sessions', { paths });
}

/** Current project + recent projects. */
export function listProjects(): Promise<ProjectsState> {
  return invoke('list_projects');
}

/** Switch the project: persists it and restarts pi with the new cwd. */
export function setProject(dir: string): Promise<null> {
  return invoke('set_project', { dir });
}

/** Native folder picker; resolves null when cancelled. */
export function pickProject(): Promise<string | null> {
  return invoke('pick_project');
}

/** Exists/is-dir check for a typed path in the add-project dialog. */
export interface ProjectPathInfo {
  exists: boolean;
  is_dir: boolean;
}

export function projectPathInfo(dir: string): Promise<ProjectPathInfo> {
  return invoke('project_path_info', { dir });
}

/** Create the project folder (add-project's "创建并添加" flow). Idempotent. */
export function createProjectDir(dir: string): Promise<null> {
  return invoke('create_project_dir', { dir });
}

/** Subscribe to the pi event stream. Returns an unlisten function. */
export function onPiEvent(cb: (event: PiEvent) => void): Promise<UnlistenFn> {
  return listen<PiEvent>('pi-event', (ev) => cb(ev.payload));
}

/** Subscribe to free-form pi stderr logs (provider catalogs, warnings…). */
export function onPiStderr(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>('pi-stderr', (ev) => cb(ev.payload));
}
