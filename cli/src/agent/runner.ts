import { randomUUID } from "node:crypto";
import { modelContextBudget, parseModelMetadata } from "../api/model-metadata";
import { contextLimit, measuredContext, type ContextUsage } from "./context-usage";
import { draftText, draftFiles } from "./draft";
import { API_LIMITS, EXECUTABLE_ARGUMENT_BYTES } from "../api/limits";
import { prepareChatRequest } from "../api/chat-request";
import { isEffort } from "../api/effort";
import { historyToolCall } from "../api/tool-calls";
import { MAX_TOOL_REPAIRS, ToolArgumentError, ToolBatchValidationError, argumentIssue, issueSummary, repairMessages, type ToolValidationIssue } from "../api/tool-validation";
import { usage as validateUsage } from "../storage/execution-validation";
import { StorageError } from "../storage/errors";
import type {
  DurableStore, Gateway, JsonObject, JsonValue, RequestAttempt, RequestAttemptPatch, RequestOutput, Run, RunLease, RunStatus,
  ToolCall, ToolExecution, ToolExecutionPatch, ToolExecutionStatus, Usage, WireMessage,
} from "../types";
import { AgentSanitizer, boundedText, digest, freeze } from "./data";
import { AgentError, modelError, safeAgentError, type AgentErrorCode, type SafeAgentError } from "./errors";
import type { AgentEvent, AgentPhase } from "./events";
import { PermissionPolicy, type ApprovalCallback, type PermissionDecision, type PermissionMode } from "./policy";
import { ToolRegistry, type AgentTool } from "./registry";
import { observedToolOutcome } from "./outcome";
import { textToolCall } from './text-tool-call';
import { taskEvidence, validateTaskEvidence, withTaskEvidence } from "./task-evidence";
import { compactRequestContext, contextUsageMatches, DEFAULT_CONTEXT_BUDGET_BYTES, MAX_ORIGINAL_CONTEXT_BYTES } from "./context-budget";

export interface AgentLimits {
  maxRequests?: number;
  maxTools?: number;
  /** aggregate model text and serialized tool results, in utf8 bytes. */
  maxOutputBytes?: number;
  maxRepeatedCalls?: number;
}
type ResolvedAgentLimits = Pick<AgentLimits, "maxRequests" | "maxTools"> & Required<Pick<AgentLimits, "maxOutputBytes" | "maxRepeatedCalls">>;
// Request/tool counts are optional caller budgets, not completion criteria.
export const DEFAULT_AGENT_LIMITS: Readonly<ResolvedAgentLimits> = Object.freeze({
  maxOutputBytes: 16 * 1024 * 1024, maxRepeatedCalls: 3 });

export interface AgentRunInput {
  subagentInstructions?: string;
  privateMode?: import("../types").PrivateMode;
  reasoningEffort?: import("../types").ReasoningEffort;
  subagentModel?: string;
  sessionId: string;
  /** caller-provided canonical project identity; this batch performs no path operations. */
  project: string;
  model: string;
  messages?: readonly WireMessage[];
  userMessage?: string;
  /** optional identity for a new run or a pristine, unowned precreated run. never a replay. */
  runId?: string;
  signal?: AbortSignal;
  approval?: ApprovalCallback;
  mode?: PermissionMode;
  limits?: AgentLimits;
}
export interface AgentRunnerOptions {
  gateway: Gateway;
  store: DurableStore;
  registry: ToolRegistry;
  policy?: PermissionPolicy;
  ownerId?: string;
  leaseMs?: number;
  secrets?: readonly string[];
  onEvent?: (event: AgentEvent) => void;
  onUsage?: (requestId: string, usage: Usage) => void;
  workspaceLease?: WorkspaceLeaseProvider;
  /** Exact serialized message bytes, capped by the durable request field (1 MiB). Not tokens. */
  contextBudgetBytes?: number;
  /** Current host-owned capabilities, refreshed even when resuming an older request. */
  hostInstructions?: string;
  /** Host proof that a browser executor settled; does not resolve its remote effect. */
  settledUnknown?: (name:string)=>boolean;
  requireEffectReview?: boolean;
}
export interface WorkspaceLease {
  /** Assert external ownership immediately before dispatch. Provider owns its heartbeat. */
  check?(): void | Promise<void>;
  /** Synchronous independent ownership proof, never an acknowledgement of unknown effects. */
  confirmLiveOwner?(): true;
  release(): void | Promise<void>;
}
export interface WorkspaceLeaseProvider {
  acquire(input: { project: string; runId: string; ownerId: string; signal: AbortSignal }): Promise<WorkspaceLease>;
}
export interface AgentContinueInput {
  runId: string;
  /** Explicit user retry of a fully rejected batch; never renews a budget on reopen alone. */
  retryRejectedBatch?: boolean;
  signal?: AbortSignal;
  approval?: ApprovalCallback;
  mode?: PermissionMode;
  /** Required before stale-owner takeover: true confirms the old executor and descendants stopped. */
  recovery?: (run: Readonly<Run>) => boolean | Promise<boolean>;
  /** Explicit observed outcomes; never causes an execution to be dispatched again. */
  resolutions?: readonly { toolId: string; status: "succeeded" | "failed"; result: JsonValue }[];
}
export interface AgentRequestUsage {
  requestId: string;
  status: RequestAttempt["status"];
  usage?: Usage;
}
export interface AgentContinuationPreflight {
  runId: string;
  canContinue: boolean;
  completed: boolean;
  recoveryRequired: boolean;
  error?: SafeAgentError;
}
export interface AgentRunResult {
  runId: string;
  status: "completed" | "failed" | "interrupted" | "recovery_required";
  finalText: string;
  messages: WireMessage[];
  requestCount: number;
  toolCount: number;
  /** whole snapshots per actual request, including unconfirmed interrupted reports. */
  usage: AgentRequestUsage[];
  error?: SafeAgentError;
}

interface Proposal {
  call: ToolCall;
  args: JsonObject;
  tool?: AgentTool;
  error?: AgentErrorCode;
  record?: ToolExecution;
  result?: JsonValue;
}
type EventWithoutRun = AgentEvent extends infer E ? E extends AgentEvent ? Omit<E, "runId"> : never : never;
const terminalTools = new Set<ToolExecutionStatus>(["succeeded", "failed", "denied", "cancelled"]);
const retainedResultBytes = 1024 * 1024;

function readLimits(input: AgentLimits = {}): ResolvedAgentLimits {
  const result = { ...DEFAULT_AGENT_LIMITS, ...input };
  for (const [key, value] of Object.entries(result)) {
    if (!["maxRequests", "maxTools", "maxOutputBytes", "maxRepeatedCalls"].includes(key) || !Number.isSafeInteger(value) || value < 1) throw new AgentError("invalid_input");
  }
  if ((result.maxRequests !== undefined && result.maxRequests > 1000) || (result.maxTools !== undefined && result.maxTools > 4096) || result.maxOutputBytes > 64 * 1024 * 1024
    || result.maxRepeatedCalls > 32) throw new AgentError("invalid_input");
  return result;
}

function storageError(error: unknown, stage: "acquire_run" | "checkpoint" = "checkpoint"): AgentError {
  return new AgentError(error instanceof StorageError && error.code === "lease_conflict" ? "lease_conflict"
    : error instanceof StorageError && error.code === "recovery_required" ? "recovery_required" : "persistence_failed", {code:error instanceof StorageError ? error.code : "write_failed",stage,
      ...(error instanceof StorageError && error.nativeCode ? {nativeCode:error.nativeCode} : {})});
}

/** races uncooperative injected work; late callbacks/results are fenced by the caller. */
async function abortable<T>(action: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AgentError("aborted");
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(new AgentError("aborted"));
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    const work = Promise.resolve().then(() => {
      if (signal.aborted) throw new AgentError("aborted");
      return action();
    });
    return await Promise.race([work, interrupted]);
  } finally { signal.removeEventListener("abort", stop); }
}

function failure(code: AgentErrorCode): JsonObject {
  return { ok: false, error: safeAgentError(code) as unknown as JsonObject };
}

// Reserve at least a correlated failure result before permitting another operation.
const minimumResultBytes = Buffer.byteLength(JSON.stringify(failure("output_limit")));

function requestOutputBytes(attempt: RequestAttempt): number {
  return Math.max(attempt.output?.receivedBytes ?? 0, Buffer.byteLength(attempt.output?.content ?? ""));
}

/** each invocation has isolated state; the durable lease is the concurrency boundary. */
export class AgentRunner {
  private readonly options: AgentRunnerOptions;
  constructor(options: AgentRunnerOptions) {
    const leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 10 || leaseMs > 300_000) throw new AgentError("invalid_input");
    const contextBudgetBytes = options.contextBudgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
    if (!Number.isSafeInteger(contextBudgetBytes) || contextBudgetBytes < 2 || contextBudgetBytes > DEFAULT_CONTEXT_BUDGET_BYTES) throw new AgentError("invalid_input");
    this.options = { ...options, registry: options.registry.snapshot(), secrets: [...(options.secrets ?? [])],
      ownerId: options.ownerId ?? `agent-${randomUUID()}`, leaseMs, contextBudgetBytes };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // snapshot host configuration before an async callback can mutate caller-owned input.
    return new Invocation(this.options, { ...input, limits: input.limits ? { ...input.limits } : undefined }).run();
  }

  async continue(input: string | AgentContinueInput): Promise<AgentRunResult> {
    const continuation = typeof input === "string" ? { runId: input } : { ...input,
      resolutions: input.resolutions ? structuredClone(input.resolutions) : undefined };
    return new Invocation(this.options, { sessionId: "", project: "", model: "", ...continuation }, continuation).run();
  }

  /** Read-only UI hint. continue rechecks ownership and all guards; this does not reserve a run. */
  preflightContinue(runId: string): AgentContinuationPreflight {
    const result: AgentContinuationPreflight = { runId, canContinue: false, completed: false, recoveryRequired: false };
    try {
      const run = this.options.store.loadRun(runId);
      if (!run) throw new AgentError("invalid_input");
      const metadata = run.metadata as JsonObject | undefined;
      if (!metadata || metadata.agentCheckpoint !== 1) throw new AgentError("checkpoint_missing");
      if (metadata.registry !== this.options.registry.fingerprint()) throw new AgentError("registry_changed");
      const limits = readLimits(metadata.limits as AgentLimits);
      const attempts = this.options.store.listRequestAttempts(runId), tools = this.options.store.listToolExecutions(runId);
      if (!attempts.length || attempts.some((attempt) => !Array.isArray(attempt.context)
        || (attempt.status === "completed" && attempt.output?.finishReason === undefined))) throw new AgentError("checkpoint_missing");
      result.recoveryRequired = Boolean(run.ownerId || run.status === "recovery_required"
        || attempts.some((attempt) => ["pending", "streaming"].includes(attempt.status))
        || tools.some((tool) => !terminalTools.has(tool.status)));
      if (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now()) throw new AgentError("lease_conflict");
      // Match durable ownership: other conversations in the same folder are independent.
      if (this.options.store.listRuns(run.sessionId).some((other) => other.id !== runId
        && (other.ownerId || other.status === "recovery_required"))) throw new AgentError("lease_conflict");
      if (result.recoveryRequired) throw new AgentError("recovery_required");
      const last = attempts.at(-1)!;
      result.completed = last.status === "completed" && !last.output!.toolCalls;
      if (!result.completed) {
        const outputBytes = attempts.reduce((sum, row) => sum + requestOutputBytes(row), 0)
          + tools.reduce((sum, row) => sum + (row.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(row.result))), 0);
        if (outputBytes >= limits.maxOutputBytes) throw new AgentError("output_limit");
        let previous: string | undefined, repeated = 0;
        for (const attempt of attempts) {
          const batch = tools.filter((tool) => tool.requestId === attempt.id);
          if (attempt.status !== "completed" || !batch.length) continue;
          const key = cycleDigest(batch);
          repeated = key === previous ? repeated + 1 : 1;
          previous = key;
          if (repeated >= limits.maxRepeatedCalls) throw new AgentError(batch.some((tool) => tool.status !== "succeeded") ? "repeated_failure" : "repeated_call");
        }
        if (limits.maxRequests !== undefined && attempts.length >= limits.maxRequests) throw new AgentError("request_limit");
      }
      result.canContinue = true;
    } catch (error) {
      result.error = safeAgentError(error instanceof AgentError ? error.code : storageError(error).code);
    }
    return result;
  }
}

function cycleDigest(tools: ToolExecution[]): string {
  return digest(tools.map((tool) => ({ name: tool.name, args: tool.args, status: tool.status, result: tool.result ?? null })));
}

class Invocation {
  private readonly abort = new AbortController();
  private readonly sanitizer: AgentSanitizer;
  private readonly registry: ToolRegistry;
  private readonly id = randomUUID();
  private runRecord?: Run;
  private lease?: RunLease;
  private limits: ResolvedAgentLimits = { ...DEFAULT_AGENT_LIMITS };
  private messages: WireMessage[] = [];
  private attempts: RequestAttempt[] = [];
  private proposals: Proposal[] = [];
  private current?: RequestAttempt;
  private policy: PermissionPolicy;
  private timer?: ReturnType<typeof setInterval>;
  private storageFault = false;
  private uncertainty = false;
  private error?: SafeAgentError;
  private finalText = "";
  private outputBytes = 0;
  private toolCount = 0;
  private usedIds = new Set<string>();
  private initialHistoryIds: string[] = [];
  private contextBudgetBytes: number;
  private contextReductions = 0;
  private previousCycle?: string;
  private repeatedCycles = 0;
  private repeatedCycleError: AgentErrorCode = "repeated_call";
  private workspaceLease?: WorkspaceLease;
  private cleanupConfirmed = false;
  private restoredComplete = false;
  private repairs = 0;
  private repairAttempt?: number;
  private status: AgentRunResult["status"] = "failed";

  constructor(private readonly options: AgentRunnerOptions, private readonly input: AgentRunInput,
    private readonly continuation?: AgentContinueInput) {
    this.sanitizer = new AgentSanitizer(options.secrets);
    this.registry = options.registry;
    this.policy = options.policy ?? new PermissionPolicy();
    this.contextBudgetBytes = options.contextBudgetBytes!;
  }

  private emit(event: EventWithoutRun): void {
    // detached, frozen events carry no arguments, results, exception objects or lease tokens.
    try { void Promise.resolve(this.options.onEvent?.(freeze(structuredClone({ runId: this.runRecord?.id ?? this.input.runId ?? this.id, ...event }) as AgentEvent))).catch(() => {}); }
    catch { /* observers cannot change the execution lifecycle */ }
  }
  private phase(phase: AgentPhase): void { this.emit({ type: "phase", phase }); }
  private check(): void {
    if (this.storageFault) throw new AgentError("recovery_required");
    if (this.abort.signal.aborted) throw new AgentError("aborted");
  }
  private persist<T>(action: () => T): T {
    try { return action(); }
    catch (error) {
      this.storageFault = true;
      this.abort.abort();
      throw storageError(error);
    }
  }
  private setRun(status: RunStatus): void {
    if (this.runRecord!.status === status) return;
    this.renewLease();
    this.runRecord = this.persist(() => this.options.store.updateRun({ ...this.runRecord!, status }, this.lease));
  }
  private contextUsage?: ContextUsage;
  private saveContext(context: ContextUsage): void {
    this.contextUsage = context;
    this.emit({ type: "context_budget", ...context });
  }
  private saveRequest(status: RequestAttempt["status"], patch: Omit<RequestAttemptPatch, "revision"> = {}): void {
    this.renewLease();
    const saved = this.persist(() => this.options.store.transitionRequestAttempt(this.current!.id, status,
      { revision: this.current!.revision, ...patch }, this.lease));
    this.current = saved;
    this.attempts[saved.sequence] = saved;
    this.emit({ type: "request", requestId: saved.id, sequence: saved.sequence, status, ...(saved.usage ? { usage: saved.usage } : {}) });
  }
  private saveTool(proposal: Proposal, status: ToolExecutionStatus, patch: Omit<ToolExecutionPatch, "revision"> = {}): void {
    this.renewLease();
    proposal.record = this.persist(() => this.options.store.transitionToolExecution(proposal.record!.id, status,
      { revision: proposal.record!.revision, ...patch }, this.lease));
    if (patch.result !== undefined) proposal.result = patch.result;
    if (status === "outcome_unknown") {
      // this transition also advances the parent revision in the existing store.
      this.runRecord = this.persist(() => this.options.store.loadRun(this.runRecord!.id))!;
    }
    this.emit({ type: "tool", requestId: proposal.record.requestId, toolId: proposal.record.id, name: proposal.record.name, status });
  }

  private renewLease(force = false): void {
    if (!this.lease || !this.runRecord || this.storageFault) return;
    if (!force && Date.parse(this.runRecord.leaseExpiresAt!) - Date.now() > this.options.leaseMs! / 2) return;
    this.runRecord = this.persist(() => this.options.store.renewRunLease(this.runRecord!.id, this.lease!,
      this.options.leaseMs!, this.runRecord!.revision, this.workspaceLease?.confirmLiveOwner));
  }

  async run(): Promise<AgentRunResult> {
    const externalAbort = () => this.abort.abort();
    try {
      this.input.signal?.addEventListener("abort", externalAbort, { once: true });
      if (this.input.signal?.aborted) this.abort.abort();
      if (this.continuation) await this.restore();
      else { this.prepare(); this.acquire(); }
      this.phase("preparing_context");
      if (this.restoredComplete) this.status = "completed";
      else {
        this.timer = setInterval(() => {
          if (this.storageFault) return;
          try {
            this.renewLease(true);
          } catch { this.error = safeAgentError("lease_conflict"); }
        }, Math.max(1, Math.floor(this.options.leaseMs! / 3)));
        if (this.options.workspaceLease) {
          this.check();
          // Acquisition is awaited, including abort cleanup; never abandon a newly acquired lock.
          try { this.workspaceLease = await this.options.workspaceLease.acquire({ project: this.input.project,
            runId: this.runRecord!.id, ownerId: this.options.ownerId!, signal: this.abort.signal }); }
          catch { throw new AgentError("lease_conflict"); }
        }
        this.status = await this.loop();
      }
    } catch (error) {
      const safe = error instanceof AgentError ? error : error instanceof StorageError ? storageError(error) : new AgentError("invalid_input");
      this.error ??= { ...safeAgentError(safe.code), ...(safe.storage ? {storage:safe.storage} : {}) };
      if (contextLimit(safe.code) && !this.storageFault) {
        this.saveContext({ ...(this.contextUsage ?? { usedBytes: 0, maxBytes: this.contextBudgetBytes, method: "unverified_byte_cap" }), full: true, exhaustedBy: "provider" });
      }
      this.status = this.storageFault || this.uncertainty || safe.code === "recovery_required" ? "recovery_required"
        : safe.code === "aborted" ? "interrupted" : "failed";
    } finally {
      this.input.signal?.removeEventListener("abort", externalAbort);
      if (this.workspaceLease && (!this.uncertainty || this.cleanupConfirmed)) {
        try { await this.workspaceLease.release(); }
        catch { this.uncertainty = true; this.status = "recovery_required"; this.error = {...safeAgentError("recovery_required"), ...(this.error?.storage ? {storage:this.error.storage} : {})}; }
      }
      if (this.timer) clearInterval(this.timer);
      if (this.lease) this.finish();
    }
    this.phase(this.status);
    this.emit({ type: "finished", status: this.status, ...(this.error ? { error: this.error } : {}) });
    return { runId: this.runRecord?.id ?? this.input.runId ?? this.id, status: this.status, finalText: this.finalText,
      messages: structuredClone(this.messages), requestCount: this.attempts.length, toolCount: this.toolCount,
      usage: this.attempts.map((attempt) => ({ requestId: attempt.id, status: attempt.status,
        ...(attempt.usage ? { usage: structuredClone(attempt.usage) } : {}) })), ...(this.error ? { error: this.error } : {}) };
  }

  private prepare(): void {
    if (this.input.reasoningEffort !== undefined && !isEffort(this.input.reasoningEffort)) throw new AgentError("invalid_input");
    this.limits = readLimits(this.input.limits);
    this.policy = this.input.mode === undefined ? this.policy : new PermissionPolicy(this.input.mode, this.policy.rules);
    this.sanitizer.exact({ sessionId: this.input.sessionId, project: this.input.project, model: this.input.model,
      ...(this.input.subagentModel === undefined ? {} : { subagentModel: this.input.subagentModel }),
      ...(this.input.runId ? { runId: this.input.runId } : {}) }, 16 * 1024);
    this.sanitizer.exact(this.registry.definitions(), 256 * 1024);
    const messages = [...(this.input.messages ?? [])];
    if (this.input.userMessage !== undefined) messages.push({ role: "user", content: this.input.userMessage });
    this.sanitizer.exact(messages, MAX_ORIGINAL_CONTEXT_BYTES);
    try {
      const prepared = prepareChatRequest({ model: this.input.model, messages, onDelta: () => {} });
      this.messages = JSON.parse(prepared.body).messages;
      this.usedIds = prepared.historyToolCallIds;
    } catch { throw new AgentError("invalid_input"); }
    this.initialHistoryIds = [...this.usedIds];
    // Initial history may be omitted from the first saved context. Retain its identity registry
    // separately; never rely on the clipped wire messages to reject a reused call id on resume.
    if (Buffer.byteLength(JSON.stringify(this.metadata())) > 1024 * 1024) throw new AgentError("checkpoint_limit");
  }

  private acquire(): void {
    const store = this.options.store;
    try {
      let run = this.input.runId ? store.loadRun(this.input.runId) : null;
      if (run && (run.sessionId !== this.input.sessionId || run.project !== this.input.project || run.model !== this.input.model)) throw new AgentError("invalid_input");
      if (run) this.runRecord = run;
      if (run && store.listRequestAttempts(run.id).length) throw new AgentError("recovery_required");
      if (!run) {
        run = store.beginRun({ id: this.input.runId ?? this.id, sessionId: this.input.sessionId,
          project: this.input.project, model: this.input.model, requestLimit: this.limits.maxRequests, toolLimit: this.limits.maxTools,
          metadata: this.metadata() }, this.options.ownerId!, this.options.leaseMs!);
        this.runRecord = run;
      } else this.runRecord = store.acquireRunLease(run.id, this.options.ownerId!, this.options.leaseMs!, run.revision);
      if (run.requestLimit !== undefined) this.limits.maxRequests = Math.min(this.limits.maxRequests ?? run.requestLimit, run.requestLimit);
      if (run.toolLimit !== undefined) this.limits.maxTools = Math.min(this.limits.maxTools ?? run.toolLimit, run.toolLimit);
      this.lease = { ownerId: this.runRecord.ownerId!, token: this.runRecord.leaseToken! };
      const metadata = { ...(this.runRecord.metadata as JsonObject | undefined), ...this.metadata() };
      if (this.runRecord.metadata === undefined || digest(this.runRecord.metadata) !== digest(metadata)) {
        this.runRecord = store.updateRun({ ...this.runRecord, metadata }, this.lease);
      }
      if (["interrupted", "failed"].includes(this.runRecord.status)) this.setRun("running");
    } catch (error) { throw error instanceof AgentError ? error : storageError(error, "acquire_run"); }
  }

  private metadata(): JsonObject {
    return { ...(this.input.subagentInstructions === undefined ? {} : {subagentInstructions:this.input.subagentInstructions}), ...(this.input.privateMode ? {privateMode:{...this.input.privateMode}} : {}), agentCheckpoint: 1, registry: this.registry.fingerprint(), mode: this.policy.mode, limits: { ...this.limits },
      contextBudgetBytes: this.contextBudgetBytes, initialHistoryIds: this.initialHistoryIds,
      ...(this.input.reasoningEffort === undefined ? {} : { reasoningEffort: this.input.reasoningEffort }),
      ...(this.input.subagentModel === undefined ? {} : { subagentModel: this.input.subagentModel }) };
  }

  private async restore(): Promise<void> {
    const store = this.options.store;
    const run = store.loadRun(this.continuation!.runId);
    if (!run) throw new AgentError("invalid_input");
    this.runRecord = run;
    this.input.sessionId = run.sessionId; this.input.project = run.project; this.input.model = run.model;
    const metadata = run.metadata as JsonObject | undefined;
    this.input.privateMode = metadata?.privateMode as unknown as import("../types").PrivateMode | undefined;
    if (!metadata || metadata.agentCheckpoint !== 1) throw new AgentError("checkpoint_missing");
    if (metadata.reasoningEffort !== undefined && !isEffort(metadata.reasoningEffort)) throw new AgentError("checkpoint_missing");
    this.input.reasoningEffort = metadata.reasoningEffort as import("../types").ReasoningEffort | undefined;
    if (metadata.subagentModel !== undefined && (typeof metadata.subagentModel !== "string" || !metadata.subagentModel.trim())) throw new AgentError("checkpoint_missing");
    this.input.subagentModel = metadata.subagentModel as string | undefined;
    if (metadata.subagentInstructions !== undefined && typeof metadata.subagentInstructions !== 'string') throw new AgentError('checkpoint_missing');
    this.input.subagentInstructions = metadata.subagentInstructions as string | undefined;
    if (metadata.registry !== this.registry.fingerprint()) throw new AgentError("registry_changed");
    this.limits = readLimits(metadata.limits as AgentLimits);
    if (metadata.contextBudgetBytes !== undefined) {
      const cap = metadata.contextBudgetBytes;
      if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 2 || cap > DEFAULT_CONTEXT_BUDGET_BYTES) throw new AgentError("checkpoint_missing");
      this.contextBudgetBytes = cap;
    }
    if (metadata.initialHistoryIds !== undefined) {
      if (!Array.isArray(metadata.initialHistoryIds) || metadata.initialHistoryIds.some((id) => typeof id !== "string")) throw new AgentError("checkpoint_missing");
      this.initialHistoryIds = metadata.initialHistoryIds as string[];
    }
    this.policy = new PermissionPolicy(this.input.mode ?? metadata.mode as PermissionMode, this.policy.rules);
    this.attempts = store.listRequestAttempts(run.id);
    let tools = store.listToolExecutions(run.id);
    this.toolCount = tools.length;
    this.outputBytes = this.attempts.reduce((sum, row) => sum + requestOutputBytes(row), 0)
      + tools.reduce((sum, row) => sum + (row.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(row.result))), 0);
    // Never fabricate missing assistant text, historical arguments or context for legacy journals.
    for (const attempt of this.attempts) {
      if (!Array.isArray(attempt.context) || (attempt.status === "completed" && attempt.output?.finishReason === undefined)) {
        throw new AgentError("checkpoint_missing");
      }
    }
    if (!this.attempts.length) throw new AgentError("checkpoint_missing");
    const unfinished = tools.some((tool) => !terminalTools.has(tool.status))
      || this.attempts.some((request) => ["pending", "streaming"].includes(request.status));
    if (run.ownerId || run.status === "recovery_required" || unfinished) {
      if (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now()) throw new AgentError("lease_conflict");
      if (!this.continuation!.recovery || !await this.continuation!.recovery(freeze(structuredClone(run)))) {
        throw new AgentError("recovery_required");
      }
      this.cleanupConfirmed = true;
      this.runRecord = store.recoverRun(run.id, this.options.ownerId!, this.options.leaseMs!, run.revision);
      this.attempts = store.listRequestAttempts(run.id);
      tools = store.listToolExecutions(run.id);
      if (!this.runRecord.ownerId && this.runRecord.status !== "completed") {
        this.runRecord = store.acquireRunLease(run.id, this.options.ownerId!, this.options.leaseMs!, this.runRecord.revision);
      }
    } else if (run.status !== "completed") {
      this.runRecord = store.acquireRunLease(run.id, this.options.ownerId!, this.options.leaseMs!, run.revision);
    }
    if (this.runRecord.ownerId === this.options.ownerId) this.lease = { ownerId: this.runRecord.ownerId!, token: this.runRecord.leaseToken! };
    const unknown = tools.filter((tool) => tool.status === "outcome_unknown");
    const resolutions = this.continuation!.resolutions ?? [];
    if (resolutions.length) {
      if (!this.cleanupConfirmed || resolutions.length !== unknown.length || new Set(resolutions.map((item) => item.toolId)).size !== resolutions.length) {
        throw new AgentError("recovery_required");
      }
      // Preflight the complete decision set before committing any manual outcome.
      for (const item of resolutions) {
        if (!unknown.some((tool) => tool.id === item.toolId) || !["succeeded", "failed"].includes(item.status)) throw new AgentError("invalid_input");
        this.sanitizer.exact(item.result, 1024 * 1024);
      }
      for (const item of resolutions) {
        const tool = unknown.find((tool) => tool.id === item.toolId)!;
        store.transitionToolExecution(tool.id, item.status, { revision: tool.revision, result: item.result }, this.lease);
      }
      tools = store.listToolExecutions(run.id);
    }
    if (tools.some((tool) => tool.status === "outcome_unknown")) { this.uncertainty = true; throw new AgentError("recovery_required"); }
    this.outputBytes = this.attempts.reduce((sum, row) => sum + requestOutputBytes(row), 0)
      + tools.reduce((sum, row) => sum + (row.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(row.result))), 0);
    const last = this.attempts.at(-1)!;
    let pendingRepairs = this.attempts.slice(this.attempts.findLastIndex(attempt => attempt.status === "completed") + 1);
    // A request after an exhausted rejection records an explicit retry boundary.
    // Count only its new bounded series, including partial/cancelled requests.
    const retryBoundary = pendingRepairs.findLastIndex(attempt => attempt.output?.validation?.exhausted);
    if (retryBoundary >= 0 && retryBoundary < pendingRepairs.length - 1) pendingRepairs = pendingRepairs.slice(retryBoundary + 1);
    this.repairs = Math.max(0, ...pendingRepairs.map(attempt => Math.max(attempt.output?.validation?.repair ?? 0, attempt.output?.repairAttempt ?? 0)));
    this.messages = structuredClone(last.context) as unknown as WireMessage[];
    if (last.output?.validation) {
      const diagnostic = last.output.validation;
      if (diagnostic.exhausted) {
        if (this.continuation!.retryRejectedBatch || diagnostic.issues.every(issue => issue.stage === "contract" && issue.receivedType === "truncated")) {
          // Explicit /retry is a new bounded correction budget, not a replay of
          // effects. All execution/lease checks above still apply.
          this.repairs = 0;
        } else {
          this.error = { code: "model_invalid_tool_arguments", message: issueSummary(diagnostic.issues[0]!) + " correction budget exhausted; completed work is saved. use /retry to request corrected arguments and continue." };
          throw new AgentError("model_invalid_tool_arguments");
        }
      }
      this.messages.push(...repairMessages(new ToolBatchValidationError(diagnostic.issues)));
      this.repairAttempt = this.repairs;
    } else if (last.output?.repairAttempt && last.status !== "completed") {
      // A user-requested continuation after transport/cancellation still cannot
      // replenish an already-started correction request's budget.
      if (this.repairs >= MAX_TOOL_REPAIRS) throw new AgentError("model_invalid_tool_arguments");
      this.repairAttempt = ++this.repairs;
    }
    if (last.status === "completed") {
      const output = last.output!;
      this.messages.push(output.toolCalls ? { role: "assistant", content: output.content, tool_calls: output.toolCalls }
        : { role: "assistant", content: output.content ?? "" });
      for (const call of output.toolCalls ?? []) {
        const tool = tools.find((tool) => tool.requestId === last.id && tool.callId === call.id);
        if (!tool || !terminalTools.has(tool.status) || tool.result === undefined) throw new AgentError("recovery_required");
        this.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(tool.result) });
      }
      if (!output.toolCalls) { this.finalText = output.content ?? ""; this.restoredComplete = true; }
    }
    this.sanitizer.exact(this.messages, MAX_ORIGINAL_CONTEXT_BYTES);
    this.usedIds = prepareChatRequest({ model: run.model, messages: this.messages, onDelta: () => {} }).historyToolCallIds;
    for (const id of this.initialHistoryIds) this.usedIds.add(id);
    for (const tool of tools) this.usedIds.add(tool.callId);
    for (const attempt of this.attempts) {
      for (const call of attempt.output?.toolCalls ?? []) this.usedIds.add(call.id);
      const original = prepareChatRequest({ model: run.model, messages: attempt.context as unknown as WireMessage[], onDelta: () => {} });
      for (const id of original.historyToolCallIds) this.usedIds.add(id);
    }
    // Rebuild the cycle guard from durable outcomes, ignoring failed model attempts.
    for (const attempt of this.attempts) {
      const batch = tools.filter((tool) => tool.requestId === attempt.id);
      if (attempt.status === "completed" && batch.length) this.noteCycle(batch, false);
    }
    if (this.lease && this.runRecord.status !== "running") this.setRun("running");
  }

  private async loop(): Promise<"completed"> {
    while (true) {
      this.check();
      if (this.outputBytes >= this.limits.maxOutputBytes) throw new AgentError("output_limit");
      if (this.repeatedCycles >= this.limits.maxRepeatedCalls) throw new AgentError(this.repeatedCycleError);
      if (this.limits.maxRequests !== undefined && this.attempts.length >= this.limits.maxRequests) throw new AgentError("request_limit");
      let response: string;
      try { response = await this.request(); }
      catch (error) {
        if (error instanceof AgentError && ["model_request_too_large", "model_context_exceeded"].includes(error.code) && this.contextReductions < 1 && this.current?.status === "streaming"
          && !this.current?.usage && !this.current?.output?.receivedBytes) {
          this.saveRequest("failed", { error: error.code });
          this.contextReductions++;
          this.contextBudgetBytes = Math.min(this.contextBudgetBytes, Math.max(2, Math.floor(Buffer.byteLength(JSON.stringify(this.messages)) * 0.6)));
          continue;
        }
        if (!(error instanceof ToolBatchValidationError)) throw error;
        this.rejectBatch(error);
        continue;
      }
      this.repairAttempt = undefined;
      this.repairs = 0;
      if (this.proposals.length === 0) {
        this.finalText = response;
        this.messages.push({ role: "assistant", content: response });
        return "completed";
      }
      for (const proposal of this.proposals) { this.check(); await this.execute(proposal); }
      this.appendResults();
      this.noteCycle(this.proposals.map((proposal) => proposal.record!), true);
      this.proposals = [];
    }
  }

  private rejectBatch(error: ToolBatchValidationError): void {
    this.check();
    // Only trusted schema constraints and correlation metadata survive rejection.
    this.sanitizer.exact(error.issues, 256 * 1024);
    const exhausted = this.repairs >= MAX_TOOL_REPAIRS;
    if (!exhausted) this.repairs++;
    const output: RequestOutput = { content: this.current?.output?.content ?? null,
      receivedBytes: this.current?.output?.receivedBytes ?? 0,
      ...(this.repairAttempt ? { repairAttempt: this.repairAttempt } : {}),
      validation: { issues: error.issues, repair: this.repairs, exhausted } };
    this.saveRequest("failed", { output, error: "model_invalid_tool_arguments" });
    this.emit({ type: "validation_repair", requestId: this.current!.id, attempt: this.repairs, exhausted, issues: error.issues });
    if (exhausted) {
      const truncated = error.issues.every(issue => issue.stage === "contract" && issue.receivedType === "truncated");
      const textCall=error.issues.some(issue=>issue.receivedType==='text_tool_call');
      const unfinished=error.issues.some(issue=>issue.receivedType==='unfinished_tasks');
      this.error = { code: "model_invalid_tool_arguments", message: unfinished
        ? 'the model stopped with unfinished steps after two continuation attempts. work is saved in this chat. use /retry or send a new prompt to continue.' : textCall
        ? 'the model returned a tool command as text, so it was not executed. correction attempts exhausted; work is saved. use /retry to continue.' : truncated
        ? "the model repeatedly exceeded its response output limit. incomplete tools were not executed; completed work is saved. use /retry to continue with smaller edits."
        : issueSummary(error.issues[0]!) + " correction budget exhausted; completed work is saved. use /retry to request corrected arguments and continue." };
      throw new AgentError("model_invalid_tool_arguments");
    }
    const feedback = repairMessages(error);
    this.sanitizer.exact(feedback, 256 * 1024);
    this.messages.push(...feedback);
    for (const call of error.calls ?? []) this.usedIds.add(call.id);
    this.repairAttempt = this.repairs;
    this.phase("repairing_arguments");
  }

  private async request(): Promise<string> {
    if (this.options.hostInstructions) {
      this.messages = this.messages.filter(message => !(message.role === "system" && message.content?.startsWith("current host permissions: ")));
      const index = this.messages.findIndex(message => message.role !== "system");
      this.messages.splice(index < 0 ? this.messages.length : index, 0, { role: "system", content: this.options.hostInstructions });
    }
    if (this.registry.definitions().some(tool=>tool.function.name==="update_tasks")) {
      this.messages=withTaskEvidence(this.messages,this.options.store.listToolExecutions(this.runRecord!.id));
    }
    const budget = modelContextBudget(parseModelMetadata(this.options.gateway.modelMetadata?.(this.input.model)), this.registry.definitions(), this.contextBudgetBytes, this.options.gateway.contextReservation?.(this.input.model) ?? 0, this.options.gateway.modelContext?.(this.input.model));
    let context: ReturnType<typeof compactRequestContext>;
    try {
      const matching = (attempt: RequestAttempt) => attempt.status === "completed" && attempt.model === this.input.model && attempt.usage && Array.isArray(attempt.context)
        && contextUsageMatches(this.messages, { messages: attempt.context as unknown as WireMessage[], inputTokens: attempt.usage.inputTokens });
      let previous = this.attempts.findLast(matching);
      // A new prompt creates a new run, not a fresh model context. Reuse only
      // exact matching usage from this session; never another conversation.
      if (!previous) {
        for (const run of this.options.store.listRuns(this.input.sessionId).slice(-8).reverse()) {
          if (run.id === this.runRecord!.id || run.model !== this.input.model) continue;
          previous = this.options.store.listRequestAttempts(run.id).findLast(matching);
          if (previous) break;
        }
      }
      context = compactRequestContext(this.messages, { maxBytes: budget.maxBytes,
        ...(previous ? { previous: { messages: previous.context as unknown as WireMessage[], inputTokens: previous.usage!.inputTokens } } : {}),
        tokenBudget: budget.tokenBudget && { ...budget.tokenBudget, ...(previous ? { previous: { messages: previous.context as unknown as WireMessage[], inputTokens: previous.usage!.inputTokens } } : {}) },
        toolStates: new Map(this.options.store.listToolExecutions(this.runRecord!.id).map((tool) => [tool.callId, tool.status])) });
    } catch (error) {
      if (error instanceof AgentError && error.code === "context_limit") this.saveContext(measuredContext({ maxBytes: budget.maxBytes,
        usedBytes: Buffer.byteLength(JSON.stringify(this.messages)), method: budget.method }, this.options.gateway, this.input.model));
      const rejected = this.attempts.at(-1)?.error;
      if (error instanceof AgentError && error.code === "context_limit" && this.contextReductions > 0
        && (rejected === "model_request_too_large" || rejected === "model_context_exceeded")) throw new AgentError(rejected);
      throw error;
    }
    for (const id of context.historyToolCallIds) this.usedIds.add(id);
    this.messages = context.messages;
    this.saveContext(measuredContext({ maxBytes: budget.maxBytes, usedBytes: context.report.afterBytes, method: budget.method,
      ...(budget.outputTokens ? { outputTokens: budget.outputTokens } : {}) }, this.options.gateway, this.input.model));
    if (context.compacted) this.emit({ type: "context_compacted", report: context.report });
    const sequence = this.attempts.length;
    this.renewLease();
    this.current = this.persist(() => this.options.store.createRequestAttempt({ runId: this.runRecord!.id,
      sequence, model: this.input.model, context: this.messages as unknown as JsonValue, lease: this.lease }));
    this.attempts.push(this.current);
    this.emit({ type: "request", requestId: this.current.id, sequence, status: "pending" });
    this.check();
    this.saveRequest("streaming", this.repairAttempt ? { output: { content: null, repairAttempt: this.repairAttempt } } : {});
    this.phase(this.repairAttempt ? "repairing_arguments" : "requesting_model");
    let accepting = true, text = "", receivedBytes = 0, callbackError: AgentError | undefined;
    const requestId = this.current.id;
    const drafts = new Map<number, { index: number; name: string; preview: string; bytes: number }>();
    let draftTimer: ReturnType<typeof setTimeout> | undefined, lastDraftEmit = 0;
    const flushDrafts = () => {
      draftTimer = undefined;
      if (!accepting || this.abort.signal.aborted) return;
      for (const draft of drafts.values()) this.emit({ type: "tool_draft", requestId, ...draft,
        preview: boundedText(this.sanitizer.partialText(draftText(draft.preview)), EXECUTABLE_ARGUMENT_BYTES),
        files: draftFiles(draft.preview).map((file) => ({ ...file,
          path: this.sanitizer.text(file.path), content: this.sanitizer.partialText(file.content, file.complete) })),
      });
      drafts.clear();
      lastDraftEmit = Date.now();
    };
    const checkpoint = (partial: boolean): void => {
      const content = this.sanitizer.partialText(text, !partial);
      if (Buffer.byteLength(JSON.stringify({ content })) > 1024 * 1024) throw new AgentError("output_limit");
      this.saveRequest("streaming", { output: { content, receivedBytes, ...(this.repairAttempt ? { repairAttempt: this.repairAttempt } : {}) } });
      this.emit({ type: "output", requestId, text: boundedText(content, 8192),
        truncated: Buffer.byteLength(content) > 8192, partial: true, replace: true });
    };
    const onUsage = (input: Usage): void => {
      if (!accepting || this.abort.signal.aborted) return;
      try {
        validateUsage(input);
        const usage = structuredClone(input);
        this.saveRequest("streaming", { usage });
        this.saveContext(measuredContext(this.contextUsage!, this.options.gateway, this.input.model, usage));
        try { void Promise.resolve(this.options.onUsage?.(requestId, freeze(structuredClone(usage)))).catch(() => {}); } catch { /* observer only */ }
      } catch (error) {
        callbackError = error instanceof AgentError ? error : new AgentError("model_protocol");
        this.abort.abort();
        throw callbackError;
      }
    };
    let result;
    try {
      result = await abortable(() => this.options.gateway.streamChat({ model: this.input.model,
        ...(budget.outputTokens && budget.outputParameter ? { outputLimit: { tokens: budget.outputTokens, parameter: budget.outputParameter } } : {}),
        ...(this.input.reasoningEffort === undefined ? {} : { reasoningEffort: this.input.reasoningEffort }),
        messages: structuredClone(this.messages), tools: this.registry.definitions(), signal: this.abort.signal,
        onDelta: (chunk) => {
          if (!accepting || this.abort.signal.aborted) return;
          if (typeof chunk !== "string") callbackError = new AgentError("model_protocol");
          else {
            const bytes = Buffer.byteLength(chunk);
            receivedBytes += bytes;
            this.outputBytes += bytes;
            if (this.outputBytes > this.limits.maxOutputBytes) callbackError = new AgentError("output_limit");
          }
          if (callbackError) { this.abort.abort(); throw callbackError; }
          text += chunk;
          try { checkpoint(true); }
          catch (error) {
            callbackError = error instanceof AgentError ? error : new AgentError("unsafe_data");
            this.abort.abort(); throw callbackError;
          }
        }, onToolDraft: (draft) => {
          if (!accepting || this.abort.signal.aborted) return;
          if (!Number.isInteger(draft.index) || draft.index < 0 || draft.index >= 64 || typeof draft.name !== "string"
             || typeof draft.preview !== "string" || !Number.isSafeInteger(draft.bytes) || draft.bytes < 0
             || draft.bytes > EXECUTABLE_ARGUMENT_BYTES || Buffer.byteLength(draft.preview) > EXECUTABLE_ARGUMENT_BYTES) return;
          drafts.set(draft.index, { index: draft.index, name: this.sanitizer.text(draft.name.slice(0, 64)),
            preview: draft.preview, bytes: draft.bytes });
           if (!lastDraftEmit || Date.now() - lastDraftEmit >= 50) flushDrafts();
           else if (!draftTimer) draftTimer = setTimeout(flushDrafts, 50 - (Date.now() - lastDraftEmit));
        }, onUsage }), this.abort.signal);
      if (callbackError) throw callbackError;
      this.check();
      if (result.usage) onUsage(result.usage);
    } catch (error) {
      if (!this.storageFault) {
        try { checkpoint(false); } catch (failure) { callbackError ??= failure instanceof AgentError ? failure : new AgentError("unsafe_data"); }
      }
      throw callbackError ?? (error instanceof AgentError || error instanceof ToolBatchValidationError ? error : modelError(error));
    } finally {
      if (draftTimer) clearTimeout(draftTimer);
      if (accepting && !this.abort.signal.aborted && drafts.size) flushDrafts();
      accepting = false;
      drafts.clear();
    }
    this.check();
    // Partial snapshots withheld ambiguous suffixes; completion can publish the sanitized whole.
    text = this.sanitizer.text(text);
    checkpoint(false);
    this.phase("validating_calls");
    this.check();
    const proposals = this.validateCalls(result.toolCalls, result.finishReason);
    const textualCall=!proposals.length?textToolCall(text,this.options.registry.definitions().map(tool=>tool.function.name)):undefined;
    if(textualCall)throw new ToolBatchValidationError([{tool:textualCall,callId:'text-only',stage:'contract',path:'$.tool_calls',code:'required',
      expected:'a structured tool_calls entry using the registered function and its JSON object schema, not tool markup in assistant text',receivedType:'text_tool_call',retryable:true}]);
    if(!proposals.length&&!text.trim())throw new AgentError("model_empty_response");
    if(!proposals.length&&this.policy.mode!=="plan"){
      const tasks=taskEvidence(this.options.store.listToolExecutions(this.runRecord!.id)).tasks as JsonObject[];
      // A reported blocker needs user input, not an automatic execution loop.
      if(tasks.some(task=>task.status==='blocked'))throw new AgentError("task_blocked");
      if(tasks.some(task=>task.status==='pending'||task.status==='in_progress'))throw new ToolBatchValidationError([{
        tool:'update_tasks',callId:'unfinished-plan',stage:'contract',path:'$.tasks',code:'constraint',
        expected:'finish remaining work with verified evidence, or report a concrete blocker',receivedType:'unfinished_tasks',retryable:true}]);
    }
    if (this.limits.maxTools !== undefined && this.toolCount + proposals.length > this.limits.maxTools) throw new AgentError("tool_limit");
    this.proposals = proposals;
    const output: RequestOutput = { content: proposals.length && !text ? null : text, receivedBytes, finishReason: result.finishReason,
      ...(this.repairAttempt ? { repairAttempt: this.repairAttempt } : {}),
      ...(proposals.length ? { toolCalls: proposals.map((proposal) => proposal.call) } : {}) };
    this.sanitizer.exact(output, 1024 * 1024);
    this.saveRequest("streaming", { output });
    for (const proposal of proposals) {
      // once a complete response is accepted, journal the whole batch before cancelling it.
      this.renewLease();
      proposal.record = this.persist(() => this.options.store.createToolExecution({ runId: this.runRecord!.id,
        requestId, sequence: this.toolCount, callId: proposal.call.id, name: proposal.call.function.name,
        args: proposal.args, schemaVersion: proposal.tool?.schemaVersion ?? "unregistered",
        precondition: { version: proposal.tool?.version ?? "unregistered" }, lease: this.lease }));
      this.toolCount++;
      this.emit({ type: "tool", requestId, toolId: proposal.record.id, name: proposal.record.name, status: "proposed" });
    }
    this.check();
    this.saveRequest("completed");
    if (proposals.length) this.messages.push({ role: "assistant", content: output.content, tool_calls: proposals.map((proposal) => proposal.call) });
    this.emit({ type: "output", requestId, text: boundedText(text, 8192), truncated: Buffer.byteLength(text) > 8192, partial: false, replace: true });
    this.check();
    return text;
  }

  private validateCalls(input: unknown, finishReason: string | null): Proposal[] {
    if (input === undefined || (Array.isArray(input) && input.length === 0)) {
      if (finishReason !== "stop" && finishReason !== null) throw new AgentError("model_protocol");
      return [];
    }
    if (!Array.isArray(input) || input.length > 64 || finishReason !== "tool_calls") throw new AgentError("invalid_tool_call");
    const ids = new Set(this.usedIds);
    const proposals: Proposal[] = [];
    const issues: ToolValidationIssue[] = [];
    let argumentBytes = 0;
    for (const raw of input) {
      let call: ToolCall;
      try { call = historyToolCall(raw); } catch { throw new AgentError("invalid_tool_call"); }
      if (ids.has(call.id)) throw new AgentError("invalid_tool_call");
      ids.add(call.id);
      argumentBytes += Buffer.byteLength(call.function.arguments);
      if (argumentBytes > API_LIMITS.totalToolArgumentsBytes) throw new AgentError("invalid_tool_call");
      const args = JSON.parse(call.function.arguments) as JsonObject;
      // Validate correlation separately: rejected argument values never enter the
      // journal, approval UI or repair context, and no rewritten effect executes.
      this.sanitizer.exact({ ...call, function: { name: call.function.name, arguments: "{}" } }, 4096);
      try {
        this.sanitizer.exact(args, EXECUTABLE_ARGUMENT_BYTES);
        this.sanitizer.exact(call, EXECUTABLE_ARGUMENT_BYTES * 2 + 4096);
      } catch (caught) {
        if (!(caught instanceof AgentError) || caught.code !== "unsafe_data") throw caught;
        issues.push(argumentIssue(new ToolArgumentError({ stage: "contract", ...this.sanitizer.retentionIssue(args, EXECUTABLE_ARGUMENT_BYTES), code: "constraint",
          receivedType: "unrecordable arguments" }), call.function.name, call.id));
        proposals.push({ call: { ...call, function: { name: call.function.name, arguments: "{}" } }, args: {}, error: "unsafe_data" });
        continue;
      }
      let tool: AgentTool | undefined, error: AgentErrorCode | undefined;
      try {
        tool = this.registry.get(call.function.name); this.registry.validate(tool.name, call.function.arguments);
        if (tool.name === "update_tasks") validateTaskEvidence(args, this.options.store.listToolExecutions(this.runRecord!.id));
      }
      catch (caught) {
        if (caught instanceof ToolArgumentError) issues.push(argumentIssue(caught, call.function.name, call.id));
        else error = caught instanceof AgentError ? caught.code : "invalid_tool_arguments";
      }
      proposals.push({ call, args: freeze(args), tool, error });
    }
    if (issues.length) throw new ToolBatchValidationError(issues, proposals.map(proposal => proposal.call));
    this.usedIds = ids;
    return proposals;
  }

  private deny(proposal: Proposal, code: AgentErrorCode, decision?: PermissionDecision): void {
    const result = failure(code);
    this.saveTool(proposal, "denied", { approvalDecision: "denied", ...(decision ? { approvalScope: decision.approvalScope } : {}),
      result, error: code });
    this.outputBytes += Buffer.byteLength(JSON.stringify(result));
    if (this.outputBytes > this.limits.maxOutputBytes) throw new AgentError("output_limit");
  }

  private async execute(proposal: Proposal): Promise<void> {
    if (proposal.error) { this.deny(proposal, proposal.error); return; }
    const tool = proposal.tool!;
    const normal = this.policy.decide(tool, proposal.args, this.input.project);
    const decision:PermissionDecision = this.options.requireEffectReview&&tool.effect!=='read'&&normal.action==='allow'
      ? {...normal,action:'ask'} : normal;
    if (decision.action === "deny") { this.deny(proposal, "permission_denied", decision); return; }
    this.checkOutputBeforeTool();
    if (decision.action === "ask") {
      this.saveTool(proposal, "awaiting_approval", { approvalScope: decision.approvalScope });
      this.setRun("awaiting_approval");
      this.phase("awaiting_approval");
      this.check();
      let answer: "allow" | "deny" = "deny";
      if (this.input.approval) {
        try {
          answer = await abortable(() => this.input.approval!(freeze({ ...decision, runId: this.runRecord!.id,
            requestId: proposal.record!.requestId, toolId: proposal.record!.id,
            args: structuredClone(proposal.args) }), this.abort.signal), this.abort.signal);
        } catch {
          this.check();
          this.deny(proposal, "approval_failed", decision);
          this.setRun("running");
          return;
        }
      }
      this.check();
      if (answer !== "allow") { this.deny(proposal, "permission_denied", decision); this.setRun("running"); return; }
      this.setRun("running");
    }
    this.check();
    this.checkOutputBeforeTool();
    this.saveTool(proposal, "approved", { approvalScope: decision.approvalScope, approvalDecision: "approved" });
    this.phase("executing_tools");
    this.check();
    this.saveTool(proposal, "executing");
    let value: JsonValue | undefined, returned = false, dispatched = false;
    let executionError: unknown;
    const executionAbort = new AbortController();
    const stop = () => executionAbort.abort();
    this.abort.signal.addEventListener("abort", stop, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      if (this.workspaceLease?.check) {
        try { await this.workspaceLease.check(); }
        catch { throw new AgentError("lease_conflict"); }
      }
      this.check();
      this.checkOutputBeforeTool();
      // fence again at dispatch after async approval and any observer/event-loop delay.
      this.runRecord = this.persist(() => this.options.store.renewRunLease(this.runRecord!.id, this.lease!,
        this.options.leaseMs!, this.runRecord!.revision));
      dispatched = true;
      timeout = setTimeout(() => { timedOut = true; executionAbort.abort(); }, tool.timeoutMs ?? 120_000);
      // Deliberately no Promise.race: abort requests cleanup, settlement confirms it.
      value = await tool.execute(proposal.args, Object.freeze({ runId: this.runRecord!.id, requestId: proposal.record!.requestId,
        toolId: proposal.record!.id, project: this.input.project, signal: executionAbort.signal }));
      returned = true;
    } catch (error) {
      executionError = error;
    } finally {
      if (timeout) clearTimeout(timeout);
      this.abort.signal.removeEventListener("abort", stop);
    }
    if (this.storageFault) { this.uncertainty = dispatched; throw new AgentError("recovery_required"); }
    // Unknown outcome always outranks cancellation/timeout. Journal it before any queue cleanup.
    if (executionError instanceof AgentError && executionError.code === "outcome_unknown") this.unknownOutcome(proposal);
    let result: JsonValue;
    let code: AgentErrorCode | undefined;
    if (returned) {
      try { result = this.sanitizer.result(value, retainedResultBytes); }
      catch (error) {
        code = error instanceof AgentError ? error.code : "invalid_tool_result";
        // A generic failure cannot replace missing evidence about an executed side effect.
        if (tool.effect !== "read" || tool.scope !== "project") this.unknownOutcome(proposal, undefined, code);
        result = failure(code);
      }
    } else {
      code = timedOut ? "timeout" : this.abort.signal.aborted ? "aborted"
        : executionError instanceof AgentError && ["output_limit", "lease_conflict"].includes(executionError.code) ? executionError.code : "tool_failed";
      result = failure(code);
    }
    const outcome = observedToolOutcome(result);
    if (outcome === "outcome_unknown") this.unknownOutcome(proposal, result);
    if (timedOut) code = "timeout";
    else if (!code && outcome === "failed") code = "tool_failed";
    this.phase("recording_results");
    // after dispatch, persistence failure is never interpreted as permission to retry.
    this.saveTool(proposal, code ? "failed" : "succeeded", { result, ...(code ? { error: code } : {}) });
    this.outputBytes += Buffer.byteLength(JSON.stringify(result));
    if (code === "output_limit" || this.outputBytes > this.limits.maxOutputBytes) throw new AgentError("output_limit");
    if (code === "aborted" || code === "lease_conflict") throw new AgentError(code);
    this.check();
  }

  private checkOutputBeforeTool(): void {
    if (this.limits.maxOutputBytes - this.outputBytes < minimumResultBytes) throw new AgentError("output_limit");
  }

  private unknownOutcome(proposal: Proposal, result?: JsonValue, code: AgentErrorCode = "outcome_unknown"): never {
    this.uncertainty = true;
    // A prior recovery confirmation says nothing about this new executor's cleanup.
    this.cleanupConfirmed = this.options.settledUnknown?.(proposal.tool!.name)===true;
    this.phase("recording_results");
    this.saveTool(proposal, "outcome_unknown", { ...(result !== undefined ? { result } : {}), error: code });
    throw new AgentError("outcome_unknown");
  }

  private noteCycle(tools: ToolExecution[], enforce: boolean): void {
    const key = cycleDigest(tools);
    this.repeatedCycles = key === this.previousCycle ? this.repeatedCycles + 1 : 1;
    this.previousCycle = key;
    this.repeatedCycleError = tools.some((tool) => tool.status !== "succeeded") ? "repeated_failure" : "repeated_call";
    if (enforce && this.repeatedCycles >= this.limits.maxRepeatedCalls) {
      throw new AgentError(this.repeatedCycleError);
    }
  }

  private appendResults(): void {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant" || !last.tool_calls) return;
    for (const proposal of this.proposals) this.messages.push({ role: "tool", tool_call_id: proposal.call.id,
      content: JSON.stringify(proposal.result ?? failure(proposal.record?.status === "executing" || proposal.record?.status === "outcome_unknown"
        ? "outcome_unknown" : this.error?.code ?? "aborted")) });
  }

  private finish(): void {
    // cancel queued proposals before outcome_unknown moves the parent out of its active states.
    const cleanupCode = this.error?.code ?? "aborted";
    try {
      if (this.current && ["pending", "streaming"].includes(this.current.status)) {
        this.saveRequest(this.status === "interrupted" ? "interrupted" : "failed", { error: cleanupCode });
      }
      for (const proposal of this.proposals) {
        if (proposal.record && ["proposed", "awaiting_approval", "approved"].includes(proposal.record.status)) {
          this.saveTool(proposal, "cancelled", { result: failure(cleanupCode), error: cleanupCode });
        }
      }
      for (const proposal of this.proposals) {
        if (proposal.record?.status === "executing") {
          this.uncertainty = true;
          this.saveTool(proposal, "outcome_unknown", { error: "outcome_unknown" });
        }
      }
      if (this.storageFault || this.uncertainty) this.status = "recovery_required";
      if (this.runRecord!.status === "awaiting_approval" && this.status === "completed") this.setRun("running");
      this.setRun(this.status);
      // a storage wrapper can throw after committing; check durable rows before releasing.
      const unresolved = this.persist(() => this.options.store.listToolExecutions(this.runRecord!.id))
        .some((tool) => !terminalTools.has(tool.status))
        || this.persist(() => this.options.store.listRequestAttempts(this.runRecord!.id))
          .some((attempt) => ["pending", "streaming"].includes(attempt.status));
      if ((!unresolved && !this.uncertainty) || (this.cleanupConfirmed && this.status === "recovery_required")) {
        if (!this.persist(() => this.options.store.releaseRunLease(this.runRecord!.id, this.lease!, this.runRecord!.revision))) {
          throw new AgentError("persistence_failed");
        }
      }
    } catch {
      this.status = "recovery_required";
      this.error = {...safeAgentError("recovery_required"), ...(this.error?.storage ? {storage:this.error.storage} : {})};
      try { this.setRun("recovery_required"); } catch { /* retain the lease and require explicit recovery */ }
    }
    this.appendResults();
    if (this.status === "recovery_required") this.error = {...safeAgentError("recovery_required"), ...(this.error?.storage ? {storage:this.error.storage} : {})};
  }
}
