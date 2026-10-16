import { validateImages } from "../media/images";
import { Database } from "bun:sqlite";
import { readContextUsage } from "../agent/context-usage";
import {readPrivateMode} from "../api/private-mode";
import {composeInstructions} from "../instructions/selection";
import type { Profile } from "../types";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeBaseUrl } from "../api/url";
import type { Message, Session, SessionSummary, Settings, Store, Usage } from "../types";
import { ExecutionStore, createExecutionSchema, upgradeExecutionV3, upgradeExecutionV4, validateExecutionSchema } from "./execution";
import { createClientGuards, createLegacySchema, validateLegacySchema } from "./schema";
import { backupBeforeMigration } from "./migration-backup";
import { StorageError, safely } from "./errors";
import { readTranscriptPage } from "./transcript";
export { StorageError, type StorageErrorCode } from "./errors";

const schemaVersion = 7;

function object(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((field) => fields.includes(field));
}

function label(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readSettings(value: unknown): Settings {
  if (!object(value, ["baseUrl", "model", "favorites", "lastProject", "recentModels"]) || !label(value.baseUrl)
    || !(value.model === null || label(value.model)) || !Array.isArray(value.favorites)
    || !Array.from(value.favorites).every(label)
    || (value.lastProject !== undefined && !label(value.lastProject))
    || (value.recentModels !== undefined && (!Array.isArray(value.recentModels)
      || !Array.from(value.recentModels).every(label)))) {
    throw new StorageError("invalid_settings");
  }
  return {
    baseUrl: safely("invalid_settings", () => normalizeBaseUrl(value.baseUrl as string)),
    model: value.model,
    favorites: [...value.favorites],
    ...(value.lastProject !== undefined ? { lastProject: value.lastProject as string } : {}),
    ...(value.recentModels !== undefined ? { recentModels: [...value.recentModels as string[]] } : {}),
  };
}

function readMessage(value: unknown): Message {
  if (!object(value, ["id", "role", "content", "status", "createdAt", "model", "profile", "usage", "privateMode", "requestedMode", "instructionVersion", "failure", "context", "images", "imagePositions"])
    || !label(value.id) || !["user", "assistant"].includes(value.role as string)
    || typeof value.content !== "string" || !timestamp(value.createdAt)
    || !["streaming", "complete", "interrupted", "error"].includes(value.status as string)
    || (value.model !== undefined && !label(value.model))
    || (value.context !== undefined && (value.role !== "assistant"
      || !object(value.context, ["usedBytes", "maxBytes", "method", "full", "outputTokens", "exhaustedBy", "model", "inputTokens", "windowTokens", "windowSource"]) || !readContextUsage(value.context)))
    || (value.failure !== undefined && (value.role !== "assistant" || typeof value.failure !== "string" || value.failure.length > 8192))) {
    throw new StorageError("invalid_session");
  }
  let profile: Message["profile"];
  if (value.profile !== undefined) {
    if (!object(value.profile, ["id", "version"]) || !label(value.profile.id) || !label(value.profile.version)) {
      throw new StorageError("invalid_session");
    }
    profile = { id: value.profile.id, version: value.profile.version };
  }
  let usage: Usage | undefined;
  if (value.usage !== undefined) {
    if (!object(value.usage, ["inputTokens", "outputTokens", "totalTokens", "totalSource", "cachedInputTokens"])
      || !count(value.usage.inputTokens) || !count(value.usage.outputTokens) || !count(value.usage.totalTokens)
      || (value.usage.totalSource !== undefined && value.usage.totalSource !== "reported" && value.usage.totalSource !== "calculated")) {
      throw new StorageError("invalid_session");
    }
    if (value.usage.totalSource === "calculated"
      && BigInt(value.usage.totalTokens) !== BigInt(value.usage.inputTokens) + BigInt(value.usage.outputTokens)) {
      throw new StorageError("invalid_session");
    }
    if (value.usage.cachedInputTokens !== undefined
      && (!count(value.usage.cachedInputTokens) || value.usage.cachedInputTokens > value.usage.inputTokens)) {
      throw new StorageError("invalid_session");
    }
    usage = {
      inputTokens: value.usage.inputTokens,
      outputTokens: value.usage.outputTokens,
      totalTokens: value.usage.totalTokens,
      ...(value.usage.totalSource !== undefined ? { totalSource: value.usage.totalSource } : {}),
      ...(value.usage.cachedInputTokens !== undefined ? { cachedInputTokens: value.usage.cachedInputTokens } : {}),
    };
  }
  return {
    id: value.id, role: value.role as Message["role"], content: value.content,
    ...(value.imagePositions === undefined ? {} : {imagePositions:safely("invalid_session",()=>{if(!Array.isArray(value.imagePositions)||!Array.isArray(value.images)||value.imagePositions.length!==value.images.length||!value.imagePositions.every(p=>Number.isSafeInteger(p)&&p>=0&&p<(value.content as string).length))throw new Error();return value.imagePositions as number[];})}),
    ...(value.images === undefined ? {} : {images:safely("invalid_session",()=>{if(value.role!=="user")throw new Error();return validateImages(value.images);})}),
    status: value.status as Message["status"], createdAt: value.createdAt,
    ...(value.context === undefined ? {} : { context: readContextUsage(value.context) }),
    ...(typeof value.failure === "string" ? { failure: value.failure } : {}),
    ...(value.model !== undefined ? { model: value.model as string } : {}),
    ...(value.privateMode ? {privateMode:readPrivateMode(value.privateMode)} : {}),
    ...(value.requestedMode ? {requestedMode:readPrivateMode(value.requestedMode)} : {}),
    ...(typeof value.instructionVersion==="string" ? {instructionVersion:value.instructionVersion} : {}),
    ...(profile ? { profile } : {}), ...(usage ? { usage } : {}),
  };
}

function readSession(value: unknown): Session {
  if (!object(value, ["id", "project", "title", "model", "createdAt", "updatedAt", "revision", "messages", "privateMode", "instructionSources"])
    || !label(value.id) || !label(value.project) || typeof value.title !== "string" || !label(value.model)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !count(value.revision)
    || !Array.isArray(value.messages)) {
    throw new StorageError("invalid_session");
  }
  if(value.instructionSources!==undefined){if(!Array.isArray(value.instructionSources)||value.instructionSources.length>128)throw new StorageError("invalid_session");
    for(const source of value.instructionSources){if(!object(source,["id","name","path","hash","content","kind"])||!label(source.id)||!label(source.name)||!label(source.path)||typeof source.content!=="string"||typeof source.hash!=="string"||!/[a-f0-9]{64}/.test(source.hash)||!["markdown","skill"].includes(source.kind as string))throw new StorageError("invalid_session");}
    composeInstructions(value.instructionSources as import("../instructions/selection").InstructionSelection[]);}
  const messages = Array.from(value.messages, readMessage);
  if (new Set(messages.map((message) => message.id)).size !== messages.length) throw new StorageError("invalid_session");
  return {
    id: value.id, project: value.project, title: value.title, model: value.model,
    createdAt: value.createdAt, updatedAt: value.updatedAt, revision: value.revision, messages,
    ...(value.privateMode ? {privateMode:readPrivateMode(value.privateMode)} : {}),
    ...(value.instructionSources ? {instructionSources:structuredClone(value.instructionSources as import("../instructions/selection").InstructionSelection[])} : {}),
  };
}

type SessionRow = Omit<Session, "messages" | "privateMode" | "instructionSources"> & {messages:string;privateMode?:string|null;instructionSources?:string|null};
const sessionColumns = "id, project, title, model, created_at AS createdAt, updated_at AS updatedAt, revision, messages";

export class LocalStore extends ExecutionStore implements Store {
  #database: Database | null = null;
  readonly migrationBackupPath: string | undefined;

  constructor(filename: string) {
    super();
    let database: Database | undefined;
    try {
      if (typeof filename !== "string" || !filename.trim()) throw new StorageError("open_failed");
      if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
      database = new Database(filename, { create: true, strict: true });
      database.run("PRAGMA busy_timeout = 5000");
      const version = database.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
      if (version < 0 || version > schemaVersion) throw new StorageError("schema_version");
      database.run("PRAGMA journal_mode = WAL");
      database.run("PRAGMA synchronous = FULL");
      database.run("PRAGMA foreign_keys = ON");
      this.migrationBackupPath = this.migrate(database, filename);
      this.#database = database;
    } catch (error) {
      database?.close();
      if (error instanceof StorageError) throw error;
      throw new StorageError("open_failed");
    }
  }

  private migrate(database: Database, filename: string): string | undefined {
    return database.transaction(() => {
      // wersję odczytujemy ponownie pod blokadą również przy równoległym starcie.
      const version = database.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
      if (version === schemaVersion) {
        validateExecutionSchema(database);
        return;
      }
      if (version < 0 || version > schemaVersion || (version === 0
        && database.query("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())) {
        throw new StorageError("schema_version");
      }
      if (version === 0) {
        createLegacySchema(database);
      database.query("INSERT INTO settings (id, value) VALUES (1, ?)").run(JSON.stringify({
        baseUrl: "https://api.edgey.shop/v1", model: null, favorites: [],
      } satisfies Settings));
      } else if (version === 1) {
        // Validate without reserializing: legacy JSON bytes, revisions and streaming states stay exact.
        validateLegacySchema(database);
        this.validateLegacyData(database);
      } else {
        validateExecutionSchema(database, version);
      }
      const backupPath = version > 0 ? backupBeforeMigration(database, filename, version, schemaVersion) : undefined;
      if (version < 2) {
        createExecutionSchema(database);
        createClientGuards(database);
      }
      if (version < 3) upgradeExecutionV3(database);
      if (version < 4) upgradeExecutionV4(database);
      if(version<5)database.run("ALTER TABLE sessions ADD COLUMN jailbreak_profile TEXT");
      if (version < 6) {
        database.run("ALTER TABLE sessions ADD COLUMN private_mode TEXT");
        database.run("ALTER TABLE sessions ADD COLUMN instruction_sources TEXT");
        database.run("UPDATE sessions SET jailbreak_profile = NULL");
      }
      validateExecutionSchema(database);
      database.run(`PRAGMA user_version = ${schemaVersion}`);
      return backupPath;
    }).immediate();
  }

  private validateLegacyData(database: Database): void {
    const settings = database.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get();
    // v1 imposed no byte cap on histories/settings. Preserve that accepted domain during migration.
    // New execution records have separate bounded readers; legacy validation remains compatible.
    safely("invalid_settings", () => readSettings(settings ? JSON.parse(settings.value) : null));
    for (const row of database.query<SessionRow, []>(`SELECT ${sessionColumns} FROM sessions`).iterate()) {
      safely("invalid_session", () => readSession({ ...row, messages: JSON.parse(row.messages) }));
    }
  }

  protected get database(): Database {
    if (!this.#database) throw new StorageError("closed");
    return this.#database;
  }

  getSettings(): Settings {
    return safely("read_failed", () => {
      const row = this.database.query<{ value: string }, []>("SELECT value FROM settings WHERE id = 1").get();
      return safely("invalid_settings", () => readSettings(row ? JSON.parse(row.value) : null));
    });
  }

  saveSettings(settings: Settings): void {
    const value = safely("invalid_settings", () => JSON.stringify(readSettings(settings)));
    safely("write_failed", () => this.database.transaction(() => {
      this.database.query("INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(value);
    }).immediate());
  }

  createSession(project: string, model: string): Session {
    const now = new Date(Date.now()).toISOString();
    const session = readSession({
      id: randomUUID(), project, title: "new conversation", model,
      createdAt: now, updatedAt: now, revision: 0, messages: [],
    });
    safely("write_failed", () => this.database.transaction(() => {
      this.database.query(`INSERT INTO sessions (id, project, title, model, created_at, updated_at, revision, messages)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        session.id, project, session.title, model, now, now, session.revision, "[]",
      );
    }).immediate());
    return session;
  }

  loadSession(id: string): Session | null {
    return safely("read_failed", () => {
      const row = this.database.query<SessionRow, [string]>(`SELECT ${sessionColumns}, private_mode AS privateMode, instruction_sources AS instructionSources FROM sessions WHERE id = ?`).get(id);
      // odczyt nie kończy streamingu ani nie wykonuje ukrytego zapisu naprawczego.
      return row ? safely("invalid_session", () => readSession({ ...row, privateMode:row.privateMode?JSON.parse(row.privateMode):undefined,instructionSources:row.instructionSources?JSON.parse(row.instructionSources):undefined, messages: JSON.parse(row.messages) })) : null;
    });
  }

  readTranscriptPage(sessionId:string,offset:number|undefined,filter:import("../core/transcript").TranscriptFilter,limit:number,anchor?:string) {
    return readTranscriptPage(this.database,this,sessionId,offset,filter,limit,anchor);
  }

  listSessions(project: string): SessionSummary[] {
    return safely("read_failed", () => this.database.query<SessionSummary, [string]>(`
      SELECT id, title, model, updated_at AS updatedAt FROM sessions
      WHERE project = ? ORDER BY updated_at DESC, id DESC
    `).all(project).map((row) => {
      if (!label(row.id) || typeof row.title !== "string" || !label(row.model) || !timestamp(row.updatedAt)) {
        throw new StorageError("invalid_session");
      }
      return row;
    }));
  }

  saveSession(session: Session): void {
    const snapshot = safely("invalid_session", () => readSession(session));
    if (snapshot.revision >= Number.MAX_SAFE_INTEGER) throw new StorageError("invalid_session");
    const messages = JSON.stringify(snapshot.messages);
    const updatedAt = safely("write_failed", () => this.database.transaction(() => {
      const current = this.database.query<{ updatedAt: string }, [string, number, string, string]>(`
        SELECT updated_at AS updatedAt FROM sessions WHERE id = ? AND revision = ? AND project = ? AND created_at = ?
      `).get(snapshot.id, snapshot.revision, snapshot.project, snapshot.createdAt);
      if (!current) throw new StorageError("session_conflict");
      if (!timestamp(current.updatedAt)) throw new StorageError("invalid_session");
      const nextTimestamp = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const result = this.database.query(`
        UPDATE sessions SET title = ?, model = ?, messages = ?, updated_at = ?, private_mode = ?, instruction_sources = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(snapshot.title, snapshot.model, messages, nextTimestamp, snapshot.privateMode ? JSON.stringify(snapshot.privateMode) : null, snapshot.instructionSources ? JSON.stringify(snapshot.instructionSources) : null, snapshot.id, snapshot.revision);
      if (result.changes !== 1) throw new StorageError("session_conflict");
      return nextTimestamp;
    }).immediate());
    // obiekt wywołującego zmieniamy dopiero po udanym COMMIT.
    session.updatedAt = updatedAt;
    session.revision = snapshot.revision + 1;
  }

  deleteSession(id: string): boolean {
    if (!label(id)) return false;
    return safely("write_failed", () => this.database.transaction(() => {
      // Legacy sessions retain their deletion behavior; unresolved journals must be recovered first.
      if (this.listRuns(id).some((run) => run.ownerId || !["completed", "failed", "interrupted"].includes(run.status))) {
        throw new StorageError("recovery_required");
      }
      // RETURNING identifies the deleted session independently of cascaded journal row counts.
      return this.database.query("DELETE FROM sessions WHERE id = ? RETURNING id").get(id) !== null;
    }).immediate());
  }

  close(): void {
    if (!this.#database) return;
    safely("write_failed", () => this.#database!.close());
    this.#database = null;
  }
}
