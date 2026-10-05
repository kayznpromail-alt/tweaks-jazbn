import { Database, type SQLQueryBindings } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { onlyUnknownBrowserActions } from '../agent/browser-recovery';
import { summarizeActivity } from "../agent/activity-summary";
import type {
  CreateRequestAttemptInput, CreateRunInput, CreateToolExecutionInput, DurableStore,
  RequestAttempt, RequestAttemptPatch, RequestAttemptStatus, Run, RunLease,
  ToolExecution, ToolExecutionPatch, ToolExecutionStatus,
} from "../types";
import { StorageError, safely, type StorageErrorCode } from "./errors";
import { compareSchema, createClientGuards, createLegacySchema } from "./schema";
import {
  date, exact, executionLimits, finalRequests, finalTools, integer, label, parseStoredJson, readRequest, readRun, readTool,
  requestFields, requestStatuses, runFields, runStatuses, toolFields, toolStatuses,
} from "./execution-validation";

const sqlEnum = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

export function createExecutionSchema(db: Database): void {
  db.run(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(runStatuses)})),
      project TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      owner_id TEXT, lease_token TEXT, lease_expires_at TEXT,
      request_limit INTEGER CHECK (request_limit > 0), tool_limit INTEGER CHECK (tool_limit > 0), metadata TEXT,
      CHECK ((owner_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (owner_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
    );
    CREATE INDEX runs_session_created ON runs(session_id, created_at, id);
    CREATE TABLE request_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(requestStatuses)})),
      model TEXT NOT NULL, context TEXT, context_ref TEXT, usage TEXT,
      started_at TEXT, completed_at TEXT, error TEXT,
      UNIQUE (run_id, sequence), UNIQUE (id, run_id)
    );
    CREATE UNIQUE INDEX requests_one_active ON request_attempts(run_id) WHERE status IN ('pending', 'streaming');
    CREATE TABLE tool_executions (
      id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      call_id TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, schema_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${sqlEnum(toolStatuses)})),
      approval_scope TEXT, approval_decision TEXT CHECK (approval_decision IN ('approved', 'denied')),
      precondition TEXT, result TEXT, output_artifact_ref TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, error TEXT,
      UNIQUE (run_id, sequence), UNIQUE (request_id, call_id),
      FOREIGN KEY (request_id, run_id) REFERENCES request_attempts(id, run_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX tools_one_executing ON tool_executions(run_id) WHERE status = 'executing';
  `);
}

export function upgradeExecutionV3(db: Database): void {
  db.run("ALTER TABLE request_attempts ADD COLUMN output TEXT");
}

export function upgradeExecutionV4(db: Database): void {
  db.run("ALTER TABLE tool_executions ADD COLUMN activity TEXT");
}

type Entity = Run | RequestAttempt | ToolExecution;
interface Table<T extends Entity> {
  name: string;
  fields: readonly string[];
  json: readonly string[];
  read(value: unknown): T;
  code: StorageErrorCode;
}
const runs: Table<Run> = { name: "runs", fields: runFields, json: ["metadata"], read: readRun, code: "invalid_run" };
const requests: Table<RequestAttempt> = { name: "request_attempts", fields: requestFields, json: ["context", "usage", "output"], read: readRequest, code: "invalid_request" };
const tools: Table<ToolExecution> = { name: "tool_executions", fields: toolFields, json: ["args", "precondition", "result", "activity"], read: readTool, code: "invalid_tool" };
const column = (field: string) => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const now = (...floors: (string | undefined)[]) => new Date(Math.max(Date.now(), ...floors.filter(date).map(Date.parse))).toISOString();
const tick = (previous: string, ...floors: (string | undefined)[]) => new Date(Math.max(Date.parse(now(...floors)), Date.parse(previous) + 1)).toISOString();

export function validateExecutionSchema(db: Database, version = 6): void {
  const expected = new Database(":memory:");
  try {
    createLegacySchema(expected);
    createExecutionSchema(expected);
    createClientGuards(expected);
    if (version >= 3) upgradeExecutionV3(expected);
    if (version >= 4) upgradeExecutionV4(expected);
    if (version >= 5) expected.run("ALTER TABLE sessions ADD COLUMN jailbreak_profile TEXT");
    if(version>=6){expected.run("ALTER TABLE sessions ADD COLUMN private_mode TEXT");expected.run("ALTER TABLE sessions ADD COLUMN instruction_sources TEXT");}
    compareSchema(db, expected);
  } finally { expected.close(); }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => Object.hasOwn(b, key)
    && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function immutable<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): void {
  if (fields.some((field) => !same(before[field], after[field]))) throw new StorageError("record_conflict");
}

function revision(actual: number, expected: number): void {
  if (!integer(expected) || actual !== expected || actual >= Number.MAX_SAFE_INTEGER - 1) throw new StorageError("record_conflict");
}

function transition(from: string, to: string, allowed: Record<string, readonly string[]>): void {
  if (!allowed[from]?.includes(to)) throw new StorageError("invalid_transition");
}

const requestTransitions: Record<RequestAttemptStatus, readonly RequestAttemptStatus[]> = {
  pending: ["streaming", "failed", "interrupted"],
  streaming: ["streaming", "completed", "failed", "interrupted"], completed: [], failed: [], interrupted: [],
};
const toolTransitions: Record<ToolExecutionStatus, readonly ToolExecutionStatus[]> = {
  proposed: ["awaiting_approval", "approved", "denied", "cancelled"],
  awaiting_approval: ["approved", "denied", "cancelled"], approved: ["executing", "cancelled"],
  executing: ["succeeded", "failed", "outcome_unknown"], outcome_unknown: ["succeeded", "failed"],
  succeeded: [], failed: [], denied: [], cancelled: [],
};

/** Storage boundary only: no dispatch, subprocesses or implicit recovery. */
export abstract class ExecutionStore implements DurableStore {
  protected abstract get database(): Database;

  /** Read-only display projection: validate the tool and its relational scope without loading private request context. */
  readTranscriptTool(sessionId:string,id:string):ToolExecution|null {
    const row=this.database.query<Record<string,unknown>,[string,string]>(`SELECT ${toolFields.map(field=>`t.${column(field)} AS ${field}`).join(",")}
      FROM tool_executions t JOIN request_attempts q ON q.id=t.request_id AND q.run_id=t.run_id
      JOIN runs r ON r.id=q.run_id JOIN sessions s ON s.id=r.session_id AND s.project=r.project WHERE s.id=? AND t.id=?`).get(sessionId,id);
    if(!row)return null;const value:Record<string,unknown>={};
    for(const [key,field] of Object.entries(row))if(field!==null)value[key]=tools.json.includes(key)?parseStoredJson(field,key==="result"?executionLimits.resultBytes:executionLimits.jsonBytes,"invalid_tool"):field;
    return readTool(value);
  }

  private write<T>(action: () => T): T {
    return safely("write_failed", () => this.database.transaction(action).immediate());
  }

  private rows<T extends Entity>(table: Table<T>, where = "", bindings: SQLQueryBindings[] = [], order = ""): T[] {
    return safely("read_failed", () => this.database.query<Record<string, unknown>, SQLQueryBindings[]>(
      `SELECT ${table.fields.map((field) => `${column(field)} AS ${field}`).join(", ")} FROM ${table.name} ${where} ${order}`,
    ).all(...bindings).map((row) => safely(table.code, () => {
      const value: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(row)) {
        if (field !== null) value[key] = table.json.includes(key) ? parseStoredJson(field,
          key === "context" ? executionLimits.contextBytes : key === "metadata" ? executionLimits.metadataBytes : key === "output" ? executionLimits.outputBytes : key === "result" ? executionLimits.resultBytes : executionLimits.jsonBytes,
          table.code) : field;
      }
      const parsed = table.read(value);
      if (table.name === "runs") {
        const run = parsed as Run;
        const parent = this.database.query<{ project: string }, [string]>("SELECT project FROM sessions WHERE id = ?").get(run.sessionId);
        if (!parent || parent.project !== run.project) throw new StorageError(table.code);
      } else {
        const child = parsed as RequestAttempt | ToolExecution;
        // Validation only walks upward: tool -> request -> run -> session/project.
        // A parent's presence alone does not establish a valid execution chain.
        if (table.name === "tool_executions") {
          const parent = this.get(requests, (child as ToolExecution).requestId);
          if (!parent || parent.runId !== child.runId) throw new StorageError(table.code);
        } else if (!this.get(runs, child.runId)) throw new StorageError(table.code);
      }
      return parsed;
    })));
  }

  private get<T extends Entity>(table: Table<T>, id: string): T | null {
    return this.rows(table, "WHERE id = ?", [id])[0] ?? null;
  }

  private insert<T extends Entity>(table: Table<T>, value: T): T {
    if (this.get(table, value.id)) throw new StorageError("record_conflict");
    const data = value as unknown as Record<string, unknown>;
    this.database.query(`INSERT INTO ${table.name} (${table.fields.map(column).join(", ")})
      VALUES (${table.fields.map(() => "?").join(", ")})`).run(...table.fields.map((field) =>
      data[field] === undefined ? null : table.json.includes(field) ? JSON.stringify(data[field]) : data[field] as SQLQueryBindings));
    return value;
  }

  private replace<T extends Entity>(table: Table<T>, previous: T, next: T): T {
    revision(previous.revision, next.revision);
    if (table.name === "tool_executions") next = { ...next, activity: summarizeActivity(next as ToolExecution) };
    const value = table.read({ ...next, revision: previous.revision + 1 });
    const data = value as unknown as Record<string, unknown>;
    const fields = table.fields.filter((field) => field !== "id");
    const result = this.database.query(`UPDATE ${table.name} SET ${fields.map((field) => `${column(field)} = ?`).join(", ")}
      WHERE id = ? AND revision = ?`).run(...fields.map((field) => data[field] === undefined ? null
        : table.json.includes(field) ? JSON.stringify(data[field]) : data[field] as SQLQueryBindings), previous.id, previous.revision);
    if (result.changes !== 1) throw new StorageError("record_conflict");
    return value;
  }

  private requireRun(id: string): Run {
    const run = this.loadRun(id);
    if (!run) throw new StorageError("record_conflict");
    return run;
  }

  private owned(run: Run, lease?: RunLease, allowExpired = false): void {
    if (lease !== undefined) exact(lease, ["ownerId", "token"], "lease_conflict");
    if (!lease || !label(lease.ownerId) || !label(lease.token) || run.ownerId !== lease.ownerId
      || run.leaseToken !== lease.token || !run.leaseExpiresAt || (!allowExpired && Date.parse(run.leaseExpiresAt) <= Date.now())) {
      throw new StorageError("lease_conflict");
    }
  }

  private active(run: Run): void {
    if (!["running", "awaiting_approval"].includes(run.status)) throw new StorageError("invalid_transition");
  }

  private unresolved(runId: string): boolean {
    return this.listRequestAttempts(runId).some((request) => !finalRequests.includes(request.status))
      || this.listToolExecutions(runId).some((tool) => !finalTools.includes(tool.status));
  }

  listRuns(sessionId?: string): Run[] {
    return this.rows(runs, sessionId === undefined ? "" : "WHERE session_id = ?", sessionId === undefined ? [] : [sessionId], "ORDER BY created_at, id");
  }

  loadRun(id: string): Run | null { return this.get(runs, id); }

  createRun(input: CreateRunInput): Run {
    return this.write(() => {
      exact(input, runFields.filter((field) => !["revision", "ownerId", "leaseToken", "leaseExpiresAt"].includes(field)), "invalid_run");
      const createdAt = input.createdAt ?? now();
      const run = readRun({ ...input, id: input.id ?? randomUUID(), revision: 0, status: input.status ?? "running", createdAt, updatedAt: input.updatedAt ?? createdAt });
      if (run.status !== "running") throw new StorageError("invalid_transition");
      const session = this.database.query<{ project: string }, [string]>("SELECT project FROM sessions WHERE id = ?").get(run.sessionId);
      if (!session || session.project !== run.project) throw new StorageError("record_conflict");
      return this.insert(runs, run);
    });
  }

  beginRun(input: CreateRunInput, ownerId: string, leaseMs: number): Run {
    return this.write(() => {
      const run = this.createRun(input);
      return this.acquire(run, ownerId, leaseMs, run.revision);
    });
  }

  updateRun(input: Run, lease?: RunLease): Run {
    return this.write(() => {
      const next = readRun(input), current = this.requireRun(next.id);
      this.owned(current, lease);
       immutable(current, next, ["sessionId", "project", "model", "createdAt", "updatedAt", "ownerId", "leaseToken", "leaseExpiresAt", "requestLimit", "toolLimit"]);
       if (current.metadata !== undefined || this.listRequestAttempts(current.id).length) immutable(current, next, ["metadata"]);
      transition(current.status, next.status, {
        running: ["running", "awaiting_approval", "completed", "failed", "interrupted", "recovery_required"],
        awaiting_approval: ["running", "failed", "interrupted", "recovery_required"],
        recovery_required: ["running", "failed", "interrupted"], interrupted: ["running"], completed: [], failed: ["running"],
      });
      if ((["completed", "failed", "interrupted"].includes(next.status)
        || current.status === "recovery_required" || current.status === "interrupted" || current.status === "failed") && this.unresolved(current.id)) {
        throw new StorageError("recovery_required");
      }
      return this.replace(runs, current, { ...next, updatedAt: tick(current.updatedAt) });
    });
  }

  private leaseExpiry(leaseMs: number): string {
    if (!integer(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new StorageError("lease_conflict");
    return new Date(Date.now() + leaseMs).toISOString();
  }

  private acquire(current: Run, ownerId: string, leaseMs: number, expectedRevision: number): Run {
    revision(current.revision, expectedRevision);
    if (!label(ownerId) || (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.now())
      || current.status === "completed") throw new StorageError("lease_conflict");
    // The immediate transaction makes this check and acquisition atomic across connections.
    // Ownership belongs to a conversation; independent conversations can share a folder.
    if (this.database.query(`SELECT 1 FROM runs WHERE session_id = ? AND id != ?
      AND (owner_id IS NOT NULL OR status = 'recovery_required') LIMIT 1`).get(current.sessionId, current.id)) {
      throw new StorageError("lease_conflict");
    }
    return this.replace(runs, current, {
      ...current, ownerId, leaseToken: randomUUID(), leaseExpiresAt: this.leaseExpiry(leaseMs), updatedAt: tick(current.updatedAt),
    });
  }

  acquireRunLease(runId: string, ownerId: string, leaseMs: number, expectedRevision: number): Run {
    return this.write(() => {
      const current = this.requireRun(runId);
      // An expired owner or unfinished intent must pass through explicit recovery, even for the same owner id.
      if (current.ownerId || current.status === "recovery_required" || this.unresolved(runId)) {
        if (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.now()) throw new StorageError("lease_conflict");
        throw new StorageError("recovery_required");
      }
      return this.acquire(current, ownerId, leaseMs, expectedRevision);
    });
  }

  renewRunLease(runId: string, lease: RunLease, leaseMs: number, expectedRevision: number, confirmLiveOwner?: () => true): Run {
    return this.write(() => {
      const current = this.requireRun(runId);
      this.owned(current, lease, typeof confirmLiveOwner === "function");
      revision(current.revision, expectedRevision);
      if (Date.parse(current.leaseExpiresAt!) <= Date.now()) {
        // Only the original live executor may bridge a delayed heartbeat. The
        // independent workspace/session fence is checked under this write lock;
        // recovery or a changed token/revision always wins over a stale executor.
        if (!["running", "awaiting_approval"].includes(current.status)
          || !confirmLiveOwner || confirmLiveOwner() !== true) throw new StorageError("lease_conflict");
      }
      return this.replace(runs, current, { ...current,
        leaseExpiresAt: new Date(Math.max(Date.parse(current.leaseExpiresAt!), Date.parse(this.leaseExpiry(leaseMs)))).toISOString(),
        updatedAt: tick(current.updatedAt),
      });
    });
  }

  releaseRunLease(runId: string, lease: RunLease, expectedRevision: number): boolean {
    return this.write(() => {
      const current = this.loadRun(runId);
      if (!current) return false;
      this.owned(current, lease);
      revision(current.revision, expectedRevision);
      if (this.unresolved(runId) && current.status !== "recovery_required") throw new StorageError("recovery_required");
      this.replace(runs, current, { ...current, ownerId: undefined, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: tick(current.updatedAt) });
      return true;
    });
  }

  recoverRun(runId: string, ownerId: string, leaseMs: number, expectedRevision: number): Run {
    return this.write(() => {
      const current = this.requireRun(runId);
      if (["completed", "failed"].includes(current.status)) {
        revision(current.revision, expectedRevision);
        if (!label(ownerId) || (current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.now())) throw new StorageError("lease_conflict");
        if (this.unresolved(runId)) throw new StorageError("recovery_required");
        return this.replace(runs, current, { ...current, ownerId: undefined, leaseToken: undefined, leaseExpiresAt: undefined, updatedAt: tick(current.updatedAt) });
      }
      const owned = this.acquire(current, ownerId, leaseMs, expectedRevision);
      for (const request of this.listRequestAttempts(runId)) {
        if (!finalRequests.includes(request.status)) this.replace(requests, request, readRequest({ ...request, status: "interrupted", completedAt: now(request.startedAt) }));
      }
      for (const tool of this.listToolExecutions(runId)) {
        if (tool.status === "executing") this.replace(tools, tool, readTool({ ...tool, activity: undefined, status: "outcome_unknown", updatedAt: tick(tool.updatedAt, tool.createdAt, tool.startedAt) }));
        else if (["proposed", "awaiting_approval", "approved"].includes(tool.status)) {
          const completedAt = now(tool.createdAt, tool.updatedAt, tool.startedAt);
          this.replace(tools, tool, readTool({ ...tool, activity: undefined, status: "cancelled", approvalDecision: undefined,
            result: { reason: "recovery_cancelled" }, completedAt, updatedAt: tick(tool.updatedAt, completedAt) }));
        }
      }
      const status = this.listToolExecutions(runId).some((tool) => tool.status === "outcome_unknown") ? "recovery_required" : "interrupted";
      return this.replace(runs, owned, { ...owned, status, updatedAt: tick(owned.updatedAt) });
    });
  }

  /** Explicit new-prompt handoff only. Preserve every unknown tool; never make it retryable. */
  parkBrowserRun(runId:string, expectedRevision:number, confirmStopped:()=>void):Run {
    return this.write(()=>{
      const run=this.requireRun(runId);revision(run.revision,expectedRevision);
      if(run.status!=='recovery_required'||(run.leaseExpiresAt&&Date.parse(run.leaseExpiresAt)>Date.now()))throw new StorageError('lease_conflict');
      if(!onlyUnknownBrowserActions(this.listToolExecutions(runId))||this.listRequestAttempts(runId).some(row=>!finalRequests.includes(row.status)))throw new StorageError('recovery_required');
      if(!run.metadata||typeof run.metadata!=='object'||Array.isArray(run.metadata))throw new StorageError('invalid_run');
      confirmStopped();
      return this.replace(runs,run,{...run,status:'failed',ownerId:undefined,leaseToken:undefined,leaseExpiresAt:undefined,
        metadata:{...run.metadata,browserRecoveryParked:true},updatedAt:tick(run.updatedAt)});
    });
  }

  listRequestAttempts(runId: string): RequestAttempt[] {
    return this.rows(requests, "WHERE run_id = ?", [runId], "ORDER BY sequence, id");
  }

  loadRequestAttempt(id: string): RequestAttempt | null { return this.get(requests, id); }

  createRequestAttempt(input: CreateRequestAttemptInput): RequestAttempt {
    return this.write(() => {
      exact(input, [...requestFields.filter((field) => field !== "revision"), "lease"], "invalid_request");
      const { lease, ...data } = input;
      const request = readRequest({ ...data, id: data.id ?? randomUUID(), revision: 0, status: data.status ?? "pending" });
      const run = this.requireRun(request.runId);
      this.owned(run, lease);
      if (run.status !== "running" || request.status !== "pending") throw new StorageError("invalid_transition");
      const previous = this.listRequestAttempts(run.id);
      if (previous.some((item) => item.sequence === request.sequence)) throw new StorageError("record_conflict");
      if (this.unresolved(run.id)) throw new StorageError("recovery_required");
      if (request.sequence !== previous.length || (run.requestLimit !== undefined && previous.length >= run.requestLimit)) throw new StorageError("invalid_transition");
      return this.insert(requests, request);
    });
  }

  updateRequestAttempt(input: RequestAttempt, lease?: RunLease): RequestAttempt {
    return this.write(() => this.saveRequestAttempt(input, lease));
  }

  private saveRequestAttempt(input: RequestAttempt, lease?: RunLease): RequestAttempt {
      const next = readRequest(input), current = this.loadRequestAttempt(next.id);
      if (!current) throw new StorageError("record_conflict");
      const run = this.requireRun(current.runId);
      this.owned(run, lease);
      this.active(run);
       immutable(current, next, ["runId", "sequence", "model", "context", "contextRef"]);
       if ((next.output?.receivedBytes ?? 0) < (current.output?.receivedBytes ?? 0)) throw new StorageError("record_conflict");
      if (current.startedAt !== undefined) immutable(current, next, ["startedAt"]);
      transition(current.status, next.status, requestTransitions);
      return this.replace(requests, current, next);
  }

  transitionRequestAttempt(id: string, status: RequestAttemptStatus, patch: RequestAttemptPatch, lease?: RunLease): RequestAttempt {
    return this.write(() => {
      exact(patch, ["revision", "status", "model", "context", "contextRef", "usage", "startedAt", "completedAt", "error", "output"], "invalid_request");
      if (patch.status !== undefined && patch.status !== status) throw new StorageError("invalid_transition");
      const current = this.loadRequestAttempt(id);
      if (!current) throw new StorageError("record_conflict");
      revision(current.revision, patch.revision);
      return this.saveRequestAttempt({ ...current, ...patch, status,
        ...(status === "streaming" && current.startedAt === undefined && patch.startedAt === undefined ? { startedAt: now() } : {}),
        ...(finalRequests.includes(status) && patch.completedAt === undefined ? { completedAt: now(current.startedAt, patch.startedAt) } : {}),
      }, lease);
    });
  }

  listToolExecutions(runId: string, requestId?: string): ToolExecution[] {
    return this.rows(tools, `WHERE run_id = ?${requestId === undefined ? "" : " AND request_id = ?"}`,
      requestId === undefined ? [runId] : [runId, requestId], "ORDER BY sequence, id");
  }

  loadToolExecution(id: string): ToolExecution | null { return this.get(tools, id); }

  createToolExecution(input: CreateToolExecutionInput): ToolExecution {
    return this.write(() => {
      exact(input, [...toolFields.filter((field) => field !== "revision"), "lease"], "invalid_tool");
      const { lease, ...data } = input;
      const createdAt = data.createdAt ?? now();
      const tool = readTool({ ...data, id: data.id ?? randomUUID(), revision: 0, status: data.status ?? "proposed", createdAt, updatedAt: data.updatedAt ?? createdAt });
      const run = this.requireRun(tool.runId);
      this.owned(run, lease);
      this.active(run);
      const request = this.loadRequestAttempt(tool.requestId);
      if (!request || request.runId !== run.id) throw new StorageError("record_conflict");
      // Proposals are durably staged while validating a streaming response. Only completing the
      // request publishes them for approval/execution and prevents a continuation racing their insert.
      if (request.status !== "streaming" || tool.status !== "proposed") throw new StorageError("invalid_transition");
      const previous = this.listToolExecutions(run.id);
      if (previous.some((item) => item.sequence === tool.sequence || (item.requestId === tool.requestId && item.callId === tool.callId))) throw new StorageError("record_conflict");
      if (tool.sequence !== previous.length || (run.toolLimit !== undefined && previous.length >= run.toolLimit)) throw new StorageError("invalid_transition");
      return this.insert(tools, tool);
    });
  }

  updateToolExecution(input: ToolExecution, lease?: RunLease): ToolExecution {
    return this.write(() => this.saveToolExecution(input, lease));
  }

  private saveToolExecution(input: ToolExecution, lease?: RunLease): ToolExecution {
      input = { ...input, activity: summarizeActivity(input) };
      const next = readTool(input), current = this.loadToolExecution(next.id);
      if (!current) throw new StorageError("record_conflict");
      const run = this.requireRun(current.runId);
      this.owned(run, lease);
      const recoveryWrite = run.status === "recovery_required" && (current.status === "outcome_unknown"
        || (next.status === "cancelled" && ["proposed", "awaiting_approval", "approved"].includes(current.status)));
      if (!recoveryWrite) this.active(run);
      immutable(current, next, ["runId", "requestId", "sequence", "callId", "name", "args", "schemaVersion", "precondition", "createdAt", "updatedAt"]);
      if (current.startedAt !== undefined) immutable(current, next, ["startedAt"]);
      if (current.approvalScope !== undefined) immutable(current, next, ["approvalScope"]);
      if (current.approvalDecision !== undefined) immutable(current, next, ["approvalDecision"]);
      transition(current.status, next.status, toolTransitions);
      const request = this.loadRequestAttempt(current.requestId);
      if (!request || request.runId !== run.id) throw new StorageError("invalid_tool");
      if (request.status !== "completed" && next.status !== "cancelled") throw new StorageError("invalid_transition");
      if (next.status === "executing") {
        if (run.status !== "running" || this.listToolExecutions(run.id).some((tool) => tool.sequence < current.sequence && !finalTools.includes(tool.status))) {
          throw new StorageError("invalid_transition");
        }
      }
      const saved = this.replace(tools, current, { ...next, updatedAt: tick(current.updatedAt, next.createdAt, next.startedAt, next.completedAt) });
      if (next.status === "outcome_unknown") this.replace(runs, run, { ...run, status: "recovery_required", updatedAt: tick(run.updatedAt) });
      return saved;
  }

  transitionToolExecution(id: string, status: ToolExecutionStatus, patch: ToolExecutionPatch, lease?: RunLease): ToolExecution {
    return this.write(() => {
      exact(patch, ["revision", "status", "approvalScope", "approvalDecision", "precondition", "result", "outputArtifactRef", "startedAt", "completedAt", "error"], "invalid_tool");
      if (patch.status !== undefined && patch.status !== status) throw new StorageError("invalid_transition");
      const current = this.loadToolExecution(id);
      if (!current) throw new StorageError("record_conflict");
      revision(current.revision, patch.revision);
      return this.saveToolExecution({ ...current, ...patch, status,
        ...(status === "executing" && current.startedAt === undefined && patch.startedAt === undefined ? { startedAt: now(current.createdAt, current.updatedAt) } : {}),
        ...(finalTools.includes(status) && patch.completedAt === undefined ? { completedAt: now(current.createdAt, current.updatedAt, current.startedAt, patch.startedAt) } : {}),
      }, lease);
    });
  }
}
