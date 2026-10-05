import type { Usage } from "../types";
import { ApiError, isRecord } from "./errors";

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError("invalid_response");
  }
  return value;
}

function alias(usage: Record<string, unknown>, primary: string, alternate: string): number | undefined {
  if (usage[primary] !== undefined) return count(usage[primary]);
  return usage[alternate] === undefined ? undefined : count(usage[alternate]);
}

function cachedCount(usage: Record<string, unknown>): number | undefined {
  for (const name of ["prompt_tokens_details", "input_tokens_details"]) {
    const details = usage[name];
    if (details == null) continue;
    if (!isRecord(details)) throw new ApiError("invalid_response");
    if (details.cached_tokens === undefined) continue;
    return count(details.cached_tokens);
  }
  return undefined;
}

/** complete snapshots replace earlier ones; partial reports never invent missing counters. */
function parseUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) throw new ApiError("invalid_response");
  const inputTokens = alias(value, "prompt_tokens", "input_tokens");
  const outputTokens = alias(value, "completion_tokens", "output_tokens");
  const reportedTotal = value.total_tokens == null ? undefined : count(value.total_tokens);
  let cachedInputTokens = cachedCount(value);
  // messages cache counters exclude the ordinary input and need a different protocol adapter.
  if (value.prompt_tokens === undefined
    && (value.cache_creation_input_tokens !== undefined || value.cache_read_input_tokens !== undefined)) {
    throw new ApiError("invalid_response");
  }
  if (inputTokens !== undefined && cachedInputTokens !== undefined && cachedInputTokens > inputTokens) {
    cachedInputTokens = undefined;
  }
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  if (reportedTotal === undefined && inputTokens > Number.MAX_SAFE_INTEGER - outputTokens) {
    throw new ApiError("invalid_response");
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? inputTokens + outputTokens,
    totalSource: reportedTotal === undefined ? "calculated" : "reported",
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
  };
}

export type UsageReport = { kind: "absent" | "partial" } | { kind: "complete"; usage: Usage; warning?: "cached_tokens_exceed_input" };

/** the gateway observes these same three usage locations; no recursive object search. */
export function readCompletionUsage(payload: Record<string, unknown>): UsageReport {
  const candidates = [payload.usage,
    isRecord(payload.response) ? payload.response.usage : undefined,
    isRecord(payload.message) ? payload.message.usage : undefined];
  for (const value of candidates) {
    if (value == null) continue;
    const usage = parseUsage(value);
    const cached = isRecord(value) ? cachedCount(value) : undefined;
    return usage ? { kind: "complete", usage, ...(cached !== undefined && cached > usage.inputTokens ? {warning:"cached_tokens_exceed_input" as const} : {}) } : { kind: "partial" };
  }
  return { kind: "absent" };
}
