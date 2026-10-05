import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import { AgentSanitizer } from "../agent/data";
import { AgentError } from "../agent/errors";
import { validateArguments } from "../api/tool-schema";
import type { JsonObject, ToolSchema } from "../types";
import type { Workspace } from "../workspace";
import type { ProcessManager } from "./process";
import { languageQuery } from "./language";
import { toolParameters } from "./contracts";
import { basename, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

function verificationPreflight(workspace: Workspace, args: JsonObject) {
  const executable = args.executable as string, argv = args.args as string[];
  if (!(isAbsolute(executable) ? existsSync(executable) : Bun.which(executable))) return { ok: false, error: "missing_dependency", dependency: basename(executable), nextAction: "choose an installed executable; this command was not started" };
  const name = basename(executable).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  if (["npm","pnpm","yarn","bun"].includes(name) && ["run","run-script","test"].includes(argv[0] ?? "")) {
    const script = argv[0] === "test" ? "test" : argv[1];
    let scripts: Record<string,unknown> = {};
    try { scripts = JSON.parse(workspace.read(`${args.cwd && args.cwd !== "." ? String(args.cwd)+"/" : ""}package.json`, {maxBytes:65536,limit:2000}).content).scripts ?? {}; } catch { /* no discovered script */ }
    if (!script || typeof scripts[script] !== "string") return { ok:false,error:"verification_unavailable",nextAction:"choose a script present in package.json or an installed verifier",availableScripts:Object.keys(scripts).slice(0,64) };
  }
  if (name === "npx") return { ok:false,error:"verification_unavailable",nextAction:"use a discovered package script or an installed executable directly; verify_command does not download or invent verifiers" };
  return null;
}

export type AskUser = (question: string, signal: AbortSignal) => Promise<string>;
const str: ToolSchema = { type: "string" }, num: ToolSchema = { type: "integer" };
export function createCodingTools(workspace: Workspace, manager: ProcessManager, ask: AskUser, secrets: readonly string[]): AgentTool[] {
  const safe = new AgentSanitizer(secrets);
  const tool = (name: string, description: string, properties: Record<string, ToolSchema>, required: string[],
    run: (args: JsonObject, context: ToolInvocationContext) => Promise<unknown>, read = false): AgentTool => {
    const parameters = toolParameters(name, { type: "object", properties, required, additionalProperties: false } as ToolSchema & { type: "object" });
    return { name, version: "1", schemaVersion: "1", effect: read ? "read" : "execute", scope: read ? "project" : "external", timeoutMs: 3630000,
      definition: { type: "function", function: { name, description, parameters } },
      validate: (args) => {
        try {
          validateArguments(args as JsonObject, parameters);
          if ([args.line, args.column].some((v) => v !== undefined && (!Number.isSafeInteger(v) || Number(v) < 1))) return false;
          if (args.query !== undefined && (!(args.query as string).length || (args.query as string).length > 1024)) return false;
          if (args.question !== undefined && (!(args.question as string).trim() || (args.question as string).length > 2000)) return false;
          return true;
        } catch { return false; }
      }, execute: async (args, context) => {
        try { return safe.result(await run(args as JsonObject, context), 256 * 1024); }
        catch (error) {
          if (error instanceof AgentError) throw error;
          return { ok: false, error: "coding_operation_failed", detail: safe.text(error instanceof Error ? error.message : "unavailable").slice(0, 300) };
        }
      } };
  };
  return [
    tool("diagnostics", "report local execution capabilities only; never include prompts, files, credentials, private instructions or provider responses.", {}, [],
      async () => ({
        platform: process.platform,
        arch: process.arch,
        shell: process.platform === "win32" ? "powershell" : "sh",
        commands: Object.fromEntries(["git", "rg", "node", "bun", "npm"].map(name => [name, !!Bun.which(name)])),
      }), true),
    tool("language_query", "typescript/javascript lsp diagnostics, definition or references using bundled typescript 7. requires host execution approval; project configuration is read by the server. one-based line/column, utf16. bounded 20s session, cleanup after query. unsupported languages return unavailable.",
      { path: str, operation: { type: "string", enum: ["diagnostics", "definition", "references"] }, line: num, column: num }, ["path", "operation"],
      (args, ctx) => languageQuery(workspace, manager, args as Parameters<typeof languageQuery>[2], ctx)),
    tool("verify_command", "run an explicit test, format or check command through managed build lifecycle. executable and argv are reviewed; formatter writes have host privileges. use scripts discovered in the repository; returns observed exit, duration and output.",
      { kind: { type: "string", enum: ["test", "format", "check"] }, executable: str, args: { type: "array", items: str }, cwd: str, timeoutMs: num }, ["kind", "executable", "args"],
      async (args, ctx) => {
        const unavailable = verificationPreflight(workspace,args);
        if (unavailable) return unavailable;
        return { kind: args.kind, ...await manager.run({ executable: args.executable as string, args: args.args as string[], cwd: args.cwd as string | undefined,
          timeoutMs: args.timeoutMs as number | undefined, category: "build", ownerId: ctx.runId, signal: ctx.signal }) };
      }),
    tool("ask_user", "ask one concise question only when a missing requirement prevents progress. waits for an explicit user answer; cancellation is recorded. never requests passwords or api keys.",
      { question: str }, ["question"], async (args, ctx) => ({ answer: await ask(args.question as string, ctx.signal) }), true),
    tool("repository_search", "bounded literal repository search with rg over validated text snapshots on stdin. honors workspace ignores and protected paths. up to 100 files/512 kib per call; use pattern to narrow. returns hashes, line context and explicit incompleteness; built-in fallback when rg unavailable.",
      { query: str, pattern: str }, ["query"], async (args, ctx) => {
        const query = args.query as string, pattern = args.pattern as string ?? "**";
        const rg = Bun.which("rg");
        if (!rg) return { engine: "builtin", ...workspace.search({ query, pattern, signal: ctx.signal }) };
        const list = workspace.glob({ pattern, limit: 100, signal: ctx.signal });
        const lines: { path: string; hash: string; line: number; text: string }[] = [];
        let bytes = 0, incomplete = list.truncated;
        for (const path of list.paths) {
          try {
            const file = workspace.read(path, { maxBytes: 65536, limit: 2000, signal: ctx.signal });
            if (bytes + Buffer.byteLength(file.content) > 512 * 1024) { incomplete = true; break; }
            incomplete ||= file.truncated; bytes += Buffer.byteLength(file.content);
            const rows = file.content.split("\n");
            for (let i = 0; i < rows.length; i++) lines.push({ path, hash: file.hash, line: file.startLine + i, text: rows[i].replace(/\r$/, "") });
          } catch { incomplete = true; }
        }
        const result = await manager.run({ executable: rg, args: ["--no-config", "--json", "--fixed-strings", "--", query], input: lines.map((line) => line.text).join("\n"), ownerId: ctx.runId, signal: ctx.signal });
        if (result.status !== "exited" || ![0, 1].includes(result.exitCode ?? -1)) return { ok: false, engine: "rg", process: result };
        const matches = [];
        for (const row of result.stdout.split("\n").filter(Boolean)) {
          let value; try { value = JSON.parse(row); } catch { incomplete = true; continue; }
          if (value.type !== "match") continue;
          const index = value.data.line_number - 1, match = lines[index];
          if (!match) { incomplete = true; continue; }
          if (matches.length >= 200) { incomplete = true; break; }
          matches.push({ ...match, text: match.text.slice(0, 2000), context: lines.slice(Math.max(0, index - 1), index + 2).filter((line) => line.path === match.path).map((line) => ({ line: line.line, text: line.text.slice(0, 2000) })) });
        }
        return { ok: true, engine: "rg", matches, truncated: incomplete || result.outputTruncated, scannedFiles: list.paths.length };
      }),
  ];
}
