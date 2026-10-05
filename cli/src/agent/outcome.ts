import type { JsonObject, JsonValue } from "../types";

export type ObservedToolOutcome = "succeeded" | "failed" | "outcome_unknown";

function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** Interpret executor envelopes only; arbitrary text/output cannot grant authority. */
export function observedToolOutcome(result: JsonValue): ObservedToolOutcome {
  const envelope = object(result);
  if (!envelope) return "succeeded";
  const process = object(envelope.process);
  const files = Array.isArray(envelope.files) ? envelope.files.map(object).filter((file) => file !== undefined) : [];
  const envelopes = [envelope, ...(process ? [process] : []), ...files];
  if (envelopes.some((entry) => entry.state === "outcome_unknown" || entry.status === "outcome_unknown"
    || entry.state === "executing" || entry.cleanup === "unknown" || entry.cleanup === "failed"
    || object(entry.error)?.code === "outcome_unknown")) return "outcome_unknown";
  if (envelopes.some((entry) => entry.ok === false
    || (typeof entry.status === "string" && ["failed", "partial", "aborted", "timed_out", "cancelled"].includes(entry.status))
    || (typeof entry.state === "string" && ["failed", "partial"].includes(entry.state)))) return "failed";
  return "succeeded";
}
