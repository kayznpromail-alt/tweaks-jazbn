import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import { validateArguments } from "../api/tool-schema";
import type { JsonObject, JsonValue, ToolSchema } from "../types";
import { aborted, fail, safeError } from "../workspace/errors";
import { hashText, integer, retainable } from "../workspace/text";
import { ArtifactStore } from "../workspace/artifacts";
import { WorkspacePaths } from "../workspace/paths";
import { toolParameters } from "./contracts";
import { AgentError } from "../agent/errors";

export interface TaskEvidence { toolId: string; summary: string }
export interface WorkspaceTask {
  id: string; title: string; status: "pending" | "in_progress" | "blocked" | "completed";
  dependencies: string[]; evidence: TaskEvidence[];
}
export interface TaskSnapshot { revision: number; tasks: WorkspaceTask[] }
export interface TaskManagerOptions {
  /** Optional built-in signed, append-only run snapshots outside the project. */
  artifacts?: { project: string; artifactDir: string };
  /** Host persistence adapters. Omitted adapters keep run-scoped tasks in memory. */
  load?: (runId: string) => TaskSnapshot | null | Promise<TaskSnapshot | null>;
  save?: (runId: string, snapshot: TaskSnapshot, expectedRevision: number) => void | Promise<void>;
  /** Must check successful durable tool evidence for this run. Completion fails closed if absent. */
  verifyEvidence?: (runId: string, evidence: Readonly<TaskEvidence>) => boolean | Promise<boolean>;
  secrets?: readonly string[];
}
const label = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\r\n\x00-\x1f]/.test(value);
function validateTasks(value: unknown): asserts value is WorkspaceTask[] {
  retainable(value, [], 48 * 1024);
  if (!Array.isArray(value) || value.length > 64) fail("invalid_input");
  const tasks = new Map<string, WorkspaceTask>();
  for (const task of value) {
    if (!task || typeof task !== "object" || Object.keys(task).sort().join() !== "dependencies,evidence,id,status,title"
      || typeof task.id !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(task.id) || tasks.has(task.id)
      || !label(task.title, 512) || !["pending", "in_progress", "blocked", "completed"].includes(task.status)
      || !Array.isArray(task.dependencies) || task.dependencies.length > 64 || new Set(task.dependencies).size !== task.dependencies.length
      || !task.dependencies.every((id: unknown) => typeof id === "string") || !Array.isArray(task.evidence) || task.evidence.length > 16) fail("invalid_input");
    for (const evidence of task.evidence) {
      if (!evidence || typeof evidence !== "object" || Object.keys(evidence).sort().join() !== "summary,toolId"
        || !label(evidence.toolId, 128) || !label(evidence.summary, 512)) fail("invalid_input");
    }
    if (task.status === "completed" && !task.evidence.length) fail("invalid_input");
    tasks.set(task.id, task);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id) || !tasks.has(id)) fail("invalid_input");
    if (done.has(id)) return;
    visiting.add(id);
    const task = tasks.get(id)!;
    for (const dep of task.dependencies) {
      visit(dep);
      if (task.status === "completed" && tasks.get(dep)!.status !== "completed") fail("invalid_input");
    }
    visiting.delete(id); done.add(id);
  };
  for (const id of tasks.keys()) visit(id);
}
export class TaskManager {
  private readonly snapshots = new Map<string, TaskSnapshot>();
  private readonly busy = new Set<string>();
  private readonly artifacts?: ArtifactStore;
  constructor(private readonly options: TaskManagerOptions = {}) {
    if (options.artifacts) {
      if (options.load || options.save) fail("invalid_input");
      this.artifacts = new ArtifactStore(options.artifacts.artifactDir, new WorkspacePaths(options.artifacts.project).root);
    }
    if (!!options.load !== !!options.save) fail("invalid_input");
  }
  private filename(runId: string, revision: number): string { return `tasks-${hashText(runId)}-${revision}.json`; }
  private fromArtifacts(runId: string): TaskSnapshot | null {
    let latest: TaskSnapshot | null = null;
    for (let revision = 1; revision <= 1024; revision++) {
      const name = this.filename(runId, revision);
      if (!this.artifacts!.exists(name)) return latest;
      const record = this.artifacts!.read(name) as unknown as TaskSnapshot;
      if (!record || typeof record !== "object" || Object.keys(record).sort().join() !== "revision,tasks" || record.revision !== revision) fail("artifact_corrupt");
      latest = record;
    }
    return latest;
  }
  async snapshot(runId: string): Promise<TaskSnapshot> {
    if (!label(runId, 128)) fail("invalid_input");
    const snapshot = this.artifacts ? this.fromArtifacts(runId) : this.options.load ? await this.options.load(runId) : this.snapshots.get(runId);
    const value = snapshot ?? { revision: 0, tasks: [] };
    integer(value.revision, 0, 0, Number.MAX_SAFE_INTEGER - 1); validateTasks(value.tasks);
    retainable(value, this.options.secrets);
    return structuredClone(value);
  }
  async update(runId: string, expectedRevision: number, tasks: readonly WorkspaceTask[], signal?: AbortSignal): Promise<TaskSnapshot> {
    aborted(signal);
    if (!label(runId, 128) || this.busy.has(runId)) fail("conflict");
    integer(expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER - 2); validateTasks(tasks);
    retainable(tasks, this.options.secrets);
    const copy = structuredClone(tasks) as WorkspaceTask[];
    this.busy.add(runId);
    try {
      const previous = await this.snapshot(runId);
      if (previous.revision !== expectedRevision) fail("conflict");
      for (const task of copy) if (task.status === "completed") {
        for (const evidence of task.evidence) {
          aborted(signal);
          if (!this.options.verifyEvidence || await this.options.verifyEvidence(runId, evidence) !== true) fail("invalid_input");
        }
      }
      aborted(signal);
      const snapshot = { revision: previous.revision + 1, tasks: copy };
      if (this.artifacts) {
        if (snapshot.revision > 1024) fail("output_limit");
        if (this.artifacts.exists(this.filename(runId, snapshot.revision))) fail("conflict");
        try { this.artifacts.create(this.filename(runId, snapshot.revision), snapshot as unknown as JsonValue); }
        catch (error) { if (this.artifacts.exists(this.filename(runId, snapshot.revision))) fail("conflict"); throw error; }
      }
      await this.options.save?.(runId, structuredClone(snapshot), expectedRevision);
      this.snapshots.set(runId, structuredClone(snapshot));
      return snapshot;
    } finally { this.busy.delete(runId); }
  }
}
const taskSchema = toolParameters("update_tasks", { type: "object", additionalProperties: false, required: ["expectedRevision", "tasks"], properties: {
  expectedRevision: { type: "integer" }, tasks: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "title", "status", "dependencies", "evidence"], properties: {
      id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "blocked", "completed"] },
      dependencies: { type: "array", items: { type: "string" } }, evidence: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["toolId", "summary"], properties: { toolId: { type: "string" }, summary: { type: "string" } } } },
    } } },
} } as ToolSchema & { type: "object" });
export function createTaskTools(manager: TaskManager = new TaskManager()): AgentTool[] {
  const validate = (args: Readonly<JsonObject>) => {
    try { validateArguments(args as JsonObject, taskSchema); integer(args.expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER - 2); validateTasks(args.tasks); return true; } catch { return false; }
  };
  return [{ name: "update_tasks", version: "1", schemaVersion: "1", effect: "read", scope: "project", validate,
    definition: { type: "function", function: { name: "update_tasks", description: "replace run-local planning tasks using expectedRevision (initially 0). dependencies must be acyclic. completed tasks require successful tool evidence verified by the host.", parameters: taskSchema } },
    execute: async (args: Readonly<JsonObject>, context: ToolInvocationContext): Promise<JsonValue> => {
      try {
        if (!validate(args)) fail("invalid_input");
        return await manager.update(context.runId, args.expectedRevision as number, args.tasks as unknown as WorkspaceTask[], context.signal) as unknown as JsonValue;
      } catch (error) {
        const safe = safeError(error);
        if (["io_error", "journal_failed", "artifact_corrupt"].includes(safe.code)) throw new AgentError("outcome_unknown");
        if (safe.code === "conflict") {
          const current = await manager.snapshot(context.runId);
          return { ok: false, error: { code: "task_revision_conflict", message: "task state changed; use the returned current revision" }, currentRevision: current.revision, tasks: current.tasks as unknown as JsonValue };
        }
        return { ok: false, error: { code: safe.code, message: safe.message },
          ...(safe.code === "invalid_input" ? { hint: "use the exact tool call id of a successful earlier tool as evidence.toolId, not its name. completed tasks need evidence and completed dependencies; ids must be unique and dependencies acyclic. the rejected update did not advance expectedRevision." } : {}) };
      }
    },
  }];
}
