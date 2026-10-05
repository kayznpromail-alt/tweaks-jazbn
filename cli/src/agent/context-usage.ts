import type { Gateway, Usage } from "../types";
import { parseModelContext } from "../api/context-metadata";

export interface ContextUsage {
  usedBytes: number;
  maxBytes: number;
  method: string;
  outputTokens?: number;
  full?: boolean;
  exhaustedBy?: "provider";
  model?: string;
  inputTokens?: number;
  windowTokens?: number;
  windowSource?: "provider_catalog" | "operator_verified_cycle";
}

export const NEW_CONTEXT_HINT = "context 100% · type /new to start a new chat in the same project. project files and previous chats are kept; describe the next task in the new chat.";

export function contextLimit(code: string | undefined): boolean {
  return code === "model_context_exceeded" || code === "context_length_exceeded";
}

export function readContextUsage(value: unknown): ContextUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as ContextUsage;
  if (!Number.isSafeInteger(v.usedBytes) || v.usedBytes < 0 || !Number.isSafeInteger(v.maxBytes) || v.maxBytes < 1
    || !["unverified_byte_cap", "estimated_utf8_upper_bound"].includes(v.method)
    || (v.full !== undefined && typeof v.full !== "boolean")
    || (v.outputTokens !== undefined && (!Number.isSafeInteger(v.outputTokens) || v.outputTokens < 1))) return;
  if ((v.model !== undefined && (typeof v.model !== "string" || !v.model || v.model.length > 512))
    || (v.inputTokens !== undefined && (!Number.isSafeInteger(v.inputTokens) || v.inputTokens < 0 || !v.model))
    || (v.windowTokens !== undefined && (!Number.isSafeInteger(v.windowTokens) || v.windowTokens < 1024 || v.windowTokens > 10000000 || !v.model
      || !["provider_catalog", "operator_verified_cycle"].includes(v.windowSource!)))
    || (v.exhaustedBy !== undefined && v.exhaustedBy !== "provider")) return;
  // legacy byte-derived full flags must not lock saved conversations after upgrading.
  return { usedBytes: v.usedBytes, maxBytes: v.maxBytes, method: v.method,
    ...(v.full === undefined ? {} : { full: v.full && v.exhaustedBy === "provider" }),
    ...(v.exhaustedBy ? { exhaustedBy: v.exhaustedBy } : {}),
    ...(v.model ? { model: v.model } : {}), ...(v.inputTokens === undefined ? {} : { inputTokens: v.inputTokens }),
    ...(v.windowTokens === undefined ? {} : { windowTokens: v.windowTokens, windowSource: v.windowSource }),
    ...(v.outputTokens === undefined ? {} : { outputTokens: v.outputTokens }) };
}

export function contextPercent(context: ContextUsage): number | undefined {
  if (context.full && context.exhaustedBy === "provider") return 100;
  if (context.inputTokens === undefined || context.windowTokens === undefined) return;
  return Math.min(100, Math.floor(context.inputTokens / context.windowTokens * 100));
}

/** usage is one request snapshot, including cached/system/tool input; never sum a session. */
export function measuredContext(context: ContextUsage, gateway: Gateway, model: string, usage?: Usage): ContextUsage {
  const verified = gateway.modelMetadata?.(model);
  const metadata = parseModelContext(gateway.modelContext?.(model)) ?? parseModelContext({ version: verified?.version, context_tokens: verified?.context_tokens, source: verified?.evidence });
  return { usedBytes: context.usedBytes, maxBytes: context.maxBytes, method: context.method, model,
    ...(context.outputTokens === undefined ? {} : { outputTokens: context.outputTokens }),
    ...(metadata ? { windowTokens: metadata.context_tokens, windowSource: metadata.source } : {}),
    ...(usage ? { inputTokens: usage.inputTokens } : {}) };
}
