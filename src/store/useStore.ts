// Central state: maps the pi RPC event stream onto session tabs, messages and tool cards.
import { create } from 'zustand';
import {
  listProjects,
  listSessions,
  nameSessions,
  onPiEvent,
  onPiStderr,
  piInstalled,
  sendRpc,
  setProject,
  startPi,
  stopPi,
  type SessionListItem,
} from '../rpc/bridge';
import type {
  ChatMessage,
  ModelInfo,
  PiEvent,
  RpcResponse,
} from '../rpc/types';

let reqCounter = 0;
const nextId = () => `req-${++reqCounter}`;

/** Resolvers for in-flight RPC requests, keyed by request id. */
const pending = new Map<string, (resp: RpcResponse) => void>();

/** How long to wait for a response before resolving with success:false. */
const RPC_TIMEOUT_MS = 30_000;

/** Subscribe to the pi event stream only once, even across retries. */
let subscribed = false;

/** Rolling log of pi stderr + lifecycle events, shown in the settings modal. */
const MAX_LOG_LINES = 500;

export interface ToolExecState {
  id: string; // toolCallId
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result: string;
}

export interface SessionTab {
  /** uuid from pi; null until the first prompt creates the session file */
  sessionId: string | null;
  /** absolute session file path — required by `switch_session` */
  sessionPath: string | null;
  name: string;
  messages: ChatMessage[];
  /** tool calls keyed by toolCallId, rendered as cards inside the assistant message */
  toolExecs: Record<string, ToolExecState>;
  /** the assistant message currently being streamed, or null */
  streaming: ChatMessage | null;
  /** user text shown optimistically until message_start(user) lands */
  pendingUserText: string | null;
  agentActive: boolean;
  turnActive: boolean;
  willRetry: boolean;
  notice: string | null;
}

export type AppStatus = 'connecting' | 'ready' | 'error' | 'installing';

interface Store {
  status: AppStatus;
  error: string;
  sessions: SessionListItem[]; // session tree from disk
  /** current project (workspace folder); null until one is chosen */
  currentProject: string | null;
  /** recently used project folders, newest first */
  recentProjects: string[];
  /** a pi restart (project switch / retry) is in flight — ignore pi_exit */
  restarting: boolean;
  models: ModelInfo[];
  currentModel: ModelInfo | null;
  thinkingLevel: string;
  tabs: SessionTab[];
  activeTabIndex: number;
  settingsOpen: boolean;
  /** add-project dialog visibility (opened from the project selector menu) */
  addProjectOpen: boolean;
  /** pi stderr + lifecycle log lines, newest last */
  logs: string[];
  /** an AI naming run is in flight (batch or auto) */
  naming: boolean;

  init(): Promise<void>;
  refreshSessions(): Promise<void>;
  refreshProjects(): Promise<void>;
  setProject(dir: string): Promise<void>;
  newSession(): Promise<void>;
  openSessionFromHistory(sess: SessionListItem): Promise<void>;
  forkSession(): Promise<void>;
  closeTab(index: number): void;
  activateTab(index: number): Promise<void>;
  renameActiveSession(name: string): Promise<void>;
  /** Name just the active session after its first turn (agent_settled). */
  maybeAutoNameActiveSession(): Promise<void>;
  /** Merge naming results into sessions and matching tabs. */
  applyNames(results: Array<{ path: string; name: string | null }>): void;
  sendPrompt(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  retryConnection(): Promise<void>;
  setSettingsOpen(open: boolean): void;
  openAddProject(): void;
  closeAddProject(): void;
}

function emptyTab(): SessionTab {
  return {
    sessionId: null,
    sessionPath: null,
    name: '新会话',
    messages: [],
    toolExecs: {},
    streaming: null,
    pendingUserText: null,
    agentActive: false,
    turnActive: false,
    willRetry: false,
    notice: null,
  };
}

/** Session display label: real name → first user message → neutral placeholder.
 *  Never the timestamped file name — Z-Code/OpenCode style, where an untitled
 *  chat shows "New Chat" until the first exchange earns it a title. */
function labelOf(name: string | null | undefined, preview: string | null | undefined): string {
  if (name) return name;
  if (preview) return preview;
  return '新会话';
}

/** Send a request and resolve with the matching response (or a timeout failure). */
async function rpc(req: Record<string, unknown>): Promise<RpcResponse> {
  const id = nextId();
  const promise = new Promise<RpcResponse>((resolve) => {
    pending.set(id, resolve);
    // Never hang forever: pi may have crashed between send and response.
    setTimeout(() => {
      if (pending.delete(id)) {
        resolve({
          id,
          type: 'response',
          command: String(req.type),
          success: false,
          error: 'RPC 超时：pi 未在 30s 内响应',
        });
      }
    }, RPC_TIMEOUT_MS);
  });
  await sendRpc({ id, ...req }).catch(() => {
    pending.delete(id);
    throw new Error('无法发送请求（pi 进程可能已退出）');
  });
  return promise;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const o = c as Record<string, unknown>;
          return typeof o.text === 'string' ? o.text : JSON.stringify(c);
        }
        return '';
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

export const useStore = create<Store>((set, get) => {
  /** Append a timestamped log line, keeping the ring bounded. */
  const log = (line: string) => {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    set((s) => ({ logs: [...s.logs.slice(-(MAX_LOG_LINES - 1)), `[${stamp}] ${line}`] }));
  };

  /** Replace the active tab via a mutator. */
  const updateTab = (fn: (t: SessionTab) => SessionTab) => {
    set((s) => {
      const tabs = [...s.tabs];
      if (!tabs[s.activeTabIndex]) return s;
      tabs[s.activeTabIndex] = fn(tabs[s.activeTabIndex]);
      return { ...s, tabs };
    });
  };

  /** Bind the active tab to the session pi is on right now.
   *
   *  pi's event stream carries NO event with the session file (only
   *  `get_state` knows it), so a tab that creates its session via
   *  `new_session` would otherwise never learn its own file — and every
   *  prompt would spawn a fresh session: each message lands in its own
   *  file and the assistant loses all previous context. */
  const learnActiveSession = async () => {
    const state = await rpc({ type: 'get_state' }).catch(() => null);
    if (!state?.success || !state.data) return;
    const d = state.data as Record<string, unknown>;
    if (!d.sessionFile) return;
    updateTab((t) => ({
      ...t,
      sessionId: (d.sessionId as string) ?? t.sessionId,
      sessionPath: d.sessionFile as string,
    }));
  };

  /** Sync pi's current session with the UI: fetch state + messages for the active tab. */
  const syncActiveSession = async () => {
    const tab = get().tabs[get().activeTabIndex];
    if (!tab || tab.sessionId == null) return;
    const state = await rpc({ type: 'get_state' }).catch(() => null);
    if (state?.success && state.data) {
      const d = state.data as Record<string, unknown>;
      set((s) => {
        const tabs = [...s.tabs];
        const t = tabs[s.activeTabIndex];
        if (!t) return s;
        return {
          ...s,
          tabs: Object.assign(tabs, {
            [s.activeTabIndex]: {
              ...t,
              sessionId: (d.sessionId as string) ?? t.sessionId,
              sessionPath: (d.sessionFile as string) ?? t.sessionPath,
              // get_state returns `sessionName` (undefined until named). Keep
              // the current label as-is instead of falling back to the file
              // name — session files are timestamped (`…T04-42-04-742Z_<uuid>`)
              // and make ugly tab labels.
              name: (d.sessionName as string) ?? t.name,
            },
          }),
          currentModel: (d.model as ModelInfo) ?? s.currentModel,
          thinkingLevel: (d.thinkingLevel as string) ?? s.thinkingLevel,
        };
      });
    }
    const msgs = await rpc({ type: 'get_messages' }).catch(() => null);
    if (msgs?.success && msgs.data) {
      const list = (msgs.data as { messages?: ChatMessage[] }).messages;
      if (list) updateTab((t) => ({ ...t, messages: list }));
    }
  };

  const handleEvent = (raw: PiEvent) => {
    // Protocol was calibrated against real pi output (spike/); index access is safe.
    const e = raw as unknown as Record<string, any>;
    switch (e.type) {
      case 'response': {
        const resolve = pending.get(e.id);
        if (resolve) {
          pending.delete(e.id);
          resolve(e as RpcResponse);
        }
        break;
      }
      case 'agent_start':
        updateTab((t) => ({ ...t, agentActive: true, willRetry: false }));
        break;
      case 'turn_start':
        updateTab((t) => ({ ...t, turnActive: true }));
        break;
      case 'message_start': {
        const m = e.message;
        if (m.role === 'user') {
          updateTab((t) => ({
            ...t,
            pendingUserText: null,
            messages: [...t.messages, m],
          }));
        } else if (m.role === 'assistant') {
          updateTab((t) => ({ ...t, streaming: m }));
        } else if (m.role === 'toolResult') {
          updateTab((t) => ({ ...t, messages: [...t.messages, m] }));
        }
        break;
      }
      case 'message_update':
        // The event carries the full snapshot — use it directly.
        updateTab((t) => (t.streaming ? { ...t, streaming: e.message } : t));
        break;
      case 'message_end': {
        const m = e.message;
        if (m.role === 'assistant') {
          updateTab((t) => {
            if (!t.streaming) return t;
            return { ...t, messages: [...t.messages, t.streaming], streaming: null };
          });
        }
        break;
      }
      case 'tool_execution_start':
        updateTab((t) => ({
          ...t,
          toolExecs: {
            ...t.toolExecs,
            [e.toolCallId]: {
              id: e.toolCallId,
              name: e.toolName,
              args: e.args ?? {},
              status: 'running',
              result: '',
            },
          },
        }));
        break;
      case 'tool_execution_update':
        updateTab((t) => {
          const cur = t.toolExecs[e.toolCallId];
          if (!cur) return t;
          const delta = e.partialResult ? textOf(e.partialResult.content) : '';
          return {
            ...t,
            toolExecs: {
              ...t.toolExecs,
              [e.toolCallId]: { ...cur, args: e.args ?? cur.args, result: delta },
            },
          };
        });
        break;
      case 'tool_execution_end':
        updateTab((t) => {
          const cur = t.toolExecs[e.toolCallId];
          if (!cur) return t;
          return {
            ...t,
            toolExecs: {
              ...t.toolExecs,
              [e.toolCallId]: {
                ...cur,
                status: e.isError ? 'error' : 'done',
                result: e.result ? textOf(e.result.content) : cur.result,
              },
            },
          };
        });
        break;
      case 'turn_end': {
        // `message` is already handled by message_start/message_end; the
        // `toolResults` array is NOT streamed as separate events — append it.
        updateTab((t) => {
          const results = Array.isArray(e.toolResults) ? e.toolResults : [];
          if (results.length === 0) return { ...t, turnActive: false };
          const seen = new Set(
            t.messages
              .filter((m) => m.role === 'toolResult' && m.toolCallId)
              .map((m) => m.toolCallId),
          );
          const fresh = results.filter(
            (m: ChatMessage) => m.toolCallId && !seen.has(m.toolCallId),
          );
          return {
            ...t,
            turnActive: false,
            messages: [...t.messages, ...fresh],
          };
        });
        break;
      }
      case 'agent_end': {
        updateTab((t) => {
          const snapshot = e.messages;
          // The event carries the authoritative full message list — use it to
          // reconcile any drift (retries, tool results). Guard against a
          // turn-local snapshot replacing a longer session history.
          const useSnapshot =
            Array.isArray(snapshot) && snapshot.length >= t.messages.length;
          return {
            ...t,
            agentActive: false,
            willRetry: e.willRetry,
            streaming: null,
            ...(useSnapshot ? { messages: snapshot } : {}),
          };
        });
        break;
      }
      case 'agent_settled':
        updateTab((t) => ({ ...t, agentActive: false }));
        get().refreshSessions();
        // New conversation: give the session a real title after the first turn.
        get().maybeAutoNameActiveSession();
        break;
      case 'session_info_changed':
        if (e.name) {
          updateTab((t) => ({ ...t, name: e.name }));
          get().refreshSessions();
        }
        if (e.model) set({ currentModel: e.model });
        if (e.thinkingLevel) set({ thinkingLevel: e.thinkingLevel });
        break;
      case 'auto_retry_start':
        updateTab((t) => ({ ...t, notice: '自动重试中…' }));
        break;
      case 'auto_retry_end':
      case 'auto_compaction_start':
      case 'auto_compaction_end':
        updateTab((t) => ({ ...t, notice: null }));
        break;
      case 'pi_error':
        log(`pi 错误: ${e.message}`);
        set({ status: 'error', error: e.message });
        break;
      case 'pi_exit':
        // Drop every in-flight resolver: nothing will ever answer them.
        pending.clear();
        log('pi 进程已退出');
        // A deliberate restart (project switch / retry) handles its own
        // state — only surface an unexpected death as an error.
        if (!get().restarting) {
          set({ status: 'error', error: 'pi 进程已退出' });
        }
        break;
      default:
        break;
    }
  };

  return {
    status: 'connecting',
    error: '',
    sessions: [],
    currentProject: null,
    recentProjects: [],
    restarting: false,
    models: [],
    currentModel: null,
    thinkingLevel: 'medium',
    tabs: [emptyTab()],
    activeTabIndex: 0,
    settingsOpen: false,
    addProjectOpen: false,
    logs: [],
    naming: false,

    init: async () => {
      const installed = await piInstalled().catch(() => false);
      if (!installed) {
        set({ status: 'installing' });
        return;
      }
      if (!subscribed) {
        subscribed = true;
        await onPiEvent(handleEvent);
        onPiStderr((line) => log(line)).catch(() => undefined);
      }
      log('正在连接 pi 进程…');
      const state = await rpc({ type: 'get_state' }).catch(() => null);
      if (!state?.success) {
        set({ status: 'error', error: '无法连接 pi 进程' });
        return;
      }
      const d = state.data as Record<string, unknown>;
      set({
        status: 'ready',
        currentModel: (d.model as ModelInfo) ?? null,
        thinkingLevel: (d.thinkingLevel as string) ?? 'medium',
      });
      if (d.sessionId) {
        set((s) => {
          const tabs = [...s.tabs];
          tabs[0] = {
            ...tabs[0],
            sessionId: d.sessionId as string,
            sessionPath: (d.sessionFile as string) ?? null,
            // Neutral placeholder — the real label (name ?? first user
            // message) is merged in from the session tree after the
            // refreshSessions() below. Never the timestamped file name.
          };
          return { tabs };
        });
        await syncActiveSession();
      }
      await get().refreshSessions();
      // Restored session: mirror the history-list label onto the tab so it
      // shows the real name (or first message) instead of the file name.
      const restoredPath = (d.sessionFile as string) ?? null;
      if (restoredPath) {
        const meta = get().sessions.find((s) => s.path === restoredPath);
        if (meta) {
          const label = labelOf(meta.name, meta.preview);
          set((s) => {
            const tabs = [...s.tabs];
            const t = tabs[0];
            if (t && t.sessionPath === restoredPath) tabs[0] = { ...t, name: label };
            return { tabs };
          });
        }
      }
      await get().refreshProjects();
      const models = await rpc({ type: 'get_available_models' }).catch(() => null);
      if (models?.success && models.data) {
        const list = (models.data as { models?: ModelInfo[] }).models;
        if (list) set({ models: list });
      }
    },

    refreshSessions: async () => {
      const sessions = await listSessions().catch(() => [] as SessionListItem[]);
      set({ sessions });
    },

    refreshProjects: async () => {
      const state = await listProjects().catch(() => null);
      if (state) {
        set({ currentProject: state.current, recentProjects: state.recent });
      }
    },

    setProject: async (dir) => {
      if (get().restarting) return;
      // '' (no project) and null (never picked) are the same UI state.
      if (dir === (get().currentProject ?? '')) return;
      set({ restarting: true, status: 'connecting', error: '' });
      try {
        await setProject(dir);
        // pi restarted: no active session on the new process — start fresh.
        set({ tabs: [emptyTab()], activeTabIndex: 0 });
        await get().init();
        await get().refreshProjects();
      } catch (err) {
        set({ status: 'error', error: String(err) });
      } finally {
        set({ restarting: false });
      }
    },

    openAddProject: () => set({ addProjectOpen: true }),
    closeAddProject: () => set({ addProjectOpen: false }),

    newSession: async () => {
      // Stop any running agent first — pi handles one agent at a time, and a
      // prompt on the fresh tab would silently abort the current one.
      const cur = get().tabs[get().activeTabIndex];
      if (cur?.agentActive) {
        await rpc({ type: 'abort' }).catch(() => null);
      }
      // pi creates the new session file on the next prompt; open an empty tab now.
      await rpc({ type: 'new_session' }).catch(() => null);
      set((s) => {
        const tabs = [...s.tabs, emptyTab()];
        return { tabs, activeTabIndex: tabs.length - 1 };
      });
      // Bind the new tab to the session pi just created — see learnActiveSession.
      await learnActiveSession();
    },

    closeTab: (index) => {
      const { tabs, activeTabIndex } = get();
      const closing = tabs[index];
      // Never leave the agent running on a session we're about to drop.
      if (closing?.agentActive) rpc({ type: 'abort' }).catch(() => null);
      if (tabs.length === 1) {
        // Closing the last tab opens a fresh session.
        rpc({ type: 'new_session' }).catch(() => null);
        set({ tabs: [emptyTab()], activeTabIndex: 0 });
        return;
      }
      const remaining = tabs.filter((_, i) => i !== index);
      let active = activeTabIndex;
      if (index === activeTabIndex) active = Math.min(active, remaining.length - 1);
      set({ tabs: remaining, activeTabIndex: active });
      get().activateTab(active);
    },

    activateTab: async (index) => {
      const { tabs, activeTabIndex } = get();
      const target = tabs[index];
      if (!target) return;
      const current = tabs[activeTabIndex];
      // Only skip when the pi process is already on this exact session.
      if (
        index === activeTabIndex &&
        current?.sessionPath === target.sessionPath &&
        current?.sessionId === target.sessionId
      ) {
        return;
      }
      // Stop the current agent before switching away.
      if (current?.agentActive) {
        rpc({ type: 'abort' }).catch(() => null);
      }
      set({ activeTabIndex: index });
      if (target.sessionPath) {
        await rpc({ type: 'switch_session', sessionPath: target.sessionPath }).catch(() => null);
        await syncActiveSession();
      } else if (target.sessionId) {
        // History sessions carry a uuid but no path yet — resolve it via get_state.
        await rpc({ type: 'switch_session', sessionPath: target.sessionId }).catch(() => null);
        await syncActiveSession();
      } else {
        // Empty tab: make sure pi's next prompt lands in a fresh session,
        // and bind this tab to it — see learnActiveSession.
        await rpc({ type: 'new_session' }).catch(() => null);
        await learnActiveSession();
      }
    },

    openSessionFromHistory: async (sess) => {
      const { tabs } = get();
      const existing = tabs.findIndex((t) => t.sessionId === sess.id);
      if (existing >= 0) {
        await get().activateTab(existing);
        return;
      }
      const tab: SessionTab = {
        ...emptyTab(),
        sessionId: sess.id,
        sessionPath: sess.path,
        name: labelOf(sess.name, sess.preview),
      };
      // Do NOT pre-set activeTabIndex here: activateTab's "already on this
      // session" guard compares against the current active tab, and a fresh
      // tab always matches itself — the switch_session/get_messages load
      // would be skipped and the chat would stay empty.
      set((s) => ({ tabs: [...s.tabs, tab] }));
      await get().activateTab(tabs.length);
    },

    forkSession: async () => {
      const tab = get().tabs[get().activeTabIndex];
      if (!tab?.sessionId) return;
      await get().refreshSessions();
      const sess = get().sessions.find((s) => s.id === tab.sessionId);
      if (!sess?.last_message_id) {
        updateTab((t) => ({ ...t, notice: '该会话还没有可 fork 的消息' }));
        return;
      }
      const resp = await rpc({ type: 'fork', entryId: sess.last_message_id }).catch(() => null);
      if (resp?.success) {
        // pi now points at the forked session; open it in a new tab.
        await get().refreshSessions();
        const forked = get().sessions[0];
        if (forked) {
          await get().openSessionFromHistory(forked);
        } else {
          updateTab((t) => ({ ...t, notice: 'fork 失败：未找到新会话' }));
        }
      } else {
        updateTab((t) => ({ ...t, notice: `fork 失败：${resp?.error ?? '未知错误'}` }));
      }
    },

    renameActiveSession: async (name) => {
      await rpc({ type: 'set_session_name', name }).catch(() => null);
    },

    /** Apply naming results to the session list and any matching open tabs. */
    applyNames: (results: Array<{ path: string; name: string | null }>) => {
      const byPath = new Map(results.filter((r) => r.name).map((r) => [r.path, r.name as string]));
      if (byPath.size === 0) return;
      set({ sessions: get().sessions.map((s) => (byPath.has(s.path) ? { ...s, name: byPath.get(s.path)! } : s)) });
      set((s) => ({
        tabs: s.tabs.map((t) => (t.sessionPath && byPath.has(t.sessionPath) ? { ...t, name: byPath.get(t.sessionPath)! } : t)),
      }));
    },

    maybeAutoNameActiveSession: async () => {
      if (get().naming) return;
      const tab = get().tabs[get().activeTabIndex];
      if (!tab?.sessionPath) return;
      // Skip when the session already carries a real name in the tree.
      if (get().sessions.find((s) => s.path === tab.sessionPath)?.name) return;
      set({ naming: true });
      const results = await nameSessions([tab.sessionPath]).catch(() => null);
      set({ naming: false });
      if (results) get().applyNames(results);
    },

    sendPrompt: async (text) => {
      const tab = get().tabs[get().activeTabIndex];
      if (!tab || tab.agentActive) return;
      updateTab((t) => ({ ...t, pendingUserText: text, agentActive: true }));
      if (!tab.sessionPath) {
        // First message of a fresh tab: ensure a new session file is created.
        await rpc({ type: 'new_session' }).catch(() => null);
        // Learn which file that is BEFORE prompting, or the next message in
        // this tab would create yet another session — see learnActiveSession.
        await learnActiveSession();
      }
      await rpc({
        type: 'prompt',
        message: text,
        streamingBehavior: 'follow-up',
      }).catch((err: unknown) => {
        // Roll back the optimistic user text on failure, not just the spinner.
        updateTab((t) => ({
          ...t,
          agentActive: false,
          pendingUserText: null,
          notice: String(err),
        }));
      });
    },

    abort: async () => {
      await rpc({ type: 'abort' }).catch(() => null);
    },

    setModel: async (key) => {
      // Key = `${provider}::${id}` (model ids collide across providers, so
      // the selector keys on provider+id; see modelKey in InputBar.tsx).
      const sep = key.indexOf('::');
      const provider = sep >= 0 ? key.slice(0, sep) : '';
      const modelId = sep >= 0 ? key.slice(sep + 2) : key;
      const model = get().models.find(
        (m) => m.id === modelId && (m.provider ?? '') === provider,
      );
      if (!model) return;
      await rpc({ type: 'set_model', provider: model.provider, modelId: model.id }).catch(() => null);
      const state = await rpc({ type: 'get_state' }).catch(() => null);
      if (state?.success) {
        set({ currentModel: (state.data as Record<string, unknown>).model as ModelInfo });
      }
    },

    setThinkingLevel: async (level) => {
      set({ thinkingLevel: level });
      await rpc({ type: 'set_thinking_level', level }).catch(() => null);
    },

    retryConnection: async () => {
      set({ status: 'connecting', error: '', restarting: true });
      await stopPi().catch(() => null);
      await startPi().catch(() => null);
      await get().init();
      set({ restarting: false });
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});
