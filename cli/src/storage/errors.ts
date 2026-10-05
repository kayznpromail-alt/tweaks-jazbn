const errors = {
  open_failed: "could not open the local database.",
  schema_version: "unsupported local database version.",
  backup_failed: "could not verify the local database backup. migration was not performed.",
  closed: "the local database is closed.",
  read_failed: "could not read the local database.",
  write_failed: "could not write to the local database.",
  invalid_settings: "invalid settings format.",
  invalid_session: "invalid session format.",
  session_conflict: "the session was changed or deleted. reload it before saving.",
  invalid_run: "invalid run record.",
  invalid_request: "invalid request attempt record.",
  invalid_tool: "invalid tool execution record.",
  record_conflict: "the execution record changed or already exists. reload it before saving.",
  lease_conflict: "the run ownership lease is missing, expired or held by another owner.",
  invalid_transition: "the execution transition is not allowed.",
  recovery_required: "the run requires explicit recovery before continuing.",
} as const;

export type StorageErrorCode = keyof typeof errors;
const nativeCodes = new Set(['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_READONLY','SQLITE_FULL','SQLITE_IOERR','SQLITE_CORRUPT','SQLITE_NOTADB','SQLITE_CONSTRAINT','SQLITE_CONSTRAINT_FOREIGNKEY','SQLITE_CONSTRAINT_UNIQUE','EACCES','EPERM','ENOSPC']);

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly nativeCode?: string;

  constructor(code: StorageErrorCode, nativeCode?: unknown) {
    const safeCode = Object.hasOwn(errors, code) ? code : "write_failed";
    super(errors[safeCode]);
    this.name = "StorageError";
    this.code = safeCode;
    if (typeof nativeCode === 'string' && nativeCodes.has(nativeCode)) this.nativeCode = nativeCode;
  }
}

export function safely<T>(code: StorageErrorCode, action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(code, error && typeof error === 'object' && 'code' in error ? error.code : undefined);
  }
}
