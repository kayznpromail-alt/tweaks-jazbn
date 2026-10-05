import type { RequestAttempt, Run, ToolExecution, Usage } from "../types";
import { StorageError, safely, type StorageErrorCode } from "./errors";
import { historyToolCall } from "../api/tool-calls";
import { EXECUTABLE_ARGUMENT_BYTES } from "../api/limits";
import { summarizeActivity } from "../agent/activity-summary";
import { hasRecognizableSecret } from "./secret-text";

export const runStatuses = ["running", "awaiting_approval", "completed", "failed", "interrupted", "recovery_required"] as const;
export const requestStatuses = ["pending", "streaming", "completed", "failed", "interrupted"] as const;
export const toolStatuses = ["proposed", "awaiting_approval", "approved", "denied", "executing", "succeeded", "failed", "cancelled", "outcome_unknown"] as const;
export const finalRequests = ["completed", "failed", "interrupted"];
export const finalTools = ["succeeded", "failed", "denied", "cancelled"];
export const executionLimits = Object.freeze({ jsonBytes: EXECUTABLE_ARGUMENT_BYTES, metadataBytes: 1024 * 1024, contextBytes: 12 * 1024 * 1024, outputBytes: 1024 * 1024, resultBytes: 1024 * 1024, nodes: 16_384, depth: 32 });

const secretField = /^(?:api_?key|authorization|proxy_?authorization|password|passwd|secret|client_?secret|access_?token|refresh_?token|private_?key|credentials?|cookie|set_?cookie)$/i;

export function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string"
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}

export function exact(value: unknown, fields: readonly string[], code: StorageErrorCode): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new StorageError(code);
}

export function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function safeText(value: unknown, max = 4096): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) && !hasRecognizableSecret(value);
}

export function label(value: unknown): value is string {
  return safeText(value) && value.length > 0 && value.trim() === value && !/[\r\n\t]/.test(value);
}

/** Check the stored UTF-8 bytes, including whitespace and escapes, before allocating parsed JSON. */
export function parseStoredJson(value: unknown, max: number, code: StorageErrorCode): unknown {
  return safely(code, () => {
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > max) throw new StorageError(code);
    return JSON.parse(value);
  });
}

/** Reject rather than redact: modifying arguments would invalidate approvals. Callers must remove
 * configured secrets before this boundary; generic secret detection cannot identify arbitrary values.
 */
export function json(value: unknown, max: number, code: StorageErrorCode): void {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const text = (value: unknown) => {
    if (!safeText(value, max)) throw new StorageError(code);
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > max) throw new StorageError(code);
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > executionLimits.nodes || depth > executionLimits.depth) throw new StorageError(code);
    if (typeof item === "string") text(item);
    else if (item === null || typeof item === "boolean") bytes += 5;
    else if (typeof item === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0) || (Number.isInteger(item) && !Number.isSafeInteger(item))) throw new StorageError(code);
      bytes += String(item).length;
    } else {
      if (!item || typeof item !== "object" || ancestors.has(item)) throw new StorageError(code);
      ancestors.add(item);
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > executionLimits.nodes
          || Reflect.ownKeys(item).length !== item.length + 1) throw new StorageError(code);
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new StorageError(code);
          visit(descriptor.value, depth + 1);
        }
      } else {
        if (!record(item)) throw new StorageError(code);
        for (const [key, child] of Object.entries(item)) {
          if (secretField.test(key.replace(/[- ]/g, ""))) throw new StorageError(code);
          text(key);
          visit(child, depth + 1);
        }
      }
      ancestors.delete(item);
    }
    if (bytes > max) throw new StorageError(code);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > max) throw new StorageError(code);
}

export function usage(value: unknown): asserts value is Usage {
  const code = "invalid_request";
  exact(value, ["inputTokens", "outputTokens", "totalTokens", "totalSource", "cachedInputTokens"], code);
  if (!integer(value.inputTokens) || !integer(value.outputTokens) || !integer(value.totalTokens)
    || (value.totalSource !== undefined && !["reported", "calculated"].includes(value.totalSource as string))
    || (value.totalSource === "calculated" && BigInt(value.totalTokens) !== BigInt(value.inputTokens) + BigInt(value.outputTokens))
    || (value.cachedInputTokens !== undefined && (!integer(value.cachedInputTokens) || value.cachedInputTokens > value.inputTokens))) {
    throw new StorageError(code);
  }
}

export const runFields = ["id", "revision", "sessionId", "status", "project", "model", "createdAt", "updatedAt", "ownerId", "leaseToken", "leaseExpiresAt", "requestLimit", "toolLimit", "metadata"] as const;
export const requestFields = ["id", "revision", "runId", "sequence", "status", "model", "context", "contextRef", "usage", "startedAt", "completedAt", "error", "output"] as const;
export const toolFields = ["id", "revision", "runId", "requestId", "sequence", "callId", "name", "args", "schemaVersion", "status", "approvalScope", "approvalDecision", "precondition", "result", "outputArtifactRef", "createdAt", "updatedAt", "startedAt", "completedAt", "error", "activity"] as const;

function common(value: Record<string, unknown>, code: StorageErrorCode): void {
  if (!label(value.id) || !integer(value.revision) || value.revision >= Number.MAX_SAFE_INTEGER) throw new StorageError(code);
  for (const field of ["createdAt", "updatedAt", "startedAt", "completedAt", "leaseExpiresAt"]) {
    if (value[field] !== undefined && !date(value[field])) throw new StorageError(code);
  }
  if (value.startedAt && value.completedAt && value.completedAt < value.startedAt) throw new StorageError(code);
  if (value.createdAt && value.updatedAt && value.updatedAt < value.createdAt) throw new StorageError(code);
  // Persist stable error codes, never raw provider/process/SQLite exceptions.
  if (value.error !== undefined && (typeof value.error !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.error))) throw new StorageError(code);
}

export function readRun(input: unknown): Run {
  return safely("invalid_run", () => {
    exact(input, runFields, "invalid_run");
    common(input, "invalid_run");
    if (![input.sessionId, input.project, input.model].every(label)
      || !date(input.createdAt) || !date(input.updatedAt) || !runStatuses.includes(input.status as Run["status"])) throw new StorageError("invalid_run");
    const ownerFields = [input.ownerId, input.leaseToken, input.leaseExpiresAt];
    if (ownerFields.some((value) => value !== undefined)
      && (!label(input.ownerId) || !label(input.leaseToken) || !date(input.leaseExpiresAt))) throw new StorageError("invalid_run");
    for (const field of ["requestLimit", "toolLimit"]) {
      if (input[field] !== undefined && (!integer(input[field]) || input[field] === 0)) throw new StorageError("invalid_run");
    }
    if (input.metadata !== undefined) json(input.metadata, executionLimits.metadataBytes, "invalid_run");
    return JSON.parse(JSON.stringify(input)) as Run;
  });
}

export function readRequest(input: unknown): RequestAttempt {
  return safely("invalid_request", () => {
    exact(input, requestFields, "invalid_request");
    common(input, "invalid_request");
    if (![input.runId, input.model].every(label) || !integer(input.sequence)
      || !requestStatuses.includes(input.status as RequestAttempt["status"])
      || (input.contextRef !== undefined && !label(input.contextRef))) throw new StorageError("invalid_request");
    if (input.context !== undefined) json(input.context, executionLimits.contextBytes, "invalid_request");
    if (input.usage !== undefined) usage(input.usage);
    if (input.output !== undefined) {
      exact(input.output, ["content", "finishReason", "toolCalls", "receivedBytes", "validation", "repairAttempt"], "invalid_request");
      const output = input.output;
      if (output.repairAttempt !== undefined && (!integer(output.repairAttempt) || Number(output.repairAttempt) < 1 || Number(output.repairAttempt) > 2)) throw new StorageError("invalid_request");
      if(output.validation!==undefined){
        exact(output.validation,["issues","repair","exhausted"],"invalid_request");
        const diagnostic=output.validation;
        if (diagnostic.exhausted !== undefined && typeof diagnostic.exhausted !== "boolean") throw new StorageError("invalid_request");
        if(!integer(diagnostic.repair)||Number(diagnostic.repair)>2||!Array.isArray(diagnostic.issues)||!diagnostic.issues.length||diagnostic.issues.length>64)throw new StorageError("invalid_request");
        for(const issue of diagnostic.issues){
          exact(issue,["tool","callId","stage","path","code","expected","receivedType","retryable"],"invalid_request");
          if(![issue.tool,issue.callId,issue.path,issue.expected,issue.receivedType].every(v=>typeof v==="string"&&v.length>0&&v.length<=4096)
            ||!["json","schema","contract"].includes(String(issue.stage))||!["invalid_json","type","required","additional_property","enum","constraint"].includes(String(issue.code))||issue.retryable!==true)throw new StorageError("invalid_request");
        }
      }
      json(output, executionLimits.outputBytes, "invalid_request");
      if (!(typeof output.content === "string" || output.content === null)
        || (output.receivedBytes !== undefined && !integer(output.receivedBytes))
        || (output.finishReason !== undefined && output.finishReason !== null && !label(output.finishReason))
        || (input.status === "pending")
        || (input.status === "completed" && output.finishReason === undefined)) throw new StorageError("invalid_request");
      if (output.toolCalls !== undefined) {
        if (!Array.isArray(output.toolCalls) || !output.toolCalls.length || output.toolCalls.length > 64
          || output.finishReason !== "tool_calls") throw new StorageError("invalid_request");
        const ids = new Set<string>();
        for (const call of output.toolCalls) {
          const validated = historyToolCall(call);
          if (ids.has(validated.id)) throw new StorageError("invalid_request");
          ids.add(validated.id);
        }
      } else if (output.finishReason === "tool_calls") throw new StorageError("invalid_request");
    }
    if ((input.status === "pending" && (input.startedAt !== undefined || input.completedAt !== undefined || input.usage !== undefined))
      || (input.status === "streaming" && (!date(input.startedAt) || input.completedAt !== undefined))
      || (finalRequests.includes(input.status as string) && !date(input.completedAt))
      || (input.status === "completed" && !date(input.startedAt))) throw new StorageError("invalid_request");
    return JSON.parse(JSON.stringify(input)) as RequestAttempt;
  });
}

export function readTool(input: unknown): ToolExecution {
  return safely("invalid_tool", () => {
    exact(input, toolFields, "invalid_tool");
    common(input, "invalid_tool");
    if (![input.runId, input.requestId, input.callId, input.schemaVersion].every(label)
      || typeof input.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.name)
      || !integer(input.sequence) || !toolStatuses.includes(input.status as ToolExecution["status"])
      || !date(input.createdAt) || !date(input.updatedAt) || !record(input.args)) throw new StorageError("invalid_tool");
    json(input.args, executionLimits.jsonBytes, "invalid_tool");
    if (input.precondition !== undefined) json(input.precondition, executionLimits.jsonBytes, "invalid_tool");
    if (input.result !== undefined) json(input.result, executionLimits.resultBytes, "invalid_tool");
    if (input.activity !== undefined) {
      json(input.activity, 32768, "invalid_tool");
      if (JSON.stringify(input.activity) !== JSON.stringify(summarizeActivity(input as unknown as ToolExecution))) throw new StorageError("invalid_tool");
    }
    for (const field of ["approvalScope", "outputArtifactRef"]) {
      if (input[field] !== undefined && !label(input[field])) throw new StorageError("invalid_tool");
    }
    if (input.approvalDecision !== undefined && !["approved", "denied"].includes(input.approvalDecision as string)) throw new StorageError("invalid_tool");
    if (["approved", "executing", "succeeded", "failed", "outcome_unknown"].includes(input.status as string)
      && (input.approvalDecision !== "approved" || !label(input.approvalScope))) throw new StorageError("invalid_tool");
    if (input.status === "awaiting_approval" && !label(input.approvalScope)) throw new StorageError("invalid_tool");
    if (input.status === "denied" && input.approvalDecision !== "denied") throw new StorageError("invalid_tool");
    if (["executing", "succeeded", "failed", "outcome_unknown"].includes(input.status as string) && !date(input.startedAt)) throw new StorageError("invalid_tool");
    if (finalTools.includes(input.status as string)) {
      if (!date(input.completedAt) || input.result === undefined) throw new StorageError("invalid_tool");
    } else if ((input.result !== undefined && input.status !== "outcome_unknown") || input.completedAt !== undefined) throw new StorageError("invalid_tool");
    if (["proposed", "awaiting_approval"].includes(input.status as string) && input.approvalDecision !== undefined) throw new StorageError("invalid_tool");
    if (["proposed", "awaiting_approval", "approved", "denied", "cancelled"].includes(input.status as string) && input.startedAt !== undefined) throw new StorageError("invalid_tool");
    return JSON.parse(JSON.stringify(input)) as ToolExecution;
  });
}
