import type { JsonObject, ToolSchema } from "../types";
import { ToolArgumentError } from "../api/tool-validation";
import { projectPath } from "../workspace/paths";
import { fileToolPath } from "./file-paths";
import { globMatcher, textMatcher } from "../workspace/patterns";
import { workspaceLimits } from "../workspace/text";
import { PROCESS_LIMITS, PROCESS_POLICIES } from "./process-limits";

export const TOOL_BOUNDS = Object.freeze({ page: workspaceLimits.pageEntries, offset: 100000, lines: 2000, startLine: 1000001,
  readBytes: workspaceLimits.outputBytes, operations: workspaceLimits.changes, hunks: 128, tasks: 64, evidence: 16,
  children: 3, query: 256, pattern: 256, paths: 200, gitLog: 100 });
const number = (minimum: number, maximum = Number.MAX_SAFE_INTEGER): Partial<ToolSchema> => ({ minimum, maximum });
const text = (maxLength: number, minLength = 1): Partial<ToolSchema> => ({ minLength, maxLength });
const items = (maxItems: number, minItems = 0): Partial<ToolSchema> => ({ minItems, maxItems });
const page = { offset: number(0, TOOL_BOUNDS.offset), limit: number(1, TOOL_BOUNDS.page) };
const bindings = { expectedTree: text(64, 40), expectedHead: text(64, 6) };
const process = { timeoutMs: number(1, PROCESS_POLICIES.server.maxMs), executable: text(32768), script: text(PROCESS_LIMITS.scriptBytes), "args": items(4096), "args.*": text(32768, 0) };
const limits: Record<string, Record<string, Partial<ToolSchema>>> = {
  list_files: page, glob_files: { ...page, pattern: text(TOOL_BOUNDS.pattern) },
  search_text: { ...page, query: text(TOOL_BOUNDS.query), pattern: text(TOOL_BOUNDS.pattern) },
  read_file: { startLine: number(1, TOOL_BOUNDS.startLine), limit: number(1, TOOL_BOUNDS.lines), maxBytes: number(4, TOOL_BOUNDS.readBytes) },
  prepare_change: { operations: items(TOOL_BOUNDS.operations, 1), "operations.*.hunks": items(TOOL_BOUNDS.hunks, 1), "operations.*.hunks.*.startLine": number(1), "operations.*.expectedHash": text(64,64) },
  apply_change: { changeId: text(36,36), digest: text(64,64) }, undo_change: { changeId: text(36,36), digest: text(64,64) },
  run_process: process, run_shell: process,
  job_status: { jobId: text(36,36) }, job_stop: { jobId: text(36,36) },
  job_wait: { jobId: text(36,36), waitMs: number(1,PROCESS_LIMITS.waitMs) },
  job_output: { jobId: text(36,36), offset: number(0), limit: number(1,PROCESS_LIMITS.pageCharacters) },
  job_input: { jobId: text(36,36), text: text(PROCESS_LIMITS.inputChunkBytes,0) },
  git_status: {}, git_diff: { paths: items(TOOL_BOUNDS.paths,1) }, git_log: { limit: number(1,TOOL_BOUNDS.gitLog) },
  git_show: { paths: items(TOOL_BOUNDS.paths,1), revision: text(64) },
  git_stage: { ...bindings, paths: items(TOOL_BOUNDS.paths,1) }, git_unstage: { ...bindings, paths: items(TOOL_BOUNDS.paths,1) },
  git_prepare_commit: { paths: items(TOOL_BOUNDS.paths,1) },
  git_commit: { ...bindings, previewId: text(36,36), message: text(16384) },
  git_branch: { name: text(200), expectedHead: text(64,40) }, git_switch: { branch: text(200), expectedHead: text(64,40) },
  git_fetch: { branch: text(200), remote: text(200), expectedHead: text(64,40) },
  git_pull: { branch: text(200), remote: text(200), expectedHead: text(64,40) }, git_push: { branch: text(200), remote: text(200), expectedHead: text(64,40) },
  language_query: { line: number(1), column: number(1) },
  verify_command: { ...process, timeoutMs: number(1,3600000) }, ask_user: { question: text(2000) },
  repository_search: { query: text(TOOL_BOUNDS.query), pattern: text(TOOL_BOUNDS.pattern) },
  update_tasks: { expectedRevision: number(0,Number.MAX_SAFE_INTEGER-2), tasks: items(TOOL_BOUNDS.tasks), "tasks.*.id": text(64), "tasks.*.title": text(512),
    "tasks.*.dependencies": items(TOOL_BOUNDS.tasks), "tasks.*.dependencies.*": text(64), "tasks.*.evidence": items(TOOL_BOUNDS.evidence),
    "tasks.*.evidence.*.toolId": text(128), "tasks.*.evidence.*.summary": text(512) },
  delegate_tasks: { tasks: items(TOOL_BOUNDS.children,1), "tasks.*.title": text(160), "tasks.*.prompt": text(48000), "tasks.*.taskId": text(64) },
};

/** Both the provider definition and executor validation receive this same schema. */
export function toolParameters<T extends ToolSchema>(name: string, input: T): T {
  const visit = (input: ToolSchema, path: string): ToolSchema => {
    // Factories reuse primitive descriptors; cloning each node avoids aliasing
    // a hash constraint onto an unrelated path/content/name field.
    const node = { ...structuredClone(input), ...(limits[name]?.[path] ?? {}) } as ToolSchema;
    if (node.type === "object" && node.properties) node.properties = Object.fromEntries(Object.entries(node.properties)
      .map(([key, child]) => [key, visit(child, path ? `${path}.${key}` : key)]));
    if (node.type === "array") node.items = visit(node.items, `${path}.*`);
    return node;
  };
  return visit(input, "") as T;
}
const type = (value: unknown) => value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
export function contractIssue(path: string, expected: string, value: unknown): never {
  throw new ToolArgumentError({ stage: "contract", path, code: value === undefined ? "required" : "constraint", expected, receivedType: type(value) });
}
/** Pure, value-free diagnostics; workspace preconditions still run again at dispatch. */
export function validateToolContract(name: string, args: Readonly<JsonObject>): void {
  const path = (value: unknown, field: string, root = false) => {
    try { if (name === "language_query") projectPath(value as string, root); else fileToolPath(value, root); }
    catch { contractIssue(field, root ? "valid path; . denotes the selected project root" : "valid file path within the selected project", value); }
  };
  if (["list_files","glob_files","search_text","read_file","language_query"].includes(name) && args.path !== undefined) path(args.path,"$.path",name !== "read_file" && name !== "language_query");
  if (["glob_files","search_text","repository_search"].includes(name) && args.pattern !== undefined) {
    try { globMatcher(args.pattern as string); } catch { contractIssue("$.pattern","relative glob using *, ? and whole-segment **; no braces or character classes",args.pattern); }
  }
  if (["search_text","repository_search"].includes(name)) {
    try { textMatcher(args.query as string,args.regex === true,args.caseSensitive !== false); }
    catch { contractIssue("$.query","single-line literal or fixed-width regex without repetitions/groups",args.query); }
  }
  if (name === "prepare_change") {
    const used = new Set<string>();
    for (const [index, value] of (args.operations as JsonObject[]).entries()) {
      const base = `$.operations[${index}]`;
      path(value.path,`${base}.path`);
      if (value.to !== undefined) path(value.to,`${base}.to`);
      const required = ({ create: ["content"], mkdir: [], update: ["expectedHash","content"], replace: ["expectedHash","oldText","newText"],
        patch: ["expectedHash","hunks"], delete: ["expectedHash"], move: ["expectedHash","to"] } as Record<string,string[]>)[String(value.type)]!;
      for (const key of required) if (value[key] === undefined) contractIssue(`${base}.${key}`, `required for ${value.type} operation`, undefined);
      for (const key of Object.keys(value)) if (!["type","path",...required].includes(key)) contractIssue(`${base}.<unexpected>`, `only type, path, ${required.join(", ")} for ${value.type}`, value[key]);
      if (value.expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(String(value.expectedHash))) contractIssue(`${base}.expectedHash`, "current file sha256 from read_file", value.expectedHash);
      for (const field of value.type === "move" ? ["path", "to"] : ["path"]) {
        const key = fileToolPath(value[field]).toLowerCase();
        if (used.has(key)) contractIssue(`${base}.${field}`, "one operation per file; combine edits into one patch with multiple hunks, or prepare/apply one replace then read the new hash", value[field]);
        used.add(key);
      }
      if (value.type === "replace") {
        if (!value.oldText) contractIssue(`${base}.oldText`, "nonempty unique literal text from read_file", value.oldText);
        if (value.oldText === value.newText) contractIssue(`${base}.newText`, "replacement different from oldText", value.newText);
      }
      if (value.type === "patch") {
        let previous = 0;
        for (const [h, hunk] of (value.hunks as JsonObject[]).entries()) {
          if (Number(hunk.startLine) <= previous) contractIssue(`${base}.hunks[${h}].startLine`, "strictly increasing original line numbers; combine edits on the same line", hunk.startLine);
          previous = Number(hunk.startLine);
          if (hunk.oldText === hunk.newText) contractIssue(`${base}.hunks[${h}].newText`, "replacement different from oldText", hunk.newText);
        }
      }
    }
  }
  if (name === "run_process" || name === "run_shell") {
    const category = (args.category ?? "short") as keyof typeof PROCESS_POLICIES, max = PROCESS_POLICIES[category].maxMs;
    if (Number(args.timeoutMs) > max) contractIssue("$.timeoutMs", `integer <= ${max} for ${category} category`, args.timeoutMs);
    if (category === "server" && args.background === false) contractIssue("$.background", "true for server category", args.background);
    if (args.interactive && !args.background && category !== "server") contractIssue("$.background", "true when interactive is true", args.background);
  }
  if (name === "run_shell" && Buffer.byteLength(args.script as string) > PROCESS_LIMITS.scriptBytes) contractIssue("$.script",`at most ${PROCESS_LIMITS.scriptBytes} utf8 bytes`,args.script);
  if (name === "job_input" && Buffer.byteLength(args.text as string) > PROCESS_LIMITS.inputChunkBytes) contractIssue("$.text",`at most ${PROCESS_LIMITS.inputChunkBytes} utf8 bytes`,args.text);
  if (name === "job_input" && !args.text && !args.eof) contractIssue("$.text", "nonempty text or eof: true", args.text);
  if (name === "language_query" && args.operation !== "diagnostics") {
    for (const key of ["line","column"]) if (args[key] === undefined) contractIssue(`$.${key}`, "one-based position for definition/references", undefined);
  }
  if (name === "git_stage") {
    const paths = args.paths as string[], hashes = args.expectedHashes as JsonObject;
    if (paths.some(path => !Object.hasOwn(hashes,path)) || Object.keys(hashes).some(path => !paths.includes(path))) contractIssue("$.expectedHashes", "exactly one hash for each selected path", hashes);
  }
  if (name === "update_tasks") {
    const tasks = args.tasks as JsonObject[], ids = new Set(tasks.map(task => task.id));
    if (ids.size !== tasks.length) contractIssue("$.tasks", "unique task ids", tasks);
    for (const [index, task] of tasks.entries()) {
      const deps = task.dependencies as string[];
      if (deps.some(dep => !ids.has(dep) || dep === task.id) || new Set(deps).size !== deps.length) contractIssue(`$.tasks[${index}].dependencies`, "unique existing task ids excluding self", deps);
      if (task.status === "completed" && !(task.evidence as unknown[]).length) contractIssue(`$.tasks[${index}].evidence`, "successful earlier tool call ids and summaries", task.evidence);
    }
    const visiting = new Set<unknown>(), done = new Set<unknown>();
    const visit = (task: JsonObject): void => {
      if (visiting.has(task.id)) contractIssue("$.tasks", "acyclic dependencies", tasks);
      if (done.has(task.id)) return;
      visiting.add(task.id);
      for (const dep of task.dependencies as string[]) {
        const dependency = tasks.find(item => item.id === dep)!;
        if (task.status === "completed" && dependency.status !== "completed") contractIssue("$.tasks", "completed dependencies before completing a task", tasks);
        visit(dependency);
      }
      visiting.delete(task.id); done.add(task.id);
    };
    tasks.forEach(visit);
  }
}
