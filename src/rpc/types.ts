// Pi RPC protocol types, calibrated against pi 0.83.0 via real probes (see spike/).
// Protocol: JSONL over stdio. Requests: {id, type: <command>, ...}.
// Responses: {id, type: "response", command, success, data, error?}.
// Events: {type: <event_name>, ...}.

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  api: string;
  baseUrl?: string;
  provider: string;
  reasoning: boolean;
  input: string[];
  cost?: ModelCost;
  contextWindow?: number;
  maxTokens?: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: ModelCost & { total: number };
}

/** A single part of a message's content. */
export interface ContentPart {
  type: string; // "text" | "thinking" | "toolCall" | "toolResult" | ...
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  /** toolCall id / toolResult toolCallId */
  id?: string;
  /** tool name for toolCall parts */
  name?: string;
  /** toolCall arguments (object) */
  arguments?: Record<string, unknown>;
  /** toolResult payload */
  content?: ContentPart[] | string;
  isError?: boolean;
  image?: string;
}

export interface ChatMessage {
  role: string; // "user" | "assistant" | "toolResult" | ...
  content: ContentPart[];
  timestamp?: number;
  api?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: string;
  responseId?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface SessionStateData {
  model?: ModelInfo;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  steeringMode?: string;
  followUpMode?: string;
  sessionFile?: string;
  sessionId?: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
}

export interface RpcResponse {
  id: string;
  type: 'response';
  command: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Sub-events of `message_update` that describe what changed. */
export type AssistantMessageEvent =
  | { type: 'thinking_start'; contentIndex: number }
  | { type: 'thinking_delta'; contentIndex: number; delta: string }
  | { type: 'thinking_end'; contentIndex: number; content: string }
  | { type: 'text_start'; contentIndex: number }
  | { type: 'text_delta'; contentIndex: number; delta: string }
  | { type: 'text_end'; contentIndex: number; content: string }
  | { type: 'toolcall_start' | 'toolcall_delta' | 'toolcall_end'; contentIndex: number; delta?: string };

export interface MessageUpdateEvent {
  type: 'message_update';
  assistantMessageEvent: AssistantMessageEvent;
  /** Full updated assistant message snapshot — prefer this over accumulating deltas. */
  message: ChatMessage;
}

export interface ToolExecStartEvent {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecUpdateEvent {
  type: 'tool_execution_update';
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  partialResult?: { content?: unknown[] };
}

export interface ToolExecEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  result?: { content?: unknown[] };
  isError?: boolean;
}

export interface SessionInfoChangedEvent {
  type: 'session_info_changed';
  name?: string;
  model?: ModelInfo;
  thinkingLevel?: string;
}

export type PiEvent =
  | RpcResponse
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: ChatMessage[]; willRetry: boolean }
  | { type: 'agent_settled' }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message?: ChatMessage; toolResults?: ChatMessage[] }
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'message_end'; message: ChatMessage }
  | MessageUpdateEvent
  | SessionInfoChangedEvent
  | ToolExecStartEvent
  | ToolExecUpdateEvent
  | ToolExecEndEvent
  | { type: 'auto_retry_start' | 'auto_retry_end' | 'auto_compaction_start' | 'auto_compaction_end' }
  | { type: 'pi_error'; message: string }
  | { type: 'pi_exit' }
  | { type: string; [key: string]: unknown };
