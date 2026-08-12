// Central state: maps the pi RPC event stream onto session tabs, messages and tool cards.
import { create } from 'zustand';
import {
  listSessions,
  onPiEvent,
  piInstalled,
  sendRpc,
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

/** Subscribe to the pi event stream only once, even across retries. */
let subscribed = false;

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
  models: ModelInfo[];
  currentModel: ModelInfo | null;
  thinkingLevel: string;
  tabs: SessionTab[];
  activeTabIndex: number;
  settingsOpen: boolean;

  init(): Promise<void>;
  refreshSessions(): Promise<void>;
  newSession(): Promise<void>;
  openSessionFromHistory(sess: SessionListItem): Promise<void>;
  forkSession(): Promise<void>;
  closeTab(index: number): void;
  activateTab(index: number): Promise<void>;
  renameActiveSession(name: string): Promise<void>;
  sendPrompt(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  retryConnection(): Promise<void>;
  setSettingsOpen(open: boolean): void;
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

/** Send a request and resolve with the matching response. */
async function rpc(req: Record<string, unknown>): Promise<RpcResponse> {
  const id = nextId();
  const promise = new Promise<RpcResponse>((resolve) => {
    pending.set(id, resolve);
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
  /** Replace the active tab via a mutator. */
  const updateTab = (fn: (t: SessionTab) => SessionTab) => {
    set((s) => {
      const tabs = [...s.tabs];
      if (!tabs[s.activeTabIndex]) return s;
      tabs[s.activeTabIndex] = fn(tabs[s.activeTabIndex]);
      return { ...s, tabs };
    });
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
              name: (d.name as string) ?? t.name ?? t.sessionPath?.split(/[\\/]/).pop() ?? t.name,
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
      case 'turn_end':
        updateTab((t) => ({ ...t, turnActive: false }));
        break;
      case 'agent_end':
        updateTab((t) => ({ ...t, agentActive: false, willRetry: e.willRetry }));
        break;
      case 'agent_settled':
        updateTab((t) => ({ ...t, agentActive: false }));
        get().refreshSessions();
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
        set({ status: 'error', error: e.message });
        break;
      case 'pi_exit':
        set({ status: 'error', error: 'pi 进程已退出' });
        break;
      default:
        break;
    }
  };

  return {
    status: 'connecting',
    error: '',
    sessions: [],
    models: [],
    currentModel: null,
    thinkingLevel: 'medium',
    tabs: [emptyTab()],
    activeTabIndex: 0,
    settingsOpen: false,

    init: async () => {
      const installed = await piInstalled().catch(() => false);
      if (!installed) {
        set({ status: 'installing' });
        return;
      }
      if (!subscribed) {
        subscribed = true;
        await onPiEvent(handleEvent);
      }
      set({ status: 'connecting' });
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
            name: (d.sessionFile as string)?.split(/[\\/]/).pop() ?? '会话',
          };
          return { tabs };
        });
        await syncActiveSession();
      }
      await get().refreshSessions();
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

    newSession: async () => {
      // pi creates the new session file on the next prompt; open an empty tab now.
      await rpc({ type: 'new_session' }).catch(() => null);
      set((s) => {
        const tabs = [...s.tabs, emptyTab()];
        return { tabs, activeTabIndex: tabs.length - 1 };
      });
    },

    closeTab: (index) => {
      const { tabs, activeTabIndex } = get();
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
        // Empty tab: make sure pi's next prompt lands in a fresh session.
        await rpc({ type: 'new_session' }).catch(() => null);
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
        name: sess.name ?? sess.file,
      };
      set((s) => {
        const next = [...s.tabs, tab];
        return { tabs: next, activeTabIndex: next.length - 1 };
      });
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

    sendPrompt: async (text) => {
      const tab = get().tabs[get().activeTabIndex];
      if (!tab || tab.agentActive) return;
      updateTab((t) => ({ ...t, pendingUserText: text, agentActive: true }));
      if (!tab.sessionPath) {
        // First message of a fresh tab: ensure a new session file is created.
        await rpc({ type: 'new_session' }).catch(() => null);
      }
      await rpc({
        type: 'prompt',
        message: text,
        streamingBehavior: 'follow-up',
      }).catch((err: unknown) => {
        updateTab((t) => ({ ...t, agentActive: false, notice: String(err) }));
      });
    },

    abort: async () => {
      await rpc({ type: 'abort' }).catch(() => null);
    },

    setModel: async (modelId) => {
      const model = get().models.find((m) => m.id === modelId);
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
      set({ status: 'connecting', error: '' });
      await stopPi().catch(() => null);
      await startPi().catch(() => null);
      await get().init();
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});
