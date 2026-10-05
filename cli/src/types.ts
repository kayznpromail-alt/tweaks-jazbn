export interface PrivateMode {id:"astra-private"|"opus-private";revision:string;overheadTokens:number}

export interface Model {
  context?: import("./api/model-metadata").ModelContext;
  capabilities?: import("./api/model-metadata").ModelMetadata;
  id: string;
  owned_by?: string;
  reasoningEfforts?: ReasoningEffort[];
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Missing in legacy data: the original total's provenance is unknown. */
  totalSource?: "reported" | "calculated";
  cachedInputTokens?: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Deliberately bounded subset; unsupported json-schema keywords are rejected. */
export type ToolSchema = { description?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number } & (
  | { type: "object"; properties?: Record<string, ToolSchema>; required?: string[];
      additionalProperties?: boolean | ToolSchema }
  | { type: "array"; items: ToolSchema }
  | { type: "string" | "number" | "integer" | "boolean" | "null"; enum?: JsonPrimitive[] }
);

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: ToolSchema & { type: "object" };
  };
}

export type ToolChoice = "auto" | "none" | "required"
  | { type: "function"; function: { name: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Only returned after completion and schema validation; never a streamed fragment. */
export interface CompletedToolCall extends ToolCall {
  parsedArguments: { [key: string]: JsonValue };
}

export type WireMessage =
  | { role: "system" | "user"; content: string; images?: import("./media/images").ImageRef[]; tool_calls?: never; tool_call_id?: never }
  | { role: "assistant"; content: string; tool_calls?: never; tool_call_id?: never }
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[]; tool_call_id?: never }
  | { role: "tool"; content: string; tool_call_id: string; tool_calls?: never };

export interface Profile {
  id: string;
  name: string;
  version: string;
  instructions: string;
  models: string[];
  auto: boolean;
  default: boolean;
}

export interface Message {
  imagePositions?: number[];
  images?: import("./media/images").ImageRef[];
  context?: import("./agent/context-usage").ContextUsage;
  failure?: string;
  requestedMode?: PrivateMode;
  instructionVersion?: string;
  privateMode?: PrivateMode;
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "interrupted" | "error";
  createdAt: string;
  model?: string;
  profile?: { id: string; version: string };
  usage?: Usage;
}

export interface Session {
  privateMode?: PrivateMode;
  instructionSources?: import("./instructions/selection").InstructionSelection[];
  id: string;
  project: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  messages: Message[];
}

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}

export interface Settings {
  baseUrl: string;
  model: string | null;
  favorites: string[];
  lastProject?: string;
  recentModels?: string[];
}

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "interrupted" | "recovery_required";
export type RequestAttemptStatus = "pending" | "streaming" | "completed" | "failed" | "interrupted";
export type ToolExecutionStatus = "proposed" | "awaiting_approval" | "approved" | "denied" | "executing" | "succeeded" | "failed" | "cancelled" | "outcome_unknown";
export type ApprovalDecision = "approved" | "denied";

export interface Run {
  id: string;
  revision: number;
  sessionId: string;
  status: RunStatus;
  project: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  requestLimit?: number;
  toolLimit?: number;
  metadata?: JsonValue;
}

export interface CreateRunInput {
  id?: string;
  sessionId: string;
  status?: RunStatus;
  project: string;
  model: string;
  createdAt?: string;
  updatedAt?: string;
  requestLimit?: number;
  toolLimit?: number;
  metadata?: JsonValue;
}

export interface RequestAttempt {
  id: string;
  revision: number;
  runId: string;
  sequence: number;
  status: RequestAttemptStatus;
  model: string;
  context?: JsonValue;
  contextRef?: string;
  usage?: Usage;
  /** Sanitized response snapshot. No finishReason means partial, never executable context. */
  output?: RequestOutput;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface RequestOutput {
  validation?: { issues: import("./api/tool-validation").ToolValidationIssue[]; repair: number; exhausted?: boolean };
  repairAttempt?: number;
  content: string | null;
  /** Raw received text bytes, including a rejected over-budget delta; survives sanitization/retry. */
  receivedBytes?: number;
  finishReason?: string | null;
  toolCalls?: ToolCall[];
}

export interface CreateRequestAttemptInput {
  id?: string;
  runId: string;
  sequence: number;
  status?: RequestAttemptStatus;
  model: string;
  context?: JsonValue;
  contextRef?: string;
  usage?: Usage;
  output?: RequestOutput;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Mutations require a matching live parent-run lease; absence is rejected at runtime. */
  lease?: RunLease;
}

export interface RequestAttemptPatch {
  revision: number;
  status?: RequestAttemptStatus;
  model?: string;
  context?: JsonValue;
  contextRef?: string;
  usage?: Usage;
  output?: RequestOutput;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ToolExecution {
  activity?: import("./agent/activity-summary").ActivitySummary;
  id: string;
  revision: number;
  runId: string;
  requestId: string;
  sequence: number;
  callId: string;
  name: string;
  /** Registry-validated, caller-sanitized arguments. Storage rejects known credential shapes. */
  args: JsonObject;
  schemaVersion: string;
  status: ToolExecutionStatus;
  approvalScope?: string;
  approvalDecision?: ApprovalDecision;
  precondition?: JsonValue;
  /** Caller-sanitized result, at most 1 MiB of exact JSON. Also retains partial outcome_unknown evidence. */
  result?: JsonValue;
  outputArtifactRef?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CreateToolExecutionInput {
  id?: string;
  runId: string;
  requestId: string;
  sequence: number;
  callId: string;
  name: string;
  args: JsonObject;
  schemaVersion: string;
  status?: ToolExecutionStatus;
  approvalScope?: string;
  approvalDecision?: ApprovalDecision;
  precondition?: JsonValue;
  result?: JsonValue;
  outputArtifactRef?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Mutations require a matching live parent-run lease; absence is rejected at runtime. */
  lease?: RunLease;
}

export interface ToolExecutionPatch {
  revision: number;
  status?: ToolExecutionStatus;
  approvalScope?: string;
  approvalDecision?: ApprovalDecision;
  precondition?: JsonValue;
  result?: JsonValue;
  outputArtifactRef?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** A fresh fencing token is returned on every acquisition; never reuse an old callback's lease. */
export interface RunLease { ownerId: string; token: string }

/** Durable journal only. Reads/reopen never recover or execute work. Mutations use revision CAS.
 * Callers must await committed executing intent before effects, and committed results before continuation.
 * Recovery requires external liveness checks: an expired lease alone cannot stop a host process.
 */
export interface DurableStore {
  readTranscriptTool?(sessionId:string,id:string):ToolExecution|null;
  readTranscriptPage?(sessionId:string,offset:number|undefined,filter:import("./core/transcript").TranscriptFilter,limit:number,anchor?:string):{entries:import("./core/transcript").TranscriptEntry[];total:number;start:number;end:number;pageSize:number};
  listRuns(sessionId?: string): Run[];
  loadRun(id: string): Run | null;
  createRun(input: CreateRunInput): Run;
  /** Create and acquire in one transaction; ownership failure leaves no new run. */
  beginRun(input: CreateRunInput, ownerId: string, leaseMs: number): Run;
  updateRun(run: Run, lease?: RunLease): Run;
  acquireRunLease(runId: string, ownerId: string, leaseMs: number, revision: number): Run;
  renewRunLease(runId: string, lease: RunLease, leaseMs: number, revision: number, confirmLiveOwner?: () => true): Run;
  releaseRunLease(runId: string, lease: RunLease, revision: number): boolean;
  /** Explicit guarded recovery: interrupts requests, expires approvals and marks executing tools unknown. */
  recoverRun(runId: string, ownerId: string, leaseMs: number, revision: number): Run;
  parkBrowserRun(runId:string, revision:number, confirmStopped:()=>void):Run;
  listRequestAttempts(runId: string): RequestAttempt[];
  loadRequestAttempt(id: string): RequestAttempt | null;
  createRequestAttempt(input: CreateRequestAttemptInput): RequestAttempt;
  updateRequestAttempt(attempt: RequestAttempt, lease?: RunLease): RequestAttempt;
  transitionRequestAttempt(id: string, status: RequestAttemptStatus, patch: RequestAttemptPatch, lease?: RunLease): RequestAttempt;
  listToolExecutions(runId: string, requestId?: string): ToolExecution[];
  loadToolExecution(id: string): ToolExecution | null;
  /** Stage validated proposals after the provider finishes but before marking the request completed.
   * Proposals cannot be approved/executed until that request completion commits.
   */
  createToolExecution(input: CreateToolExecutionInput): ToolExecution;
  updateToolExecution(tool: ToolExecution, lease?: RunLease): ToolExecution;
  transitionToolExecution(id: string, status: ToolExecutionStatus, patch: ToolExecutionPatch, lease?: RunLease): ToolExecution;
}

/** snapshot kontrolera jest głęboko zamrożony w runtime; nie modyfikuj jego pól. */
export interface AppState {
  userQuestion?: string;
  initialized: boolean;
  connection: "disconnected" | "connecting" | "connected";
  credentialMode: "none" | "system" | "memory";
  busy: boolean;
  models: Model[];
  settings: Settings;
  project: string;
  session: Session | null;
  sessions: SessionSummary[];
  profile: Profile | null;
  error: string | null;
  notice: string | null;
  agent?: AgentState;
}

/** UI projection only; execution records and transcript storage remain independent. */
export type AgentMode = "chat" | "plan" | "review" | "trusted" | "auto" | "bypass";
export type AgentDetailsView = "tools" | "diff" | "tasks" | "permissions" | "context" | "jobs" | "git" | "undo";
export interface AgentState {
  enabled: boolean;
  mode: AgentMode;
  phase: string;
  failureCode?: string;
  runId: string | null;
  events: import("./agent/events").AgentEvent[];
  context?: import("./agent/context-usage").ContextUsage;
  approval: { toolId: string; name: string; args: JsonObject; scope: string; preview: string | null } | null;
  tools: ToolExecution[];
  tasks: { id: string; title: string; status: string }[];
  jobs: { id: string; status: string; command?: string }[];
  attachments: { path: string; hash: string; content?: string }[];
}

export interface ChatResult {
  model: string;
  usage?: Usage;
  finishReason: string | null;
  toolCalls?: CompletedToolCall[];
}

export interface ChatRequest {
  privateMode?: PrivateMode;
  onPrivateModeApplied?: (mode:PrivateMode)=>void;
  outputLimit?: { tokens: number; parameter: "max_tokens" | "max_completion_tokens" };
  model: string;
  reasoningEffort?: ReasoningEffort;
  messages: WireMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** display-only incomplete arguments; never executable tool calls. */
  onToolDraft?: (draft: { index: number; name: string; preview: string; bytes: number }) => void;
  /** Replaces the previous snapshot; receipt does not confirm stream completion or billing. */
  onUsage?: (usage: Usage) => void;
}

export interface Gateway {
  modelContext?(model: string): import("./api/model-metadata").ModelContext | undefined;
  account?(signal?:AbortSignal):Promise<AccountSnapshot>;
  diagnostics?():{requestId?:string;code?:string;status?:number;retryAfter?:number;networkCode?:string;startedAt?:string;elapsedMs?:number;stage?:string};
  contextReservation?(model: string): number;
  privateCapabilities?(signal?:AbortSignal):Promise<PrivateMode[]>;
  modelMetadata?(model: string): import("./api/model-metadata").ModelMetadata | undefined;
  listModels(signal?: AbortSignal): Promise<Model[]>;
  streamChat(request: ChatRequest): Promise<ChatResult>;
}

export interface AccountQuota { limit:number|null; used:number; reserved:number; available:number|null; }
export interface AccountSnapshot {
  version:1; updatedAt:string; status:'active'|'paused'|'expired'|'exhausted'; plan:string|null; expiresAt:string|null;
  unit:'weighted_provider_units'; limit:number|null; used:number; reserved:number; available:number|null; estimatedRequests:number;
  quota?:{wallet:AccountQuota;key:AccountQuota|null;blockedBy:('wallet'|'key')[]};
}

export interface Credentials {
  get(baseUrl: string): Promise<string | null>;
  set(baseUrl: string, key: string): Promise<void>;
  delete(baseUrl: string): Promise<void>;
}

export interface Store {
  getSettings(): Settings;
  saveSettings(settings: Settings): void;
  createSession(project: string, model: string): Session;
  loadSession(id: string): Session | null;
  listSessions(project: string): SessionSummary[];
  saveSession(session: Session): void;
  /** Returns false when no session with that id existed. */
  deleteSession(id: string): boolean;
  close(): void;
}
