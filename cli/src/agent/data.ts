import { createHash } from "node:crypto";
import type { JsonValue } from "../types";
import { json as validateStoredJson } from "../storage/execution-validation";
import { AgentError } from "./errors";
import { redactRecognizableSecrets } from "../storage/secret-text";

const secretField = /^(?:api_?key|authorization|proxy_?authorization|password|passwd|secret|client_?secret|access_?token|refresh_?token|private_?key|credentials?|cookie|set_?cookie)$/i;

function normalizeText(value: string): string {
  let text = value;
  // Removing a control can join two fragments into another escape sequence.
  while (true) {
    const next = text
      .replace(/(?:\x1b\]|\u009d)[^\x07\x1b\u009c]*(?:\x07|\x1b\\|\u009c|$)|(?:\x1b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
    if (next === text) return text;
    text = next;
  }
}

export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function digest(value: JsonValue): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function boundedText(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  let result = "", size = 0;
  for (const character of text) {
    size += Buffer.byteLength(character);
    if (size > bytes) break;
    result += character;
  }
  return result;
}

/** configured secrets stay inside the runner and are never passed to tools. */
export class AgentSanitizer {
  private readonly secrets: string[];
  constructor(secrets: readonly string[] = []) {
    this.secrets = [...new Set(secrets.map(normalizeText).filter((secret) => secret.length > 0))].sort((a, b) => b.length - a.length);
  }

  text(value: string): string {
    let text = normalizeText(value);
    // Iterate to a fixed point: one replacement can expose another recognizable secret.
    // Empty fallback also handles a configured secret contained in the redaction marker.
    const marker = this.secrets.some((secret) => "[redacted]".includes(secret)) ? "" : "[redacted]";
    for (let pass = 0; pass < 16; pass++) {
      let next = text;
      for (const secret of this.secrets) next = next.split(secret).join(marker);
      next = redactRecognizableSecrets(next, marker);
      next = normalizeText(next);
      if (next === text) return text;
      text = next;
    }
    return "";
  }

  /** Hold the unfinished token and configured-secret prefixes across chunk boundaries. */
  partialText(value: string, settled = false): string {
    value = normalizeText(value);
    let end = settled ? value.length : value.search(/\S+$/);
    if (end < 0) end = value.length;
    for (const secret of this.secrets) {
      for (let length = Math.min(secret.length - 1, value.length); length > 0; length--) {
        if (value.endsWith(secret.slice(0, length))) { end = Math.min(end, value.length - length); break; }
      }
    }
    const privateKey = value.search(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/);
    if (privateKey >= 0 && !/-----END (?:[A-Z]+ )?PRIVATE KEY-----/.test(value.slice(privateKey))) end = Math.min(end, privateKey);
    const privatePrefix = value.search(/-----BEGIN[^\n]*$/);
    if (privatePrefix >= 0) end = Math.min(end, privatePrefix);
    return this.text(value.slice(0, end));
  }

  exact(value: unknown, max: number): void {
    try { validateStoredJson(value, max, "invalid_tool"); }
    catch { throw new AgentError("unsafe_data"); }
    const visit = (item: JsonValue): void => {
      if (typeof item === "string" && this.text(item) !== item) throw new AgentError("unsafe_data");
      if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) { visit(key); visit(child); }
    };
    visit(value as JsonValue);
  }

  /** Only parsed JSON enters this diagnostic. Never report values or arbitrary keys. */
  retentionIssue(value: JsonValue, max: number): { path: string; expected: string } {
    const fields = new Set(["operations", "content", "oldText", "newText", "hunks", "command", "args", "path", "query", "tasks", "title", "evidence", "summary", "stdin", "script", "value"]);
    let remaining = 16384;
    const visit = (item: JsonValue, path: string, depth: number): { path: string; expected: string } => {
      if (--remaining <= 0 || depth > 32) return { path, expected: "arguments within the documented structural limits" };
      if (typeof item === "string") {
        if (normalizeText(item) !== item) return { path, expected: "printable text without terminal controls; represent source controls using literal escapes" };
        if (this.text(item) !== item) return { path, expected: "text without literal credentials; reference environment variables or explicit placeholders" };
        return { path, expected: "text within the documented byte limit" };
      }
      if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        try { this.exact(child, max); } catch {
          return visit(child, path + (Array.isArray(item) ? `[${key}]` : fields.has(key) ? `.${key}` : "[field]"), depth + 1);
        }
      }
      return { path, expected: "recordable arguments within byte and structural limits, without sensitive fields" };
    };
    return visit(value, "$", 0);
  }

  result(value: unknown, max: number): JsonValue {
    let nodes = 0, bytes = 0;
    const ancestors = new Set<object>();
    const text = (value: string): string => {
      bytes += Buffer.byteLength(value);
      if (bytes > max) throw new AgentError("output_limit");
      return this.text(value);
    };
    const visit = (item: unknown, depth: number): JsonValue => {
      if (++nodes > 16_384 || depth > 32) throw new AgentError("invalid_tool_result");
      if (typeof item === "string") return text(item);
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "number" && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))) return Object.is(item, -0) ? 0 : item;
      if (!item || typeof item !== "object" || ancestors.has(item)) throw new AgentError("invalid_tool_result");
      ancestors.add(item);
      let output: JsonValue;
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 16_384 || Reflect.ownKeys(item).length !== item.length + 1) throw new AgentError("invalid_tool_result");
        output = Array.from({ length: item.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new AgentError("invalid_tool_result");
          return visit(descriptor.value, depth + 1);
        });
      } else {
        if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new AgentError("invalid_tool_result");
        const record: Record<string, JsonValue> = Object.create(null);
        for (const key of Reflect.ownKeys(item)) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new AgentError("invalid_tool_result");
          const safeKey = text(key);
          if (secretField.test(safeKey.replace(/[- ]/g, ""))) continue;
          if (Object.hasOwn(record, safeKey)) throw new AgentError("invalid_tool_result");
          record[safeKey] = visit(descriptor.value, depth + 1);
        }
        output = record;
      }
      ancestors.delete(item);
      return output;
    };
    const result = visit(value, 0);
    if (Buffer.byteLength(JSON.stringify(result)) > max) throw new AgentError("output_limit");
    this.exact(result, max);
    return result;
  }
}
