/**
 * NEX AI — Universal Provider Architecture — Core Type Contracts (Phase P1)
 *
 * Final Contract v2.3 binding types. This module is PURE (no electron, no fs,
 * no persistence imports) so it is unit-testable in plain Node with zero mocks.
 *
 * Five-Concept Separation (binding):
 *   Provider ≠ Model ≠ Transport ≠ Capability ≠ Authentication
 *
 * Architectural axiom:
 *   NEX AI Core must never know provider names, provider protocols, provider
 *   authentication schemes, or provider-specific APIs. A provider is an adapter
 *   registered into the system, not a special case inside the system.
 */

// ─── Capability (what a model CAN do — orthogonal to provider) ──────────────

/**
 * Open-ended capability set. Well-known + `custom:*` extension convention.
 *
 * `streaming-text` is REAL streaming only (server-sent SSE chunks parsed as
 * they arrive). A provider that emulates streaming (full response → split by
 * newline) MUST NOT advertise this capability.
 */
export type Capability =
  | 'text'
  | 'streaming-text'
  | 'vision'
  | 'tool-calling'
  | 'realtime-voice'
  | 'embeddings'
  | 'image-generation'
  | `custom:${string}`;

// ─── ContentPart (Core-facing — may contain unresolved file references) ────

/**
 * Core-facing content part. The `file` variant has an unresolved `path` —
 * the ContentResolver (main-process service) resolves it to `TransportFileContent`
 * before the transport sees it. The transport NEVER receives this type directly.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; base64?: string; mimeType: string }
  | { type: 'file'; path: string; mimeType?: string }
  | { type: 'audio'; base64?: string; url?: string; mimeType: string; sampleRate?: number }
  | { type: 'tool_result'; toolCallId: string; content: string | ContentPart[] }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  ;

// ─── TransportFileContent (Transport-facing — NO arbitrary filesystem path) ─
/**
 * The transport-facing file content. The `path` field is deliberately ABSENT —
 * the transport MUST NOT receive arbitrary filesystem paths. The ContentResolver
 * (main-process service, behind the security boundary) reads the file and
 * produces `base64`. The transport uses only the resolved base64 content.
 *
 * Binding (v2.2 P0-2): Transport MUST NOT receive an arbitrary filesystem path.
 */
export type TransportFileContent =
  | { type: 'file'; base64: string; mimeType?: string }
  ;

// ─── ResolvedContentPart (Transport-facing — all content resolved) ─────────
/**
 * Transport-facing content part. All file references have been resolved to
 * `TransportFileContent` (base64, no path). The transport receives this type
 * via `ResolvedChatMessage[]` in `buildChatRequest`.
 */
export type ResolvedContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; base64?: string; mimeType: string }
  | TransportFileContent
  | { type: 'audio'; base64?: string; url?: string; mimeType: string; sampleRate?: number }
  | { type: 'tool_result'; toolCallId: string; content: string | ResolvedContentPart[] }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  ;

// ─── ResolvedFileReference (internal to ContentResolver — NOT transport-facing) ─
/**
 * Intermediate type used by the ContentResolver during resolution. Contains
 * the original `path` (for audit/logging) + resolved `base64`. This is NEVER
 * passed to the transport — the transport sees `TransportFileContent` (no path).
 */
export interface ResolvedFileReference {
  type: 'file';
  path: string;
  mimeType?: string;
  base64: string;
}

// ─── ChatMessage (Core-facing — hybrid content for backward compat) ─────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * Hybrid: `string` (backward-compat — all existing callers pass a string) OR
   * `ContentPart[]` (structured — for vision/tool-calling/file references).
   * The transport's buildChatRequest handles both forms.
   */
  content: string | ContentPart[];
}

// ─── ResolvedChatMessage (Transport-facing — file refs resolved) ───────────

export interface ResolvedChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ResolvedContentPart[];
}

// ─── Tool contracts ────────────────────────────────────────────────────────

/** A tool declaration passed to the model (for tool-calling capability). */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call REQUEST from the model (model wants to execute this tool).
 *  The transport returns this; the Agent/Core executes the tool via the
 *  existing Tool Registry + Permission System. The transport NEVER executes tools. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A tool RESULT (the execution outcome, sent back to the model).
 *  Uses ResolvedContentPart (no unresolved file paths). */
export interface ToolResult {
  toolCallId: string;
  content: string | ResolvedContentPart[];
  isError?: boolean;
}

// ─── ChatOptions / ChatResult / StreamChunk ────────────────────────────────

export interface ChatOptions {
  // Existing (backward-compat)
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stopSequences?: string[];
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  // NEW (optional — capability-gated)
  tools?: ToolDeclaration[];
  requestId?: number;
  model?: string;
  endpoint?: string;
  // NOTE: NO apiKey field — transport receives ResolvedAuth (resolved by
  // secret-resolver in the Main Security Boundary). The renderer NEVER sends
  // the key. Binding (v2.1 §4, v2.3 §4).
}

export interface ChatResult {
  content: string;
  tokensGenerated: number;
  modelId: string;
  modelName: string;
  stopped: boolean;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: 'stop' | 'length' | 'tool_call' | 'aborted' | 'content-filter';
  toolCalls?: ToolCall[];
}

export interface StreamChunk {
  /**
   * Optional text content. May be absent for tool-call deltas or empty keepalives.
   * NO caller may assume content is always present.
   * Binding invariant (v2.1 §3):
   *   - text chunk       → content present, toolCalls may be absent
   *   - tool-call event  → content may be absent, toolCalls present
   *   - done=true        → stream ended; no more chunks follow
   *   - empty keepalive  → content undefined, toolCalls undefined, done=false → ignore
   */
  content?: string;
  toolCalls?: ToolCall[];
  done: boolean;
  error?: string;
}

// ─── Transport contracts (capability-specific) ────────────────────────────

export interface RequestPlan {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChatParseResult {
  success: boolean;
  content?: string;
  toolCalls?: ToolCall[];
  error?: string;
  tokens?: number;
  finishReason?: ChatResult['finishReason'];
}

export interface StreamEvent {
  content?: string;
  toolCalls?: ToolCall[];
  done: boolean;
  error?: string;
}

/** REQUIRED for every provider — basic text chat.
 *  v2.2 binding: takes ResolvedChatMessage[], NOT ChatMessage[].
 *  The transport NEVER receives unresolved filesystem paths. */
export interface TextChatTransport {
  buildChatRequest(
    messages: ResolvedChatMessage[],
    opts: ChatOptions,
    auth: ResolvedAuth,
  ): RequestPlan;
  parseChatResponse(raw: string): ChatParseResult;
  /** Sanitize error messages — strip keys, URLs, tokens. Binding. */
  sanitizeError(raw: string): string;
}

/** OPTIONAL — only for providers with REAL 'streaming-text' capability.
 *  A provider that emulates streaming (full response → split) MUST NOT
 *  implement this interface and MUST NOT advertise 'streaming-text'. */
export interface StreamChatTransport extends TextChatTransport {
  /** Parse a single SSE line/chunk as it arrives (NOT the full body). */
  parseStreamChunk(line: string): StreamEvent;
  /** Marker — MUST be true. Registry enforces this at registration. */
  isStreaming: true;
}

/** OPTIONAL — only for providers with 'tool-calling' capability.
 *  v2.2 binding: takes ResolvedChatMessage[]. */
export interface ToolCallingTransport extends TextChatTransport {
  buildChatRequestWithTools(
    messages: ResolvedChatMessage[],
    tools: ToolDeclaration[],
    opts: ChatOptions,
    auth: ResolvedAuth,
  ): RequestPlan;
  parseChatResponseWithTools(raw: string): ChatParseResult;
}

/** OPTIONAL — only for providers with 'vision' capability.
 *  v2.2 binding: takes ResolvedChatMessage[] (images/files already resolved). */
export interface VisionTransport extends TextChatTransport {
  // buildChatRequest handles ResolvedContentPart[] in messages (images, resolved files).
  // Marker interface for capability detection + future vision-specific opts.
}

// ─── Authentication (v2.3 binding: secretId, NOT key; no custom in P1) ───────

/**
 * Authentication method (data only — NO functions, NO plaintext key).
 * The `secretId` is a string identifier passed to `getSecret()` in the Main
 * Security Boundary. The transport NEVER calls `getSecret` — it receives
 * `ResolvedAuth` (already-resolved credential).
 *
 * Binding (v2.1 §2, v2.3 §4):
 *   - `secretId` replaces `key`. The descriptor references a secret by its
 *     storage key; the transport receives the resolved credential.
 *   - `AuthMethod.custom` is REMOVED from P1 (functions cannot persist in
 *     config.json). OAuth/custom → P4 AuthProvider interface.
 *   - For `url-query`: the credential appears in the URL query string (the
 *     one documented exception for raw WebSocket). Binding (v2.3 §4 P1-1):
 *     the credential MUST NOT appear in logs, errors, telemetry, debug,
 *     persisted state, or IPC payload. Sent ONLY to validated targets.
 */
export type AuthMethod =
  | { type: 'bearer'; secretId: string }
  | { type: 'x-api-key'; secretId: string }
  | { type: 'x-goog-api-key'; secretId: string }
  | { type: 'url-query'; paramName: string; secretId: string }
  | { type: 'none' }
  ;

/** Resolved authentication (main-process-only — the transport sees THIS).
 *  The `credential` is the plaintext resolved by the Main Security Boundary
 *  via `getSecret(authMethod.secretId)`. The transport NEVER calls getSecret. */
export interface ResolvedAuth {
  credential: string;
}

// ─── Provider Descriptor + Registry types ──────────────────────────────────

export type ProviderId = string;
export type ProviderTrust = 'built-in' | 'user' | 'plugin';

export interface UserApproval {
  approvedBy: 'user';
  timestamp: number;
  approvedOrigins: string[];
}

export interface ProviderDescriptor {
  // Identity
  id: ProviderId;
  displayName: string;
  trust: ProviderTrust;

  // Capabilities (provider-level in P1; per-model in P3)
  capabilities: Set<Capability>;

  // Authentication (v2.3: secretId, ResolvedAuth resolved by Main Security Boundary)
  authMethod: AuthMethod;

  // Defaults (single source of truth)
  defaultModel: string;
  defaultEndpoint: string;
  availableModels?: string[];

  // Behavior (transports are pure — no fs, no persistence, no getSecret)
  transport: TextChatTransport;
  streamTransport?: StreamChatTransport;
  toolTransport?: ToolCallingTransport;
  visionTransport?: VisionTransport;

  // testConnection / fetchAvailableModels receive ProviderCallContext (ResolvedAuth),
  // NOT apiKey: string. Binding (v2.1 §5, v2.3 §5).
  testConnection?: (ctx: ProviderCallContext) => Promise<TestConnectionResult>;
  // fetchAvailableModels: P1 = TYPE/EXTENSION POINT ONLY (no implementation).
  //                      P4 = actual implementation + UI/flow.
  fetchAvailableModels?: (ctx: ProviderCallContext) => Promise<string[]>;

  // Security — validated by trust policy (NOT auto-added)
  allowedOrigins: string[];
}

export interface ProviderCallContext {
  auth: ResolvedAuth;
  endpoint: string;
  model: string;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
  modelName?: string;
}

// ─── Model Descriptor (P3 contract — NOT required for P1) ─────────────────

/**
 * P1: availableModels is a simple string[] on the provider descriptor.
 * P3: per-model capability override via ModelDescriptor.
 * This type is defined here for forward-compatibility but is NOT used in P1.
 */
export interface ModelDescriptor {
  id: string;
  capabilities?: Set<Capability>;
}
