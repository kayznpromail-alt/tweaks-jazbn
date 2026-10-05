import { validateArguments } from "../api/tool-schema";
import { AgentError } from "../agent/errors";
import type { ApprovalCallback, ApprovalRequest } from "../agent/policy";
import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import type { JsonObject, JsonValue, ToolSchema } from "../types";
import { Workspace, WorkspaceError, type ChangeOperation, type ChangeReview } from "../workspace";
import { validateOperations } from "../workspace/changes";
import { aborted, fail, safeError } from "../workspace/errors";
import { pathKey, projectPath, WorkspacePaths } from "../workspace/paths";
import { integer, retainable } from "../workspace/text";
import { EXECUTABLE_ARGUMENT_BYTES } from "../api/limits";
import { toolParameters, validateToolContract } from "./contracts";
import { fileToolArguments } from "./file-paths";
import { ToolArgumentError } from "../api/tool-validation";

const str: ToolSchema = { type: "string" }, num: ToolSchema = { type: "integer" }, bool: ToolSchema = { type: "boolean" };
const object = (properties: Record<string, ToolSchema>, required: string[] = []): ToolSchema & { type: "object" } => ({ type: "object", properties, required, additionalProperties: false });
const paging = { path: str, offset: num, limit: num, includeIgnored: bool };
const changeSchema = object({ changeId: str, digest: str }, ["changeId", "digest"]);
function changeArgs(args: Readonly<JsonObject>): boolean {
  return typeof args.changeId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.changeId)
    && typeof args.digest === "string" && /^[0-9a-f]{64}$/.test(args.digest);
}
function page(args: Readonly<JsonObject>): boolean {
  if (args.path !== undefined) projectPath(args.path as string, true);
  integer(args.offset, 0, 0, 100_000); integer(args.limit, 100, 1, 500);
  return true;
}
function scope(workspace: Workspace, context: ToolInvocationContext): void {
  aborted(context.signal);
  if (pathKey(new WorkspacePaths(context.project).root) !== pathKey(workspace.root)) fail("outside_workspace");
}
export function createFileTools(workspace: Workspace, options: {
  beforeEffect?: (context: ToolInvocationContext) => void | Promise<void>;
} = {}): AgentTool[] {
  const tool = (name: string, description: string, parameters: ToolSchema & { type: "object" }, effect: AgentTool["effect"],
    check: (args: Readonly<JsonObject>) => boolean, run: (args: Readonly<JsonObject>, context: ToolInvocationContext) => unknown | Promise<unknown>): AgentTool => {
    parameters = toolParameters(name, parameters);
    const validate = (args: Readonly<JsonObject>) => {
      try {
        validateArguments(args as JsonObject, parameters);
        retainable(args, [], EXECUTABLE_ARGUMENT_BYTES);
        validateToolContract(name, args);
        try {
          const normalized = fileToolArguments(workspace.root, name, args);
          validateToolContract(name, normalized);
          return check(normalized);
        }
        catch (error) { if (error instanceof WorkspaceError && error.code === "outside_workspace") return true; throw error; }
      } catch (error) { if (error instanceof ToolArgumentError) throw error; return false; }
    };
    const changeTool = ["prepare_change", "apply_change", "undo_change"].includes(name);
    return { name, version: changeTool ? "2" : "1", schemaVersion: name === "prepare_change" ? "2" : "1", effect, scope: "project", timeoutMs: 30_000,
      definition: { type: "function", function: { name, description, parameters } }, validate,
      execute: async (args, context): Promise<JsonValue> => {
        try {
          if (!validate(args)) fail("invalid_input");
          scope(workspace, context);
          const result = await run(fileToolArguments(workspace.root, name, args), context);
          retainable(result, [], 1024 * 1024);
          return result as JsonValue;
        } catch (error) {
          const safe = safeError(error);
          if (safe.code === "journal_failed") throw new AgentError("outcome_unknown");
          if (safe.code === "outside_workspace") return { ok: false, error: { code: safe.code,
            message: "the requested path is outside the selected project; no files were accessed or changed." },
            projectRoot: workspace.root, retryable: false, action: "select_project",
            hint: "do not retry this path or bypass the boundary with shell commands. ask the user to open the requested folder with /project, or select a common parent folder for multiple projects, then continue there. . means the currently selected project, not the requested external folder." };
          return { ok: false, error: { code: safe.code, message: safe.message,
            ...(safe.detail ? { detail: { ...safe.detail }, hint: "read_file at this original startLine; copy complete lines including newline bytes. for a substring edit use one replace operation with unique oldText and the fresh file hash." } : {}) } };
        }
      },
    };
  };
  return [
    tool("list_files", "list a project directory with bounded pagination; . means the selected project root. relative paths and absolute paths inside that project are accepted. outside paths return select_project; use /project to select the target folder or common parent. dependency and build directories are skipped by default.", object(paging), "read", page,
      (args, ctx) => workspace.list({ ...args, signal: ctx.signal })),
    tool("glob_files", "find project files using *, ? and whole-segment **; no braces, negation or character classes.", object({ ...paging, pattern: str }, ["pattern"]), "read", page,
      (args, ctx) => workspace.glob({ ...args, pattern: args.pattern as string, signal: ctx.signal })),
    tool("read_file", "read a bounded utf8 line range with the exact sha256, newline and truncation metadata.", object({ path: str, startLine: num, limit: num, maxBytes: num }, ["path"]), "read", (args) => {
      projectPath(args.path as string); integer(args.startLine, 1, 1, 1_000_001); integer(args.limit, 200, 1, 2000); integer(args.maxBytes, 32768, 4, 131072); return true;
    }, (args, ctx) => workspace.read(args.path as string, { ...args, signal: ctx.signal })),
    tool("search_text", "search project text literally by default. regex supports fixed-width atoms, character classes and anchors only; repetition and groups are rejected.",
      object({ ...paging, query: str, pattern: str, regex: bool, caseSensitive: bool }, ["query"]), "read", page,
      (args, ctx) => workspace.search({ ...args, pattern: (args.pattern as string | undefined) ?? "**", query: args.query as string, signal: ctx.signal })),
    tool("prepare_change", `prepare exact operations and return diff, changeId and digest; never edits project files. create/update use content; replace uses nonempty unique literal oldText and newText (no count/regex); patch uses ordered nonoverlapping hunks {startLine,oldText,newText} on original 1-based whole lines, including exact newline bytes; empty oldText inserts at a line boundary. update/replace/patch/delete/move require the full file's current sha256 expectedHash. move uses to. mkdir creates an absent directory; create/move include missing parents in the review. prefer replace/patch for small edits to large files. one operation per file; combine same-file edits into one patch with multiple hunks. at most 32 operations, 192 prepared entries and ${EXECUTABLE_ARGUMENT_BYTES / 1024} kib utf8 json argument bytes, including keys/escaping; live drafts share this boundary.`,
      object({ operations: { type: "array", items: object({ type: { type: "string", enum: ["create", "mkdir", "update", "replace", "patch", "delete", "move"] }, path: str, content: str, expectedHash: str, oldText: str, newText: str,
        hunks: { type: "array", items: object({ startLine: num, oldText: str, newText: str }, ["startLine", "oldText", "newText"]) }, to: str }, ["type", "path"]) } }, ["operations"]),
      "read", (args) => { validateOperations(args.operations); return true; },
      (args, ctx) => workspace.prepareChanges(args.operations as unknown as ChangeOperation[], { signal: ctx.signal })),
    tool("apply_change", "apply a previously reviewed changeId and digest, rechecking every preimage; partial effects are journaled and require explicit compensation.", changeSchema, "write", changeArgs,
      (args, ctx) => workspace.applyChanges(args.changeId as string, args.digest as string, { signal: ctx.signal, beforeEffect: () => options.beforeEffect?.(ctx) })),
    tool("undo_change", "explicitly compensate a journaled change only where current contents still match its postimages; preserves unrelated edits.", changeSchema, "write", changeArgs,
      (args, ctx) => workspace.undoChanges(args.changeId as string, args.digest as string, { signal: ctx.signal, beforeEffect: () => options.beforeEffect?.(ctx) })),
  ];
}

export interface FileApprovalRequest extends ApprovalRequest { readonly preview: ChangeReview | null }
export type FileApprovalCallback = (request: FileApprovalRequest, signal: AbortSignal) => Promise<"allow" | "deny">;

/** Main wraps its approval callback with this to display exact diff content before a decision.
 * Approval remains bound to the original arguments; execute independently verifies the signed record. */
export function withFileToolReview(workspace: Workspace, approval: FileApprovalCallback): ApprovalCallback {
  return async (request, signal) => {
    aborted(signal);
    let preview: ChangeReview | null = null;
    if (request.binding.name === "apply_change" || request.binding.name === "undo_change") {
      if (pathKey(new WorkspacePaths(request.binding.project).root) !== pathKey(workspace.root) || !changeArgs(request.args)) throw new WorkspaceError("invalid_change");
      preview = request.binding.name === "undo_change"
        ? workspace.getUndoReview(request.args.changeId as string, request.args.digest as string, { signal })
        : workspace.getChangeReview(request.args.changeId as string, request.args.digest as string);
    }
    return approval({ ...request, preview }, signal);
  };
}
