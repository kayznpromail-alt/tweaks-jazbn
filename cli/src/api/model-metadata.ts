import type { ToolDefinition } from "../types";
import { AgentError } from "../agent/errors";
import { parseModelContext, type ModelContext } from "./context-metadata";

export interface ModelMetadata {
  version: 1; adapter: "chat-completions-tools-v1"; evidence: "operator_verified_cycle";
  context_tokens: number; output_tokens: number; tools: boolean;
  output_parameter: "max_tokens" | "max_completion_tokens"; verified_at: string;
}

export function parseModelMetadata(value: unknown): ModelMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as ModelMetadata;
  if (Object.keys(v).sort().join() !== "adapter,context_tokens,evidence,output_parameter,output_tokens,tools,verified_at,version"
    || v.version !== 1 || v.adapter !== "chat-completions-tools-v1" || v.evidence !== "operator_verified_cycle"
    || !Number.isSafeInteger(v.context_tokens) || v.context_tokens < 1024 || v.context_tokens > 10000000
    || !Number.isSafeInteger(v.output_tokens) || v.output_tokens < 1 || v.output_tokens >= v.context_tokens
    || typeof v.tools !== "boolean" || !["max_tokens", "max_completion_tokens"].includes(v.output_parameter)
    || typeof v.verified_at !== "string" || !Number.isFinite(Date.parse(v.verified_at)) || new Date(v.verified_at).toISOString() !== v.verified_at) return;
  return { ...v };
}

export { parseModelContext, type ModelContext } from "./context-metadata";

/** local storage/compaction bounds are bytes, never a model token window. */
export function modelContextBudget(metadata: ModelMetadata | undefined, tools: ToolDefinition[], fallback: number, reservation = 0, context?: ModelContext) {
  if (!Number.isSafeInteger(fallback) || fallback < 2 || !Number.isSafeInteger(reservation) || reservation < 0) throw new AgentError("context_limit");
  const window = parseModelContext(context)?.context_tokens ?? metadata?.context_tokens;
  const maxBytes = window ? fallback : Math.min(fallback, 1024 * 1024);
  const tokenBudget = window ? { windowTokens: window, outputTokens: metadata?.output_tokens,
    toolBytes: Buffer.byteLength(JSON.stringify(tools)) + reservation } : undefined;
  if (!metadata) return { maxBytes, method: "unverified_byte_cap" as const, ...(tokenBudget ? { tokenBudget } : {}) };
  if (tools.length && !metadata.tools) throw new AgentError("model_forbidden");
  return { maxBytes, method: "unverified_byte_cap" as const, tokenBudget, outputTokens: metadata.output_tokens, outputParameter: metadata.output_parameter };
}
