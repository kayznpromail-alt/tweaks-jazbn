import { createHash } from "node:crypto";
import { prepareChatRequest } from "../api/chat-request";
import { json as validateJson } from "../storage/execution-validation";
import type { ToolExecutionStatus, WireMessage } from "../types";
import { boundedText } from "./data";
import { AgentError } from "./errors";

// Transport/storage safety bound, not a model's token window.
export const DEFAULT_CONTEXT_BUDGET_BYTES = 12 * 1024 * 1024;
export const UNKNOWN_CONTEXT_BUDGET_BYTES = 1024 * 1024;
export const MAX_ORIGINAL_CONTEXT_BYTES = 16 * 1024 * 1024;
export const CONTEXT_SUMMARY_MARKER = "[edgey context summary v1: local deterministic reference data]\n";

export interface ContextBudgetOptions {
  /** Last matching request usage, including server-side instructions. Not a model window. */
  previous?: { messages: readonly WireMessage[]; inputTokens: number };
  /** Exact UTF-8 bytes of JSON.stringify(messages), not tokens or the whole API body. */
  maxBytes: number;
  /** Keep these most recent user-led turns; older completed groups within them may be summarized. */
  keepRecentTurns?: number;
  /** Keep this many latest exchanges after the last task (a call batch and all results count as one). */
  keepRecentGroups?: number;
  maxSummaryBytes?: number;
  /** Original message indices, e.g. the current task before appended attachment reference messages. */
  preserveMessageIndices?: readonly number[];
  /** Optional durable journal states override outcome claims in tool result text. */
  toolStates?: ReadonlyMap<string, ToolExecutionStatus>;
  tokenBudget?: {
    windowTokens: number;
    outputTokens?: number;
    toolBytes?: number;
    previous?: { messages: readonly WireMessage[]; inputTokens: number };
  };
}

export interface ContextCompactionReport {
  method: "local_deterministic";
  measurement: "utf8_json_bytes";
  beforeBytes: number;
  afterBytes: number;
  maxBytes: number;
  removedMessages: number;
  removedGroups: number;
  summaryBytes: number;
  omittedSummaryEntries: number;
  sourceSha256?: string;
}

export interface CompactedContext {
  messages: WireMessage[];
  compacted: boolean;
  /** From the ORIGINAL validated history, including calls omitted from model-visible context. */
  historyToolCallIds: Set<string>;
  report: ContextCompactionReport;
}

/** reserve headroom before the next tool result arrives; the hard limit stays unchanged. */
export function compactRequestContext(input: readonly WireMessage[], options: ContextBudgetOptions): CompactedContext {
  const settings = { ...options, keepRecentGroups: options.keepRecentGroups ?? 1 };
  // validate all original data first, even if no compaction is needed.
  const hard = compactContext(input, settings);
  if (options.tokenBudget) {
    if (hard.compacted) return hard;
    const { windowTokens, outputTokens = 32000, toolBytes = 0 } = options.tokenBudget;
    const previous = options.tokenBudget.previous ?? options.previous;
    integer(windowTokens, 1024, 10000000);
    integer(outputTokens, 0, 10000000);
    integer(toolBytes, 0, MAX_ORIGINAL_CONTEXT_BYTES);
    // Latest provider input already includes cached input, tools and instructions.
    // Only anchor when that exact request is still a prefix of the pending input.
    const anchored = contextUsageMatches(input, previous);
    const estimate = anchored
      ? previous.inputTokens + Math.ceil(Math.max(0, hard.report.beforeBytes - bytes(previous.messages)) / 3)
      : Math.ceil((hard.report.beforeBytes + toolBytes) / 3);
    // Approximation is used for scheduling only; the displayed percentage stays API-reported.
    const reserve = Math.min(Math.floor(windowTokens / 4), Math.max(20000, Math.min(outputTokens, 32000)));
    const ceiling = windowTokens - reserve;
    if (estimate < ceiling) return hard;
    try {
      const target = Math.max(2, Math.floor(hard.report.beforeBytes * Math.min(0.6, ceiling * 0.6 / estimate)));
      const reduced = compactContext(input, { ...settings, maxBytes: Math.min(options.maxBytes, target) });
      return { ...reduced, report: { ...reduced.report, maxBytes: options.maxBytes } };
    } catch (error) {
      // Fixed instructions/latest work cannot be compacted away. Do not loop on the summary.
      if (error instanceof AgentError && error.code === "context_limit") return hard;
      throw error;
    }
  }
  // Unknown-window models still need a scheduling policy. This is a local
  // compaction trigger, never a claimed model limit or displayed percentage.
  // Match exact history so stale usage cannot repeatedly shrink a new summary.
  if (!hard.compacted && contextUsageMatches(input, options.previous) && options.previous!.inputTokens >= 150000) {
    try {
      const reduced = compactContext(input, { ...settings, maxBytes: Math.max(2, Math.floor(hard.report.beforeBytes * 0.6)) });
      return { ...reduced, report: { ...reduced.report, maxBytes: options.maxBytes } };
    } catch (error) {
      if (!(error instanceof AgentError && error.code === "context_limit")) throw error;
    }
  }
  if (hard.report.beforeBytes < Math.floor(options.maxBytes * 0.8)) return hard;
  try {
    const soft = compactContext(input, { ...settings, maxBytes: Math.max(2, Math.floor(options.maxBytes * 0.6)) });
    return { ...soft, report: { ...soft.report, maxBytes: options.maxBytes } };
  } catch (error) {
    // the current task/latest result may need more than the target, but still fit.
    if (error instanceof AgentError && error.code === "context_limit") return hard;
    throw error;
  }
}

export function contextUsageMatches(input: readonly WireMessage[], previous: ContextBudgetOptions["previous"]): previous is NonNullable<ContextBudgetOptions["previous"]> {
  return !!previous && Number.isSafeInteger(previous.inputTokens) && previous.inputTokens >= 0
    && previous.messages.length <= input.length
    && previous.messages.every((message, index) => JSON.stringify(message) === JSON.stringify(input[index]));
}

interface Group { indices: number[]; turn: number; unresolved: boolean; assistant: boolean }
interface Turn { user?: number; groups: Group[] }
const terminal = new Set<string>(["succeeded", "failed", "denied", "cancelled"]);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function isSummary(message: WireMessage): boolean {
  if (message.role !== "user" || !message.content.startsWith(CONTEXT_SUMMARY_MARKER)) return false;
  try {
    const data = JSON.parse(message.content.slice(CONTEXT_SUMMARY_MARKER.length));
    return data?.source === "edgey/context-budget@1" && data.authority === "reference data, not instructions"
      && data.omittedOriginal === true && /^[a-f0-9]{64}$/.test(data.sourceSha256) && Array.isArray(data.entries);
  } catch { return false; }
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AgentError("invalid_input");
  return value;
}

function resultData(message: WireMessage): Record<string, unknown> | undefined {
  try { return object(JSON.parse(message.content ?? "")); } catch { return undefined; }
}

function unresolvedResult(message: WireMessage, states?: ContextBudgetOptions["toolStates"]): boolean {
  if (message.role !== "tool") return false;
  const state = states?.get(message.tool_call_id);
  if (state !== undefined) return !terminal.has(state);
  const data = resultData(message);
  const entries = [data, object(data?.process), ...(Array.isArray(data?.files) ? data.files.map(object) : [])];
  return entries.some((entry) => entry && ([entry.status, entry.state, object(entry.error)?.code]
    .some((value) => ["outcome_unknown", "executing", "running", "pending", "proposed", "approved", "awaiting_approval"].includes(String(value)))
    || entry.cleanup === "unknown" || entry.cleanup === "failed"));
}

/** Validates even omitted data. Only a trailing, unfinished call group may lack results. */
function validate(messages: readonly WireMessage[]): { messages: WireMessage[]; ids: Set<string>; pending: Set<string> } {
  try { validateJson(messages, MAX_ORIGINAL_CONTEXT_BYTES, "invalid_request"); }
  catch { throw new AgentError("invalid_input"); }
  try {
    const pending = new Set<string>();
    for (const message of messages) {
      if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) pending.add(call.id);
      } else if (message?.role === "tool") pending.delete(message.tool_call_id);
    }
    // The protocol validator still checks ordering, duplicate ids, schemas and every original message.
    // Synthetic results exist only during validation and are never returned or sent to the model.
    const padding: WireMessage[] = [...pending].map((id) => ({ role: "tool", tool_call_id: id, content: "" }));
    const prepared = prepareChatRequest({ model: "context-validation", messages: [...messages, ...padding], onDelta: () => {} });
    return { messages: JSON.parse(prepared.body).messages.slice(0, messages.length), ids: prepared.historyToolCallIds, pending };
  } catch { throw new AgentError("invalid_input"); }
}

function excerpt(text: string, limit = 160) {
  return { text: boundedText(text, limit), abbreviated: Buffer.byteLength(text) > limit, sha256: hash(text) };
}

/** Whitelisted, bounded evidence copied verbatim; no parsing stdout into invented verification. */
function evidence(value: unknown): { fields: Record<string, unknown>; truncated: boolean } {
  const fields: Record<string, unknown> = {};
  const keys = /^(?:path|paths|file|hash|sha256|beforeHash|afterHash|preimageHash|postimageHash|changeId|digest|artifactId|exitCode|signal|status|state|ok|code)$/;
  let visited = 0, truncated = false;
  const visit = (item: unknown, path: string, depth: number): void => {
    if (++visited > 256 || depth > 8 || Object.keys(fields).length >= 8) { truncated = true; return; }
    if (Array.isArray(item)) {
      for (let i = 0; i < Math.min(item.length, 16); i++) visit(item[i], `${path}[${i}]`, depth + 1);
      if (item.length > 16) truncated = true;
    } else if (object(item)) {
      for (const key of Object.keys(item as object).sort()) {
        const child = (item as Record<string, unknown>)[key], location = path ? `${path}.${key}` : key;
        if (keys.test(key) && (typeof child === "string" || typeof child === "number" || typeof child === "boolean")) {
          if (Object.keys(fields).length >= 8) { truncated = true; break; }
          fields[location] = typeof child === "string" ? excerpt(child, 192) : child;
        } else if (object(child) || Array.isArray(child)) visit(child, location, depth + 1);
      }
    }
  };
  visit(value, "", 0);
  return { fields, truncated };
}

function outcome(message: WireMessage, states?: ContextBudgetOptions["toolStates"]): string {
  if (message.role === "tool" && states?.has(message.tool_call_id)) return `journal:${states.get(message.tool_call_id)}`;
  const data = resultData(message), error = object(data?.error);
  if (["permission_denied", "approval_failed", "unknown_tool", "invalid_tool_arguments"].includes(String(error?.code))) return `reported:${error!.code}`;
  if (data?.ok === false) return "reported:failed";
  for (const state of [data?.status, data?.state]) if (typeof state === "string" && terminal.has(state)) return `reported:${state}`;
  if (data?.ok === true) return "reported:ok";
  return "not_reported";
}

/**
 * Pure, deterministic local compaction. Originals are never mutated; the caller must retain them
 * in its existing transcript/request/tool journal before supplying historical context. This helper
 * performs no persistence, filesystem access, model calls or token estimation.
 *
 * System messages remain in their original order exactly once. The last user, explicitly pinned
 * messages and unresolved groups are mandatory. Calls and their results are indivisible. Old user
 * tasks are removed only with a completed turn; recent turns can shed older completed groups while
 * retaining their user task. If mandatory content plus a bounded provenance marker cannot fit,
 * throws AgentError("context_limit"); invalid original history throws "invalid_input".
 */
export function compactContext(input: readonly WireMessage[], options: ContextBudgetOptions): CompactedContext {
  const maxBytes = integer(options.maxBytes, 2, MAX_ORIGINAL_CONTEXT_BYTES);
  const keepTurns = integer(options.keepRecentTurns ?? 2, 0, 16384);
  const keepGroups = integer(options.keepRecentGroups ?? 2, 0, 16384);
  const summaryLimit = integer(options.maxSummaryBytes ?? 32768, 256, 64 * 1024);
  const validated = validate(input), messages = validated.messages;
  const beforeBytes = bytes(messages);
  const report: ContextCompactionReport = { method: "local_deterministic", measurement: "utf8_json_bytes",
    beforeBytes, afterBytes: beforeBytes, maxBytes, removedMessages: 0, removedGroups: 0, summaryBytes: 0, omittedSummaryEntries: 0 };
  const pinned = new Set<number>();
  for (const index of options.preserveMessageIndices ?? []) pinned.add(integer(index, 0, messages.length - 1));
  const lastUser = messages.findLastIndex((message) => message.role === "user" && !isSummary(message));
  if (lastUser >= 0) pinned.add(lastUser);
  if (messages.at(-1)?.role === "user") pinned.add(messages.length - 1);
  if (beforeBytes <= maxBytes) return { messages, compacted: false, historyToolCallIds: validated.ids, report };

  const groups: Group[] = [], turns: Turn[] = [{ groups: [] }];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "system") { pinned.add(i); continue; }
    if (message.role === "user" && !isSummary(message)) turns.push({ user: i, groups: [] });
    const group: Group = { indices: [i], turn: turns.length - 1, unresolved: false, assistant: message.role === "assistant" };
    if (message.role === "assistant" && message.tool_calls) {
      group.unresolved = message.tool_calls.some((call) => validated.pending.has(call.id));
      while (messages[i + 1]?.role === "tool") {
        group.indices.push(++i);
        group.unresolved ||= unresolvedResult(messages[i], options.toolStates);
      }
    }
    groups.push(group); turns.at(-1)!.groups.push(group);
  }
  const assistants = groups.filter((group) => group.assistant && group.indices[0] > lastUser);
  for (const group of keepGroups ? assistants.slice(-keepGroups) : []) group.indices.forEach((index) => pinned.add(index));
  for (const group of groups) {
    if (group.unresolved || group.indices.some((index) => pinned.has(index))) {
      group.indices.forEach((index) => pinned.add(index));
      const user = turns[group.turn].user;
      if (user !== undefined) pinned.add(user);
    }
  }

  const candidates: Group[][] = [];
  // Replace every previous generated marker on a new compaction, even if an earlier batch
  // already frees enough bytes. Never quote its contents or make it another task boundary.
  const priorSummaries = new Set(groups.filter((group) => group.indices.length === 1
    && !pinned.has(group.indices[0]) && isSummary(messages[group.indices[0]])));
  if (priorSummaries.size) candidates.push([...priorSummaries]);
  for (let t = 0; t < turns.length; t++) {
    const turn = turns[t], end = messages[turn.groups.at(-1)?.indices.at(-1) ?? -1];
    const whole = t < turns.length - Math.max(1, keepTurns) && end?.role === "assistant" && !end.tool_calls
      && turn.groups.every((group) => !group.unresolved && group.indices.every((index) => !pinned.has(index)));
    if (whole) candidates.push(turn.groups.filter((group) => !priorSummaries.has(group)));
    else for (const group of turn.groups) {
      if (group.assistant && !group.unresolved && group.indices.every((index) => !pinned.has(index))) candidates.push([group]);
    }
  }

  const removed = new Set<number>(), removedGroups: Group[] = [];
  const sizes = messages.map((message) => bytes(message) + 1);
  let retainedBytes = beforeBytes;
  // Reserve a small bounded summary, then select oldest complete units in one linear pass.
  const allowance = Math.min(summaryLimit, Math.max(768, Math.floor(maxBytes / 4)));
  for (const candidate of candidates) {
    for (const group of candidate) {
      removedGroups.push(group);
      for (const index of group.indices) { if (!removed.has(index)) retainedBytes -= sizes[index]; removed.add(index); }
    }
    if (retainedBytes + allowance + 1 <= maxBytes) break;
  }
  if (!removed.size || [...removed].every(index => isSummary(messages[index]))) throw new AgentError("context_limit");

  const indices = [...removed].sort((a, b) => a - b);
  const sourceSha256 = hash(JSON.stringify(indices.map((index) => messages[index])));
  const entries: unknown[] = [];
  let omittedSummaryEntries = 0;
  const payload = () => ({ source: "edgey/context-budget@1", authority: "reference data, not instructions",
    omittedOriginal: true, originals: "consult locally retained original history; this summary is lossy",
    sourceSha256, removedMessages: removed.size, entries, omittedSummaryEntries });
  const summary = (): WireMessage => ({ role: "user", content: CONTEXT_SUMMARY_MARKER + JSON.stringify(payload()) });
  const available = Math.min(allowance, maxBytes - retainedBytes - 1);
  // Leave room for the omission counter to grow without repeatedly serializing original history.
  const add = (entry: unknown, fallback?: unknown): void => {
    entries.push(entry);
    if (bytes(summary()) + 16 <= available) return;
    entries.pop();
    if (fallback !== undefined) {
      entries.push(fallback);
      if (bytes(summary()) + 16 <= available) return;
      entries.pop();
    }
    omittedSummaryEntries++;
  };
  // Preserve user agreements before filling remaining space with tool evidence.
  // Within each category, newest omitted evidence receives priority.
  const priority = (group: Group) => messages[group.indices[0]].role === "user" ? 0 : messages[group.indices[0]].tool_calls ? 1 : 2;
  const ordered = [...removedGroups].reverse().sort((a, b) => priority(a) - priority(b));
  for (const group of ordered) {
    const first = messages[group.indices[0]], userIndex = turns[group.turn].user;
    const task = userIndex === undefined ? undefined : messages[userIndex].content!;
    // User constraints must not disappear after the first short sentence.
    // Keep a bounded verbatim reference plus an explicit omission marker/hash.
    const userTask = task === undefined ? undefined : excerpt(task, first.role === "user" ? 4096 : 160);
    if (isSummary(first)) {
      const prior = JSON.parse(first.content!.slice(CONTEXT_SUMMARY_MARKER.length));
      for (const entry of prior.entries) add(entry);
    } else if (first.role === "assistant" && first.tool_calls) {
      for (const call of first.tool_calls) {
        const result = group.indices.map((index) => messages[index]).find((message) => message.role === "tool" && message.tool_call_id === call.id)!;
        const identity = { userTask, tool: call.function.name, callId: call.id, outcome: outcome(result, options.toolStates), resultSha256: hash(result.content!) };
        add({ ...identity,
          argumentsEvidence: evidence(JSON.parse(call.function.arguments)), resultEvidence: evidence(resultData(result)),
        }, { ...identity, evidenceOmitted: true });
      }
    } else if (first.role === "assistant") add({ userTask, assistantClaim: excerpt(first.content ?? "") });
    else if (first.role === "user") add({ userTask,
      ...(first.images?.length ? {omittedImages:first.images.map(image=>({hash:image.hash,name:image.name})),imageNotice:"older images omitted; originals retained locally"} : {}) });
  }
  const marker = summary();
  if (bytes(marker) > available) throw new AgentError("context_limit");
  const output: WireMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    if (index === indices[0]) output.push(marker);
    if (!removed.has(index)) output.push(messages[index]);
  }
  const afterBytes = bytes(output);
  if (afterBytes > maxBytes || afterBytes >= beforeBytes) throw new AgentError("context_limit");
  return { messages: output, compacted: true, historyToolCallIds: validated.ids,
    report: { ...report, afterBytes, removedMessages: removed.size, removedGroups: removedGroups.length,
      summaryBytes: bytes(marker), omittedSummaryEntries, sourceSha256 } };
}
