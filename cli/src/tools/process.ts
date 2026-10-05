import { supervisor } from "./process-supervisor";
import { contractIssue, toolParameters } from "./contracts";
import { ToolArgumentError } from "../api/tool-validation";
import { WorkspaceError } from "../workspace/errors";
declare const EDGEY_COMPILED: boolean;
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import { AgentSanitizer } from "../agent/data";
import { AgentError } from "../agent/errors";
import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import { validateArguments } from "../api/tool-schema";
import type { JsonObject, JsonValue, ToolSchema } from "../types";
import { ArtifactStore, ensureDirectory, readPrivate } from "../workspace/artifacts";
import { checkAbsoluteDirectory, pathKey, WorkspacePaths } from "../workspace/paths";

import { PROCESS_LIMITS, PROCESS_POLICIES } from "./process-limits";
export { PROCESS_LIMITS, PROCESS_POLICIES } from "./process-limits";
export type ProcessCategory = "short" | "build" | "server";
export type ProcessPolicies = Readonly<Record<ProcessCategory, Readonly<{ defaultMs: number; maxMs: number }>>>;
export function processPolicy(input: Pick<ProcessInput, "category" | "timeoutMs" | "background">,
  policies: ProcessPolicies = PROCESS_POLICIES): { category: ProcessCategory; timeoutMs: number; background: boolean } {
  const category = input.category ?? "short";
  if (!["short", "build", "server"].includes(category)) bad("invalid_category");
  const policy = policies[category], timeoutMs = input.timeoutMs ?? policy.defaultMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > policy.maxMs) bad("invalid_timeout");
  if (category === "server" && input.background === false) bad("server_requires_background");
  return { category, timeoutMs, background: category === "server" || input.background === true };
}
export interface ProcessOptions {
  project: string; artifactDir: string; secrets?: readonly string[];
  /** Synchronous host ownership fence. Cleanup never calls this hook. */
  beforeEffect?: () => void;
  /** Host fixtures may reduce policy deadlines; callers cannot raise production ceilings. */
  policies?: ProcessPolicies;
  inputWaitMs?: number;
  onChange?: (job: ProcessSummary) => void;
}
export interface ProcessInput {
  executable: string; args?: readonly string[]; cwd?: string; env?: Readonly<Record<string, string>>;
  input?: string; interactive?: boolean; timeoutMs?: number; category?: ProcessCategory; background?: boolean; ownerId?: string; signal?: AbortSignal;
  /** Host-only inspection of protocol bytes. Never returned or persisted by this manager. */
  onStdout?: (chunk: Uint8Array) => void;
  /** Host-only lower output budget for tools combining several process results. */
  modelBytes?: number;
}
export interface ProcessResult {
  ok: boolean; jobId: string; ownerId: string; status: "running" | "exited" | "timed_out" | "aborted" | "failed" | "outcome_unknown";
  pid: number | null; exitCode: number | null; signal: string | null; durationMs: number;
  stdout: string; stderr: string; outputTruncated: boolean; artifactTruncated: boolean;
  artifacts: { stdout: string; stderr: string } | null;
  cleanup: "pending" | "confirmed" | "failed" | "unknown";
  error: { code: string; message: string } | null;
  category?: ProcessCategory; timeoutMs?: number; startedAt?: number; deadlineAt?: number;
  stdinState?: "open" | "writing" | "closed" | "unknown"; stdinBytes?: number;
}
export type ProcessSummary = Omit<ProcessResult, "stdout" | "stderr">;
export interface ProcessDetail extends ProcessSummary { stdout: string; stderr: string; liveTruncated: boolean }
export interface ProcessOutputPage { content: string; offset: number; nextOffset: number | null; total: number; truncated: boolean }
export class ProcessToolError extends Error {
  constructor(readonly code: string) { super(code.replaceAll("_", " ")); }
}
function bad(code: string): never { throw new ProcessToolError(code); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const environmentNames = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]);
const secretName = /(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|API_?KEY|PRIVATE_?KEY|^EDGEY_|^OPENCODE_|^ANTHROPIC_|^OPENAI_)/i;

/** An allowlist, not a copy of the agent environment. Additions are reviewed command arguments. */
export function processEnvironment(additions: Readonly<Record<string, string>> = {}, secrets: readonly string[] = [],
  source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && environmentNames.has(name.toUpperCase()) && !secrets.some((s) => s && value.includes(s))) env[name] = value;
  }
  for (const [name, value] of Object.entries(additions)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || secretName.test(name) || typeof value !== "string"
      || value.includes("\0") || value.length > 32768 || secrets.some((s) => s && value.includes(s))) bad("invalid_environment");
    for (const old of Object.keys(env)) if (old.toUpperCase() === name.toUpperCase()) delete env[old];
    env[name] = value;
  }
  return env;
}

/** Normalize before any credential matching, including fragmented CSI/OSC/DCS sequences. */
class TerminalTextNormalizer {
  private state: "text" | "escape" | "csi" | "string" | "string_escape" = "text";
  push(text: string): string {
    let clean = "";
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (this.state === "string_escape") { this.state = char === "\\" ? "text" : "string"; continue; }
      if (this.state === "string") {
        if (char === "\x07" || code === 0x9c) this.state = "text";
        else if (char === "\x1b") this.state = "string_escape";
        continue;
      }
      if (this.state === "csi") { if (code >= 0x40 && code <= 0x7e) this.state = "text"; continue; }
      if (this.state === "escape") {
        if (code < 0x20 || code >= 0x7f && code <= 0x9f) continue;
        this.state = char === "[" ? "csi" : "]PX^_".includes(char) ? "string" : "text";
        continue;
      }
      if (char === "\x1b") { this.state = "escape"; continue; }
      if (code === 0x9b) { this.state = "csi"; continue; }
      if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) { this.state = "string"; continue; }
      if (char === "\n" || char === "\t" || (code >= 0x20 && !(code >= 0x7f && code <= 0x9f))) clean += char;
    }
    return clean;
  }
}

const credentialPrefixes = ["http://", "https://", "ssh://", "git://", "ftp://", "bearer ", "sk-", "-----begin ",
  ...["?", "&"].flatMap((prefix) => ["api_key=", "apikey=", "token=", "secret=", "password="].map((key) => prefix + key))];
function prefixTail(text: string, prefixes: readonly string[]): number {
  const tail = text.slice(-32).toLowerCase();
  let hold = 0;
  for (const prefix of prefixes) for (let n = 1; n < prefix.length; n++) {
    if (tail.endsWith(prefix.slice(0, n))) hold = Math.max(hold, n);
  }
  return hold;
}

/** Finite-state generic redaction. Credential bodies are discarded, never buffered until newline.
 * All PEM blocks are hidden conservatively, including unknown/oversized private-key labels. */
class CredentialOutputFilter {
  private pending = "";
  private previous = "";
  private mode: "text" | "bearer_space" | "token" | "url" | "query" | "api_key" | "pem" | "pem_end" = "text";
  get bufferedCharacters(): number { return this.pending.length; }
  private consume(count: number): void {
    if (count) this.previous = this.pending[count - 1];
    this.pending = this.pending.slice(count);
  }
  push(text: string, final: boolean): string {
    this.pending += text;
    let output = "";
    while (this.pending) {
      if (this.mode === "pem" || this.mode === "pem_end") {
        const ending = this.mode === "pem" ? /-----END /i.exec(this.pending) : /-----/.exec(this.pending);
        if (!ending) {
          const hold = final ? 0 : prefixTail(this.pending, [this.mode === "pem" ? "-----end " : "-----"]);
          this.consume(this.pending.length - hold); break;
        }
        this.consume(ending.index + ending[0].length);
        this.mode = this.mode === "pem" ? "pem_end" : "text";
        continue;
      }
      if (this.mode === "bearer_space") {
        this.consume(/^\s*/.exec(this.pending)![0].length);
        if (!this.pending) break;
        this.mode = "token";
      }
      if (this.mode !== "text") {
        const delimiter = this.mode === "url" ? /[\s'"<>]/ : this.mode === "query" ? /[\s&]/
          : this.mode === "api_key" ? /[^a-zA-Z0-9_-]/ : /\s/;
        const end = this.pending.search(delimiter);
        if (end < 0) { this.consume(this.pending.length); break; }
        this.consume(end); this.mode = "text";
        continue;
      }
      const pattern = /(?:https?|ssh|git|ftp):\/\/|\bbearer(?=\s)|\bsk-|-----BEGIN |[?&](?:api_?key|token|secret|password)=/gi;
      // Retain the previous source character for word boundaries across pipe chunks.
      pattern.lastIndex = this.previous.length;
      const match = pattern.exec(this.previous + this.pending);
      if (!match) {
        const hold = final ? 0 : prefixTail(this.pending, credentialPrefixes);
        const count = this.pending.length - hold;
        output += this.pending.slice(0, count); this.consume(count); break;
      }
      const index = match.index - this.previous.length, token = match[0].toLowerCase();
      output += this.pending.slice(0, index);
      this.consume(index + token.length);
      if (token.endsWith("://")) { output += "[redacted-url]"; this.mode = "url"; }
      else {
        output += "[redacted]";
        this.mode = token === "bearer" ? "bearer_space" : token === "sk-" ? "api_key"
          : token === "-----begin " ? "pem" : "query";
      }
    }
    return output;
  }
}

/** No raw or partially recognized credential reaches either model output or artifact writes.
 * Carry is bounded by the longest configured secret (64Ki characters) plus a <=32-character
 * generic prefix, regardless of line/token/key length. push() returns all safe output. */
export class ProcessOutputFilter {
  private readonly normalizer = new TerminalTextNormalizer();
  private readonly credentials = new CredentialOutputFilter();
  private pending = "";
  private readonly secrets: string[];
  private readonly prefixes: number[][];
  private readonly marker: string;
  constructor(secrets: readonly string[] = []) {
    if (secrets.some((s) => s.length > 65536)) bad("invalid_secret_length");
    this.secrets = [...new Set(secrets.map((s) => new TerminalTextNormalizer().push(s)).filter(Boolean))].sort((a, b) => b.length - a.length);
    this.prefixes = this.secrets.map((secret) => {
      const table = new Array<number>(secret.length).fill(0);
      for (let i = 1, j = 0; i < secret.length; i++) {
        while (j && secret[i] !== secret[j]) j = table[j - 1];
        if (secret[i] === secret[j]) j++;
        table[i] = j;
      }
      return table;
    });
    let marker = "[redacted]";
    if (this.secrets.some((s) => marker.includes(s) || s.includes(marker))) {
      // Never erase a match: joining its neighbours could synthesize a new credential after
      // the generic scanner has already passed. Use a non-word separator absent from secrets.
      marker = "\ufffd";
      for (let code = 0xe000; this.secrets.some((s) => s.includes(marker)); code++) {
        if (code > 0xf8ff) bad("invalid_secret_marker");
        marker = String.fromCharCode(code);
      }
    }
    this.marker = marker;
  }
  get bufferedCharacters(): number { return this.pending.length + this.credentials.bufferedCharacters; }
  private configured(text: string, final: boolean): string {
    this.pending += text;
    // Hold only a suffix which could complete a configured secret. A blanket key-length
    // delay hides short interactive prompts indefinitely. KMP keeps adversarial prefixes linear.
    let hold = 0;
    if (!final) this.secrets.forEach((secret, index) => {
      const table = this.prefixes[index];
      let matched = 0;
      for (let i = Math.max(0, this.pending.length - secret.length + 1); i < this.pending.length; i++) {
        while (matched && this.pending[i] !== secret[matched]) matched = table[matched - 1];
        if (this.pending[i] === secret[matched]) matched++;
      }
      hold = Math.max(hold, matched);
    });
    let end = final ? this.pending.length : this.pending.length - hold;
    if (!final && end > 0 && /[\ud800-\udbff]/.test(this.pending[end - 1])) end--;
    let output = "", i = 0;
    while (i < end) {
      const secret = this.secrets.find((s) => this.pending.startsWith(s, i));
      if (secret) { output += this.marker; i += secret.length; }
      else output += this.pending[i++];
    }
    this.pending = this.pending.slice(i);
    return output;
  }
  push(text: string, final = false): string {
    const output: string[] = [];
    for (let start = 0; start < text.length; start += 16384) {
      const normalized = this.normalizer.push(text.slice(start, start + 16384));
      // Generic matching precedes configured replacement so replacing a configured fragment of
      // "Bearer" cannot expose the rest of an unknown credential to disk.
      output.push(this.configured(this.credentials.push(normalized, false), false));
    }
    if (final) output.push(this.configured(this.credentials.push("", true), true));
    return output.join("");
  }
}

export type ShellName = "powershell" | "cmd" | "sh" | "bash";
export function shellCommand(shell: ShellName, script: string): { executable: string; args: string[] } {
    if (typeof script !== "string" || !script || script.includes("\0") || Buffer.byteLength(script) > PROCESS_LIMITS.scriptBytes) bad("invalid_script");
  const name = shell === "powershell" ? "powershell.exe" : shell === "cmd" ? "cmd.exe" : shell;
  if (!["powershell", "cmd", "sh", "bash"].includes(shell)) bad("invalid_shell");
  const system = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  const executable = Bun.which(name) ?? (process.platform === "win32" && system && (shell === "powershell" || shell === "cmd")
    ? Bun.which(join(system, "System32", shell === "cmd" ? "cmd.exe" : "WindowsPowerShell/v1.0/powershell.exe")) : null);
  if (!executable) bad("shell_unavailable");
  return { executable, args: shell === "powershell"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
    : shell === "cmd" ? ["/d", "/s", "/v:off", "/c", script] : ["-c", script] };
}

export function processCommand(executable: string, args: readonly string[], env: Record<string, string>, cwd: string): string[] {
  if (!executable || executable.includes("\0") || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) bad("invalid_command");
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const resolved = Bun.which(executable, { cwd, PATH: path });
  if (!resolved) bad("executable_unavailable");
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(resolved)) return [resolved, ...args];
  // cmd has no argv protocol. Support a conservative literal subset through environment expansion;
  // quotes/expansion/operators are rejected rather than pretending native argv quoting is sufficient.
  if ([resolved, ...args].some((arg) => /["%!\r\n&|<>^()]/.test(arg))) bad("unsafe_batch_argument");
  env.EDGEY_BATCH_FILE = resolved;
  args.forEach((arg, i) => { env[`EDGEY_BATCH_ARG_${i}`] = arg; });
  const command = `""%EDGEY_BATCH_FILE%"${args.map((_, i) => ` "%EDGEY_BATCH_ARG_${i}%"`).join("")}"`;
  return [shellCommand("cmd", "exit 0").executable, "/d", "/s", "/v:off", "/c", command];
}

// Keep an owned root alive until taskkill/group cleanup, even after the actual command exits.
// This is process-tree supervision, not a sandbox; detached children and hard host kills cannot be guaranteed.
interface LiveJob {
  result: ProcessResult; done: Promise<ProcessResult>; cancel: () => void;
  tail: { stdout: string; stderr: string; truncated: boolean };
  writeInput?: (text: string, eof: boolean) => Promise<void>;
  inputPending?: boolean;
}
function plainResult(result: ProcessResult): JsonValue { return result as unknown as JsonValue; }

export class ProcessManager {
  readonly ownerId: string = randomUUID();
  readonly paths: WorkspacePaths;
  private readonly store: ArtifactStore;
  private readonly runtimeDirectory: string;
  private readonly secrets: readonly string[];
  private readonly beforeEffect?: () => void;
  private readonly live = new Map<string, LiveJob>();
  private readonly created = new Map<string, string>();
  private disposed = false;
  private disposal?: Promise<void>;
  private readonly policies: ProcessPolicies;
  private readonly inputWaitMs: number;
  constructor(options: ProcessOptions) {
    this.paths = new WorkspacePaths(options.project);
    this.store = new ArtifactStore(options.artifactDir, this.paths.root);
    this.runtimeDirectory = join(this.store.directory, `process-host-${randomUUID()}`);
    // A private empty cwd prevents repository bunfig preloads from changing the supervisor.
    ensureDirectory(this.runtimeDirectory);
    this.secrets = [...(options.secrets ?? [])];
    this.beforeEffect = options.beforeEffect;
    this.onChange = options.onChange;
    this.policies = structuredClone(options.policies ?? PROCESS_POLICIES);
    this.inputWaitMs = options.inputWaitMs ?? PROCESS_LIMITS.inputWaitMs;
    if (!Number.isSafeInteger(this.inputWaitMs) || this.inputWaitMs < 1 || this.inputWaitMs > PROCESS_LIMITS.inputWaitMs) bad("invalid_input_wait");
    for (const category of ["short", "build", "server"] as const) {
      const policy = this.policies[category];
      if (!policy || !Number.isSafeInteger(policy.defaultMs) || !Number.isSafeInteger(policy.maxMs)
        || policy.defaultMs < 1 || policy.defaultMs > policy.maxMs || policy.maxMs > PROCESS_POLICIES[category].maxMs) bad("invalid_policy");
    }
    new ProcessOutputFilter(this.secrets);
  }
  private readonly onChange?: ProcessOptions["onChange"];
  private notify(result: ProcessResult): void {
    const { stdout, stderr, ...summary } = result;
    try { this.onChange?.(structuredClone(summary)); } catch { /* Observation cannot break cleanup. */ }
  }
  owns(id: string): boolean { return this.live.has(id); }
  /** All jobs started by this manager, including settled rows evicted from the UI cache. */
  ownedJobs(ownerId: string): ProcessResult[] {
    return [...this.created].filter(([, owner]) => owner === ownerId).map(([id]) => this.status(id, ownerId));
  }
  get jobs(): ProcessResult[] {
    checkAbsoluteDirectory(this.store.directory);
    const names = readdirSync(this.store.directory).filter((name) => /^process-job-[0-9a-f-]+\.json$/.test(name));
    const ids = new Set([...names.slice(-PROCESS_LIMITS.retainedJobs).map((name) => name.slice(12, -5)), ...this.live.keys()]);
    return [...ids].map((id) => this.read(id));
  }
  private read(id: string): ProcessResult {
    if (!uuid.test(id)) bad("invalid_job_id");
    const active = this.live.get(id);
    if (active) return { ...structuredClone(active.result), durationMs: active.result.status === "running"
      ? Date.now() - active.result.startedAt! : active.result.durationMs };
    if (!this.store.exists(`process-job-${id}.json`)) bad("job_not_found");
    const record = this.store.read(`process-job-${id}.json`) as unknown as { manager: string; result: ProcessResult };
    const result = structuredClone(record.result);
    if (result.status === "running") {
      result.ok = false; result.status = "outcome_unknown"; result.cleanup = "unknown";
      if (result.stdinState !== undefined) result.stdinState = "unknown";
      result.error = { code: "owner_unavailable", message: "job owner is unavailable; process state is unknown; a saved pid is never used to kill a restarted job" };
    }
    return result;
  }
  status(id: string, ownerId = this.ownerId): ProcessResult {
    const result = this.read(id);
    if (result.ownerId !== ownerId) bad("job_owner_mismatch");
    return result;
  }
  detail(id: string, ownerId = this.ownerId): ProcessDetail {
    const { stdout, stderr, ...summary } = this.live.get(id)?.result ?? this.status(id, ownerId);
    if (summary.ownerId !== ownerId) bad("job_owner_mismatch");
    const tail = this.live.get(id)?.tail ?? (this.store.read(`process-job-${id}.json`) as unknown as { tail?: LiveJob["tail"] }).tail;
    return { ...structuredClone(summary), durationMs: summary.status === "running" ? Date.now() - summary.startedAt! : summary.durationMs,
      stdout: tail?.stdout ?? stdout.slice(-PROCESS_LIMITS.liveBytes),
      stderr: tail?.stderr ?? stderr.slice(-PROCESS_LIMITS.liveBytes), liveTruncated: tail?.truncated ?? summary.outputTruncated };
  }
  output(id: string, stream: "stdout" | "stderr", offset = 0, limit = 8192, ownerId = this.ownerId): ProcessOutputPage {
    const status = this.status(id, ownerId);
    if (!["stdout", "stderr"].includes(stream) || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(limit) || limit < 1 || limit > PROCESS_LIMITS.pageCharacters) bad("invalid_output_page");
    const ref = status.artifacts?.[stream];
    if (ref && ref !== `process-${id}.${stream}.txt`) bad("invalid_artifact");
    const text = ref ? new ProcessOutputFilter(this.secrets).push(readPrivate(join(this.store.directory, ref), PROCESS_LIMITS.artifactBytes).toString("utf8"), true) : "";
    const end = Math.min(text.length, offset + limit);
    return { content: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null,
      total: text.length, truncated: status.artifactTruncated || offset > 0 || end < text.length };
  }
  async wait(id: string, waitMs = 30_000, ownerId = this.ownerId, signal?: AbortSignal): Promise<ProcessResult> {
    this.status(id, ownerId);
    if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 120_000) bad("invalid_wait");
    const live = this.live.get(id);
    if (!live || live.result.status !== "running") return this.status(id, ownerId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled!: () => void;
    const aborted = new Promise<void>((resolve) => { cancelled = () => { live.cancel(); resolve(); }; });
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) cancelled();
    try {
      await Promise.race([live.done, aborted, new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })]);
      if (signal?.aborted) await live.done;
      return this.status(id, ownerId);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancelled); }
  }
  /** Text is deliberately absent from job records. Tool arguments still use the normal reviewed journal. */
  async sendInput(id: string, text: string, eof = false, ownerId = this.ownerId, signal?: AbortSignal): Promise<ProcessSummary> {
    const status = this.status(id, ownerId), job = this.live.get(id);
    if (this.disposed || !job || job.inputPending || status.status !== "running" || status.stdinState !== "open" || !job.writeInput || !status.pid) bad("stdin_unavailable");
    if (typeof text !== "string" || typeof eof !== "boolean" || (!text && !eof)
      || Buffer.byteLength(text) > PROCESS_LIMITS.inputChunkBytes
      || (status.stdinBytes ?? 0) + Buffer.byteLength(text) > PROCESS_LIMITS.inputBytes) bad("input_limit");
    if (new AgentSanitizer(this.secrets).text(text) !== text) bad("unsafe_input");
    if (signal?.aborted) { await this.stop(id, ownerId); bad("input_aborted"); }
    this.paths.resolve(".", { allowRoot: true });
    this.beforeEffect?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    const interrupted = new Promise<false>((resolve) => {
      abort = () => resolve(false);
      timer = setTimeout(abort, this.inputWaitMs);
    });
    signal?.addEventListener("abort", abort, { once: true });
    job.inputPending = true;
    try {
      const work = job.writeInput(text, eof);
      if (!await Promise.race([work.then(() => true, () => false), interrupted])) {
        job.cancel();
        const stopped = await job.done;
        if (stopped.status === "outcome_unknown" || stopped.cleanup !== "confirmed") throw new AgentError("outcome_unknown");
        bad(signal?.aborted ? "input_aborted" : "stdin_write_failed");
      }
      const { stdout, stderr, ...summary } = this.status(id, ownerId);
      return summary;
    } finally { job.inputPending = false; clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async stop(id: string, ownerId = this.ownerId): Promise<ProcessResult> {
    const status = this.status(id, ownerId), live = this.live.get(id);
    if (!live || status.status !== "running") return status;
    live.cancel();
    return structuredClone(await live.done);
  }
  dispose(): Promise<void> {
    this.disposed = true;
    return this.disposal ??= (async () => {
      const jobs = [...this.live.values()];
      jobs.filter((job) => job.result.status === "running").forEach((job) => job.cancel());
      const settled = await Promise.allSettled(jobs.map((job) => job.done));
      if (settled.some((item) => item.status === "rejected")) throw new AgentError("outcome_unknown");
    })();
  }
  async run(input: ProcessInput): Promise<ProcessResult> {
    input = { ...input, args: [...(input.args ?? [])], env: { ...input.env } };
    if (this.disposed) bad("manager_disposed");
    for (const [id, job] of this.live) {
      if (this.live.size < PROCESS_LIMITS.retainedJobs) break;
      if (job.result.status !== "running") this.live.delete(id);
    }
    if (this.live.size >= PROCESS_LIMITS.retainedJobs || [...this.live.values()].filter((j) => j.result.status === "running").length >= PROCESS_LIMITS.activeJobs) bad("job_limit");
    const policy = processPolicy(input, this.policies), timeout = policy.timeoutMs;
    if (input.interactive !== undefined && typeof input.interactive !== "boolean") bad("invalid_input_mode");
    if (input.interactive && !policy.background) bad("interactive_requires_background");
    if (input.modelBytes !== undefined && (!Number.isSafeInteger(input.modelBytes) || input.modelBytes < 32768 || input.modelBytes > PROCESS_LIMITS.modelBytes)) bad("invalid_output_limit");
    if (input.input !== undefined && (typeof input.input !== "string" || Buffer.byteLength(input.input) > PROCESS_LIMITS.inputBytes)) bad("input_limit");
    if (input.input && new AgentSanitizer(this.secrets).text(input.input) !== input.input) bad("unsafe_input");
    if ((input.args?.length ?? 0) > 512 || Buffer.byteLength(JSON.stringify(input.args)) > 64 * 1024) bad("invalid_command");
    const cwd = this.paths.resolve(input.cwd ?? ".", { allowRoot: true });
    if (!cwd.stat?.isDirectory()) bad("invalid_cwd");
    const env = processEnvironment(input.env, this.secrets);
    const command = processCommand(input.executable, [...(input.args ?? [])], env, cwd.absolute);
    const ownerId = input.ownerId ?? this.ownerId;
    if (typeof ownerId !== "string" || !ownerId || ownerId.length > 256 || new AgentSanitizer(this.secrets).text(ownerId) !== ownerId) bad("invalid_owner");
    const id = randomUUID(), started = Date.now();
    const result: ProcessResult = { ok: true, jobId: id, ownerId, status: "running", pid: null, exitCode: null,
      signal: null, durationMs: 0, stdout: "", stderr: "", outputTruncated: false, artifactTruncated: false,
      artifacts: null, cleanup: "pending", error: null, category: policy.category, timeoutMs: timeout,
      startedAt: started, deadlineAt: started + timeout, stdinState: input.interactive ? "open" : "closed", stdinBytes: 0 };
    if (input.signal?.aborted) return { ...result, ok: false, status: "aborted", cleanup: "confirmed" };
    this.beforeEffect?.();
    this.store.create(`process-job-${id}.json`, { manager: this.ownerId, result: plainResult(result) });
    this.created.set(id, ownerId);
    let cancel = () => {};
    const job: LiveJob = { result, done: Promise.resolve(result), cancel: () => cancel(), tail: { stdout: "", stderr: "", truncated: false } };
    this.live.set(id, job);
    this.notify(result);
    job.done = this.execute(input, env, command, cwd.absolute, result, started, timeout, (fn) => { cancel = fn; });
    if (policy.background) { void job.done.catch(() => {}); return structuredClone(result); }
    return structuredClone(await job.done);
  }
  private async execute(input: ProcessInput, env: Record<string, string>, command: string[], cwd: string,
    result: ProcessResult, started: number, timeout: number, setCancel: (fn: () => void) => void): Promise<ProcessResult> {
    const fds: number[] = [];
    let child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">> | undefined;
    let reason: "timed_out" | "aborted" | "failed" | null = null;
    let finish!: () => void;
    let inputSequence = 0;
    let inputAck: { id: number; resolve: () => void; reject: () => void } | undefined;
    let launched!: () => void;
    const launch = new Promise<void>((resolve) => { launched = resolve; });
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const cancel = () => { reason ??= "aborted"; result.stdinState = "closed"; inputAck?.reject(); inputAck = undefined; launched(); finish(); };
    setCancel(cancel);
    const timer = setTimeout(() => { reason ??= "timed_out"; result.stdinState = "closed"; inputAck?.reject(); inputAck = undefined; launched(); finish(); }, timeout);
    input.signal?.addEventListener("abort", cancel, { once: true });
    let readers: Promise<void>[] = [];
    const handles: ReadableStreamDefaultReader<Uint8Array>[] = [];
    let inputWork: Promise<unknown> = Promise.resolve();
    let readFault = false, artifactBytes = 0, modelBytes = 0;
    try {
      checkAbsoluteDirectory(this.store.directory);
      const refs = { stdout: `process-${result.jobId}.stdout.txt`, stderr: `process-${result.jobId}.stderr.txt` };
      for (const name of [refs.stdout, refs.stderr]) fds.push(openSync(join(this.store.directory, name), "wx", 0o600));
      result.artifacts = refs;
      this.store.replace(`process-job-${result.jobId}.json`, { manager: this.ownerId, result: plainResult(result) });
      this.paths.resolve(input.cwd ?? ".", { allowRoot: true });
      if (input.signal?.aborted) cancel();
      if (!reason) {
        this.beforeEffect?.();
        child = Bun.spawn((typeof EDGEY_COMPILED !== "undefined" && EDGEY_COMPILED
          ? [process.execPath, "--edgey-process-host"]
          : [process.execPath, "--no-env-file", "--no-install", "-e", supervisor]), {
          cwd: this.runtimeDirectory, env: { ...env, EDGEY_PROCESS_ARGV: JSON.stringify({ args: command, cwd }) },
          stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: process.platform !== "win32",
          ipc: (message: unknown) => {
            const m = message as { type?: string; pid?: number; code?: number; signal?: string | null; id?: number; ok?: boolean };
            if (m.type === "ready") {
              if (reason || input.signal?.aborted || this.disposed) { cancel(); return; }
              try {
                // Fence the actual command too: supervisor startup is asynchronous.
                this.paths.resolve(input.cwd ?? ".", { allowRoot: true });
                this.beforeEffect?.();
                child!.send("launch");
              } catch { reason = "failed"; result.error = { code: "ownership_lost", message: "process launch ownership check failed" }; finish(); }
            }
            else if (m.type === "started" && Number.isSafeInteger(m.pid)) {
              result.pid = m.pid!;
              try { this.store.replace(`process-job-${result.jobId}.json`, { manager: this.ownerId, result: plainResult(result) }); }
              catch { reason = "failed"; finish(); }
              launched();
              this.notify(result);
            }
            else if (m.type === "input" && inputAck && inputAck.id === m.id) {
              if (m.ok) inputAck.resolve(); else inputAck.reject();
              inputAck = undefined;
            }
            else if (m.type === "exit") { result.exitCode = m.code ?? null; result.signal = m.signal ?? null; result.stdinState = "closed"; inputAck?.reject(); finish(); }
            else if (m.type === "error") { reason ??= "failed"; finish(); }
          } });
        void child.exited.then(() => { if (result.exitCode === null && !reason) reason = "failed"; inputAck?.reject(); inputAck = undefined; launched(); finish(); });
        const consume = async (stream: ReadableStream<Uint8Array>, which: "stdout" | "stderr", fd: number) => {
          const decoder = new TextDecoder(), filter = new ProcessOutputFilter(this.secrets);
          const append = (text: string) => {
            const tail = this.live.get(result.jobId)!.tail;
            const combined = Buffer.from(tail[which] + text);
            if (combined.length > PROCESS_LIMITS.liveBytes) {
              let start = combined.length - PROCESS_LIMITS.liveBytes;
              while ((combined[start] & 0xc0) === 0x80) start++;
              tail[which] = combined.subarray(start).toString("utf8"); tail.truncated = true;
            } else tail[which] += text;
            const bytes = Buffer.from(text);
            const retained = bytes.subarray(0, Math.max(0, PROCESS_LIMITS.artifactBytes - artifactBytes));
            if (retained.length < bytes.length) result.artifactTruncated = true;
            let offset = 0;
            while (offset < retained.length) offset += writeSync(fd, retained, offset);
            artifactBytes += retained.length;
            const available = (input.modelBytes ?? PROCESS_LIMITS.modelBytes) - 16 * 1024 - modelBytes;
            let visible = text;
            if (Buffer.byteLength(JSON.stringify(visible)) - 2 > available) {
              let low = 0, high = visible.length;
              while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                if (Buffer.byteLength(JSON.stringify(visible.slice(0, mid))) - 2 <= available) low = mid; else high = mid - 1;
              }
              visible = visible.slice(0, low);
              if (/[\ud800-\udbff]$/.test(visible)) visible = visible.slice(0, -1);
              result.outputTruncated = true;
            }
            modelBytes += Buffer.byteLength(JSON.stringify(visible)) - 2;
            result[which] += visible;
          };
          const reader = stream.getReader(); handles.push(reader);
          try {
            while (true) {
              const { value: chunk, done } = await reader.read();
              if (done) break;
              if (which === "stdout") input.onStdout?.(chunk);
              append(filter.push(decoder.decode(chunk, { stream: true })));
            }
            append(filter.push(decoder.decode(), true));
          } catch { readFault = true; reason ??= "failed"; finish(); }
        };
        readers = [consume(child.stdout, "stdout", fds[0]), consume(child.stderr, "stderr", fds[1])];
        const job = this.live.get(result.jobId)!;
        // On Windows, Bun FileSink.write can block on a full pipe. Keep all writes in
        // the supervised process so the host's deadline/cancel/lease loop stays responsive.
        const pipe = async (text: string, eof: boolean) => {
          await launch;
          for (let start = 0; start < text.length || (start === 0 && !text);) {
            if (reason || result.exitCode !== null) bad("stdin_closed");
            let end = Math.min(text.length, start + 8192);
            if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1])) end--;
            const id = ++inputSequence;
            await new Promise<void>((resolve, reject) => {
              inputAck = { id, resolve, reject: () => reject(new ProcessToolError("stdin_closed")) };
              try { child!.send({ type: "input", id, text: text.slice(start, end), eof: eof && end === text.length }); }
              catch { inputAck.reject(); inputAck = undefined; }
            });
            start = end;
            if (!text) break;
          }
        };
        job.writeInput = (text, eof) => {
          result.stdinState = "writing";
          result.stdinBytes = (result.stdinBytes ?? 0) + Buffer.byteLength(text);
          // Persist intent before the write, without retaining its text or guessing consumption.
          try { this.store.replace(`process-job-${result.jobId}.json`, { manager: this.ownerId, result: plainResult(result) }); }
          catch { reason = "failed"; finish(); return Promise.reject(new ProcessToolError("input_persistence_failed")); }
          const work = (async () => {
            try {
              await pipe(text, eof);
              result.stdinState = eof || reason || result.exitCode !== null || result.status !== "running" ? "closed" : "open";
              this.store.replace(`process-job-${result.jobId}.json`, { manager: this.ownerId, result: plainResult(result) });
            } catch { result.stdinState = "closed"; throw new ProcessToolError("stdin_closed"); }
          })();
          // Rejected writes are reported to their caller. EPIPE is not failed tree cleanup.
          inputWork = work.catch(() => {});
          void work.catch(() => {});
          return work;
        };
        if (input.interactive) {
          if (input.input) void job.writeInput(input.input, false).catch(() => { reason ??= "failed"; finish(); });
        } else inputWork = (async () => {
          try {
            result.stdinBytes = Buffer.byteLength(input.input ?? "");
            await pipe(input.input ?? "", true);
          } catch { /* Early stdin close is normal for noninteractive commands which ignore input. */ }
        })();
        await ready;
        inputAck?.reject(); launched();
        // Cleanup is awaited even on normal exit: the supervisor root still owns descendants.
        inputAck?.reject(); inputAck = undefined;
        result.cleanup = await terminateTree(child) ? "confirmed" : "failed";
        if (!await settles(child.exited, 5000)) result.cleanup = "failed";
        if (!await settles(Promise.all([...readers, inputWork]), 3000)) {
          result.cleanup = "failed";
          await Promise.all(handles.map((reader) => reader.cancel().catch(() => {})));
        }
      } else result.cleanup = "confirmed";
      result.status = reason ?? "exited";
      if (readFault || result.cleanup === "failed") {
        result.status = "outcome_unknown";
        result.error = { code: "cleanup_failed", message: "process output or descendant cleanup could not be confirmed" };
      }
      result.ok = result.status === "exited" && result.exitCode === 0;
    } catch (error) {
      result.ok = false; result.status = "failed";
      inputAck?.reject(); launched();
      result.error = { code: error instanceof ProcessToolError ? error.code : "process_failed", message: "process execution failed" };
      if (child) {
        inputAck?.reject(); inputAck = undefined;
        result.cleanup = await terminateTree(child) ? "confirmed" : "failed";
        if (!await settles(child.exited, 5000)) result.cleanup = "failed";
        if (!await settles(Promise.all([...readers, inputWork]), 3000)) {
          result.cleanup = "failed";
          await Promise.all(handles.map((reader) => reader.cancel().catch(() => {})));
        }
      } else result.cleanup = "confirmed";
      if (result.cleanup === "failed") result.status = "outcome_unknown";
    } finally {
      clearTimeout(timer); input.signal?.removeEventListener("abort", cancel);
      result.stdinState = result.cleanup === "confirmed" ? "closed" : "unknown";
      let artifactFault = false;
      for (const fd of fds) {
        try { fsyncSync(fd); } catch { artifactFault = true; }
        finally { try { closeSync(fd); } catch { artifactFault = true; } }
      }
      if (artifactFault) { result.ok = false; result.status = "outcome_unknown"; result.error = { code: "artifact_failed", message: "output persistence failed" }; }
      result.durationMs = Date.now() - started;
      try { this.store.replace(`process-job-${result.jobId}.json`, { manager: this.ownerId, result: plainResult(result),
        tail: this.live.get(result.jobId)!.tail }); }
      catch { result.ok = false; result.status = "outcome_unknown"; throw new AgentError("outcome_unknown"); }
      finally { this.notify(result); }
    }
    return result;
  }
}

async function settles(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.then(() => true, () => false), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}

async function terminateTree(child: { pid: number; kill(signal?: number | NodeJS.Signals): void; exited: Promise<number> }): Promise<boolean> {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const taskkill = (root ? Bun.which(join(root, "System32", "taskkill.exe")) : null) ?? Bun.which("taskkill.exe");
    let ok = false;
    try {
      if (taskkill) {
        const killer = Bun.spawn([taskkill, "/PID", String(child.pid), "/T", "/F"], {
          env: processEnvironment(), stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 10_000 });
        ok = await killer.exited === 0;
      }
    } catch { /* Fall back to the direct child, without claiming descendant cleanup. */ }
    if (!ok) { try { child.kill("SIGKILL"); } catch { /* process may already have exited */ } }
    return ok;
  }
  try { process.kill(-child.pid, "SIGTERM"); }
  catch (error) { return !!error && typeof error === "object" && "code" in error && error.code === "ESRCH"; }
  await Bun.sleep(100);
  try { process.kill(-child.pid, "SIGKILL"); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) return false; }
  return true;
}

const str: ToolSchema = { type: "string" }, num: ToolSchema = { type: "integer" }, bool: ToolSchema = { type: "boolean" };
const object = (properties: Record<string, ToolSchema>, required: string[] = []): ToolSchema & { type: "object" } =>
  ({ type: "object", properties, required, additionalProperties: false });

/** Host owns this array's manager and must await dispose() during orderly shutdown. */
export type ProcessTools = AgentTool[] & { manager: ProcessManager };
export function createProcessTools(options: ProcessOptions): ProcessTools {
  const manager = new ProcessManager(options), sanitizer = new AgentSanitizer(options.secrets);
  const common = { cwd: str, timeoutMs: num, input: str, interactive: bool, background: bool, category: { type: "string", enum: ["short", "build", "server"] } as ToolSchema,
    env: { type: "object", additionalProperties: str } as ToolSchema };
  const tool = (name: string, description: string, schema: ToolSchema & { type: "object" }, effect: AgentTool["effect"],
    action: (args: Readonly<JsonObject>, ctx: ToolInvocationContext) => unknown | Promise<unknown>): AgentTool => {
    schema = toolParameters(name, schema);
    const validate = (args: Readonly<JsonObject>) => {
      try {
        validateArguments(args as JsonObject, schema);
        let policy: ReturnType<typeof processPolicy>;
        try { policy = processPolicy(args as Pick<ProcessInput, "category" | "timeoutMs" | "background">, options.policies); }
        catch (error) {
          if (!(error instanceof ProcessToolError)) throw error;
          if (error.code === "invalid_category") contractIssue("$.category", "short, build or server", args.category);
          if (error.code === "server_requires_background") contractIssue("$.background", "true for server category", args.background);
          const category = (args.category ?? "short") as ProcessCategory;
          contractIssue("$.timeoutMs", `integer from 1 to ${(options.policies ?? PROCESS_POLICIES)[category].maxMs} milliseconds for ${category} category`, args.timeoutMs);
        }
        if (args.interactive && !policy.background) contractIssue("$.background", "true when interactive is true", args.background);
        if (args.waitMs !== undefined && (!Number.isSafeInteger(args.waitMs) || Number(args.waitMs) < 1 || Number(args.waitMs) > 120000)) return false;
        if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)) return false;
        if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > PROCESS_LIMITS.pageCharacters)) return false;
        if (name === "job_input" && (Buffer.byteLength(args.text as string) > PROCESS_LIMITS.inputChunkBytes || (!args.text && !args.eof))) return false;
        if (args.cwd !== undefined) {
          try {
            const resolved = manager.paths.resolve(args.cwd as string, { allowRoot: true });
            if (!resolved.stat?.isDirectory()) throw new WorkspaceError("not_directory");
          } catch (error) {
            const reason = error instanceof WorkspaceError ? error.code : "io_error";
            const expected = reason === "invalid_path" || reason === "outside_workspace"
              ? 'project-relative directory, such as "." for the selected project root or "src" for its child; no absolute paths or .. segments'
              : reason === "not_found" ? 'existing project-relative directory; inspect with list_files before choosing cwd'
              : reason === "not_directory" ? 'directory, not a file; inspect with list_files'
              : reason === "protected_path" ? 'directory permitted by the host; do not bypass protected-path restrictions'
              : reason === "unsafe_link" ? 'directory without symbolic links; linked paths are not supported'
              : reason === "path_changed" ? 'unchanged workspace directory; stop and ask the user to reopen the project'
              : 'directory readable by the current OS account; inspect permissions without bypassing them';
            contractIssue("$.cwd", expected, args.cwd);
          }
        }
        if (args.env) {
          try { processEnvironment(args.env as Record<string, string>, options.secrets); }
          catch { contractIssue("$.env", "non-secret environment entries with valid variable names and string values up to 32768 characters, without NUL; omit credentials and reserved provider variables", args.env); }
        }
        return true;
      } catch (error) { if (error instanceof ToolArgumentError) throw error; return false; }
    };
    return { name, version: "2", schemaVersion: "2", effect, scope: effect === "read" ? "project" : "external",
      timeoutMs: name.startsWith("run_") ? PROCESS_POLICIES.build.maxMs + 30_000 : PROCESS_LIMITS.toolTimeoutMs,
      definition: { type: "function", function: { name, description, parameters: schema } }, validate,
      execute: async (args, ctx) => {
        try {
          if (!validate(args)) bad("invalid_arguments");
          if (pathKey(new WorkspacePaths(ctx.project).root) !== pathKey(manager.paths.root)) bad("project_mismatch");
          const value = await action(args, ctx);
          const result = sanitizer.result(value, PROCESS_LIMITS.modelBytes);
          if ((value as ProcessResult)?.cleanup === "failed" || (value as ProcessResult)?.status === "outcome_unknown") throw new AgentError("outcome_unknown");
          return result;
        } catch (error) {
          if (error instanceof AgentError && error.code === "outcome_unknown") throw error;
          return { ok: false, error: { code: error instanceof ProcessToolError ? error.code : "process_failed", message: "process operation failed" } };
        }
      } };
  };
  const tools: AgentTool[] = [
    tool("run_process", "run argv with project-relative cwd and host privileges, no sandbox. category short: default/max 120s; build: default 10m/max 60m; server: background, default 1h/max 8h. timeoutMs may shorten/extend within category. background jobs are run-scoped: stop at task end/cancel/cli exit. use job_wait/status/output/stop. stdin closes unless interactive:true with background; job_input sends text/eof, no pty. batch files reject cmd metacharacters.",
      object({ ...common, executable: str, args: { type: "array", items: str } }, ["executable", "args"]), "execute",
      (args, ctx) => manager.run({ ...args, executable: args.executable as string, args: args.args as string[], ownerId: ctx.runId, signal: ctx.signal })),
    tool("run_shell", "run an explicit shell with host privileges. powershell means windows powershell 5.1; no profiles. same short/build/server timeout and run-scoped background policy as run_process. scripts reviewed as a whole.",
      object({ ...common, shell: { type: "string", enum: ["powershell", "cmd", "sh", "bash"] }, script: str }, ["shell", "script"]), "execute",
      (args, ctx) => manager.run({ ...args, ...shellCommand(args.shell as ShellName, args.script as string), ownerId: ctx.runId, signal: ctx.signal })),
    tool("job_status", "read an owned job with current bounded stdout/stderr tails (16 kib each), or list jobs for this run. tails keep advancing after retained output limits. a job from an unavailable owner is outcome_unknown; no hard-kill orphan guarantee.",
      object({ jobId: str }), "read", (args, ctx) => args.jobId ? manager.detail(args.jobId as string, ctx.runId)
        : { jobs: manager.jobs.filter((job) => job.ownerId === ctx.runId).map(({ stdout, stderr, ...job }) => job) }),
    tool("job_stop", "explicitly stop this run's background job and await descendant cleanup. never kill an unowned or restarted pid.",
      object({ jobId: str }, ["jobId"]), "execute", (args, ctx) => manager.stop(args.jobId as string, ctx.runId)),
    tool("job_wait", "wait up to waitMs (default 30000, max 120000) for an owned job. returns running on wait expiry without stopping it; interruption stops the job and awaits cleanup.",
      object({ jobId: str, waitMs: num }, ["jobId"]), "read", (args, ctx) => manager.wait(args.jobId as string, args.waitMs as number | undefined, ctx.runId, ctx.signal)),
    tool("job_output", "page sanitized retained stdout or stderr for an owned job. utf16 offset, limit default 8192/max 16384; nextOffset and truncation explicit. artifacts capped at 16 mib combined.",
      object({ jobId: str, stream: { type: "string", enum: ["stdout", "stderr"] }, offset: num, limit: num }, ["jobId", "stream"]), "read",
      (args, ctx) => manager.output(args.jobId as string, args.stream as "stdout" | "stderr", args.offset as number | undefined, args.limit as number | undefined, ctx.runId)),
    tool("job_input", "write exact text to a running owned interactive pipe; newline is explicit. optional eof closes stdin. max 16384 utf8 bytes per write, 1 mib total. no passwords/provider credentials. no automatic retry: accepted bytes do not prove child consumption. blocked writes stop the job after 5s and await cleanup.",
      object({ jobId: str, text: str, eof: bool }, ["jobId", "text"]), "execute",
      (args, ctx) => manager.sendInput(args.jobId as string, args.text as string, args.eof as boolean | undefined, ctx.runId, ctx.signal)),
  ];
  return Object.assign(tools, { manager });
}
