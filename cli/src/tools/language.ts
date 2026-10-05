import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDataDirectory } from "../storage/paths";
import { ensureDirectory } from "../workspace/artifacts";
import { AgentError } from "../agent/errors";
import type { ToolInvocationContext } from "../agent/registry";
import type { Workspace } from "../workspace";
import type { ProcessManager } from "./process";

let bundledTypescript: string | undefined;
let bundledLibraries: Record<string,string> = {};
export function setBundledTypescript(asset: string, libraries: Record<string,string> = {}): void { bundledTypescript = asset; bundledLibraries = libraries; }
export function typescriptExecutable(): string {
  try {
    if (bundledTypescript) {
      const bytes = readFileSync(bundledTypescript), hash = createHash("sha256").update(bytes).digest("hex");
      const directory = join(getDataDirectory(), "runtime", `typescript-${hash}`); ensureDirectory(directory);
      const executable = join(directory, process.platform === "win32" ? "tsc.exe" : "tsc");
      if (!existsSync(executable)) {
        try { writeFileSync(executable, bytes, { flag: "wx", mode: 0o700 }); }
        catch (error) { if (!existsSync(executable)) throw error; }
      }
      if (createHash("sha256").update(readFileSync(executable)).digest("hex") !== hash) throw new Error();
      for (const [name, asset] of Object.entries(bundledLibraries)) {
        if (!/^lib[.a-z0-9-]*\.d\.ts$/.test(name)) throw new Error();
        const target = join(directory,name), library = readFileSync(asset);
        if (!existsSync(target)) {
          try { writeFileSync(target,library,{flag:"wx",mode:0o600}); }
          catch (error) { if (!existsSync(target)) throw error; }
        }
        if (!readFileSync(target).equals(library)) throw new Error();
      }
      return executable;
    }
    const pkg = fileURLToPath(import.meta.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`));
    const executable = join(dirname(pkg), "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
    if (!existsSync(executable)) throw new Error();
    return executable;
  } catch { throw new Error("language_server_unavailable"); }
}

/** short-lived lsp session under the existing process supervisor and command permission. */
export async function languageQuery(workspace: Workspace, manager: ProcessManager, args: {
  path: string; operation: "diagnostics" | "definition" | "references"; line?: number; column?: number;
}, context: ToolInvocationContext) {
  const extension = extname(args.path).toLowerCase();
  const language = ({ ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact" } as Record<string, string>)[extension];
  if (!language) return { ok: false, error: "unsupported_language" };
  const source = workspace.read(args.path, { maxBytes: 128 * 1024, limit: 2000, signal: context.signal });
  if (source.truncated) return { ok: false, error: "language_document_too_large" };
  if (args.operation !== "diagnostics") {
    const lines = source.content.split("\n"), line = args.line ?? 0, column = args.column ?? 0;
    if (line < 1 || line > lines.length || column < 1 || column > lines[line - 1]!.replace(/\r$/, "").length + 1) {
      return { ok: false, error: "invalid_position", detail: "use one-based line and utf16 column within the current file" };
    }
  }
  let executable: string;
  try { executable = typescriptExecutable(); }
  catch { return { ok: false, error: "missing_dependency", dependency: "typescript language server", nextAction: "use read_file/search_text and an available project verification command" }; }
  const uri = pathToFileURL(workspace.paths.resolve(args.path).absolute).href;
  const abort = new AbortController(), signal = AbortSignal.any([context.signal, abort.signal, AbortSignal.timeout(20000)]);
  let buffer = Buffer.alloc(0), sequence = 0, fault = false, total = 0;
  const responses = new Map<number, Record<string, any>>(), serverRequests: Record<string, any>[] = [];
  const receive = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) { fault = true; abort.abort(); return; }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      while (true) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) { if (buffer.length > 8192) throw new Error(); break; }
        const header = buffer.subarray(0, end).toString("ascii");
        const match = /^Content-Length: (\d+)$/im.exec(header);
        if (!match || Number(match[1]) > 1024 * 1024) throw new Error();
        const length = Number(match[1]);
        if (buffer.length < end + 4 + length) break;
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
        buffer = buffer.subarray(end + 4 + length);
        if (!message || message.jsonrpc !== "2.0") throw new Error();
        if (message.method && message.id !== undefined) serverRequests.push(message);
        else if (Number.isSafeInteger(message.id)) responses.set(message.id, message);
        if (responses.size + serverRequests.length > 64) throw new Error();
      }
    } catch { fault = true; abort.abort(); }
  };
  const job = await manager.run({ executable, args: ["--lsp", "--stdio"], background: true, interactive: true,
    timeoutMs: 20000, ownerId: context.runId, signal, onStdout: receive });
  const send = async (message: unknown) => {
    while (!manager.status(job.jobId, context.runId).pid) {
      if (signal.aborted || manager.status(job.jobId, context.runId).status !== "running") throw new Error("language_server_stopped");
      await Bun.sleep(10);
    }
    const json = JSON.stringify(message), frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    for (let start = 0; start < frame.length;) {
      let end = Math.min(start + 2048, frame.length);
      if (end < frame.length && /[\ud800-\udbff]/.test(frame[end - 1])) end--;
      await manager.sendInput(job.jobId, frame.slice(start, end), false, context.runId, signal); start = end;
    }
  };
  const request = async (method: string, params: unknown) => {
    const id = ++sequence; await send({ jsonrpc: "2.0", id, method, params });
    while (!responses.has(id)) {
      if (fault) throw new Error("invalid_language_response");
      if (signal.aborted) throw new AgentError(context.signal.aborted ? "aborted" : "timeout");
      if (manager.status(job.jobId, context.runId).status !== "running") throw new Error("language_server_stopped");
      for (const item of serverRequests.splice(0)) await send({ jsonrpc: "2.0", id: item.id,
        ...(item.method === "workspace/configuration" ? { result: (item.params?.items ?? []).slice(0, 64).map(() => ({})) }
          : { error: { code: -32601, message: "unsupported client request" } }) });
      await Bun.sleep(10);
    }
    const response = responses.get(id)!; responses.delete(id);
    if (response.error) throw new Error("language_request_failed");
    return response.result;
  };
  try {
    const initialized = await request("initialize", { processId: process.pid, rootUri: pathToFileURL(workspace.root).href,
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} } }, workspaceFolders: [{ uri: pathToFileURL(workspace.root).href, name: "project" }] });
    const capabilities = initialized?.capabilities;
    const capability = args.operation === "diagnostics" ? "diagnosticProvider" : args.operation === "definition" ? "definitionProvider" : "referencesProvider";
    if (!capabilities?.[capability]) return { ok: false, error: "language_capability_unavailable" };
    await send({ jsonrpc: "2.0", method: "initialized", params: {} });
    await send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: language, version: 1, text: source.content } } });
    const result = await request(`textDocument/${args.operation === "diagnostics" ? "diagnostic" : args.operation}`, {
      textDocument: { uri }, ...(args.operation === "diagnostics" ? {} : { position: { line: (args.line ?? 1) - 1, character: (args.column ?? 1) - 1 }, context: { includeDeclaration: true } }) });
    const items = args.operation === "diagnostics" ? result?.items : result === null ? [] : Array.isArray(result) ? result : [result];
    if (!Array.isArray(items) || items.length > 10000) throw new Error("invalid_language_response");
    const output = items.slice(0, 200).map((item: any) => {
      const range = item.range ?? item.targetSelectionRange;
      if (!range || ![range.start?.line, range.start?.character, range.end?.line, range.end?.character].every((v) => Number.isSafeInteger(v) && v >= 0)) throw new Error("invalid_language_response");
      const path = args.operation === "diagnostics" ? args.path : relative(workspace.root, fileURLToPath(item.uri ?? item.targetUri)).replaceAll("\\", "/");
      workspace.paths.resolve(path);
      if (args.operation === "diagnostics" && typeof item.message !== "string") throw new Error("invalid_language_response");
      return { path, line: range.start.line + 1, column: range.start.character + 1,
        ...(args.operation === "diagnostics" ? { message: item.message.slice(0, 2000), code: String(item.code ?? ""), severity: item.severity ?? null } : {}) };
    });
    return { ok: true, path: args.path, hash: source.hash, operation: args.operation, positions: "one-based utf16", items: output, truncated: items.length > output.length };
  } finally {
    const stopped = await manager.stop(job.jobId, context.runId);
    if (stopped.cleanup !== "confirmed") throw new AgentError("outcome_unknown");
  }
}
