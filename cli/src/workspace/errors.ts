const messages = {
  invalid_path: "invalid project-relative path.",
  outside_workspace: "path is outside the workspace.",
  protected_path: "this path requires a host access grant.",
  unsafe_link: "linked paths are not supported.",
  path_changed: "the filesystem path changed.",
  not_found: "the requested file was not found.",
  not_file: "a regular file is required.",
  not_directory: "a directory is required.",
  invalid_input: "invalid workspace input.",
  binary_file: "only valid utf8 text files are supported.",
  file_limit: "the file exceeds the workspace size limit.",
  output_limit: "the prepared output exceeds the size limit.",
  unsafe_data: "content could not be retained safely.",
  unsupported_pattern: "this search pattern is not supported.",
  conflict: "contents or metadata changed; read the current file hash and prepare a new change.",
  invalid_change: "invalid prepared change.",
  ambiguous_change: "the text matches multiple locations; include unique surrounding text or use an exact line patch.",
  match_not_found: "the exact text was not found; read the file again and include its current text and hash.",
  invalid_patch: "patch hunks must be ordered, nonoverlapping whole-line edits using original 1-based line numbers.",
  patch_mismatch: "patch text does not match the original lines; read the file and prepare fresh hunks and hash.",
  directory_not_empty: "the directory contains unreviewed entries; inspect them and prepare a new change.",
  artifact_corrupt: "the artifact failed integrity validation.",
  artifact_location: "artifacts must use a separate directory outside the project.",
  already_started: "this change has already started; inspect its journal before compensation.",
  journal_failed: "the effect outcome could not be recorded; inspect the journal and files.",
  lease_conflict: "workspace ownership could not be established.",
  lease_lost: "workspace ownership was lost.",
  recovery_required: "explicit offline lock cleanup is required.",
  aborted: "the workspace operation was interrupted.",
  io_error: "the filesystem operation failed.",
  access_denied: "the operating system denied file access; check account permissions and whether another program has locked the file.",
} as const;

export type WorkspaceErrorCode = keyof typeof messages;
export interface PatchDiagnostic {
  hunkIndex: number; startLine: number; newline: "lf" | "crlf" | "mixed" | "none";
  reason: "text_mismatch" | "whole_lines_required";
}
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, readonly detail?: PatchDiagnostic) {
    super(messages[code]);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
export function fail(code: WorkspaceErrorCode): never { throw new WorkspaceError(code); }
export function safeError(error: unknown): WorkspaceError {
  if (error && typeof error === "object" && "code" in error && ["EACCES", "EPERM"].includes(String(error.code))) return new WorkspaceError("access_denied");
  return error instanceof WorkspaceError ? error : new WorkspaceError("io_error");
}
export function safely<T>(fn: () => T): T {
  try { return fn(); } catch (error) { throw safeError(error); }
}
export function aborted(signal?: AbortSignal): void { if (signal?.aborted) fail("aborted"); }
export function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
