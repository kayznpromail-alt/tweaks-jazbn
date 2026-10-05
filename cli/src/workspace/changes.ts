import { randomUUID } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { digest } from "../agent/data";
import type { JsonValue } from "../types";
import { ArtifactStore, artifactLimit } from "./artifacts";
import { aborted, fail, missing, safeError, safely, type WorkspaceErrorCode } from "./errors";
import { identity, projectPath, type AccessGrant, type WorkspacePaths } from "./paths";
import { hashText, lines, readImage, retainable, validText, workspaceLimits, type FileImage } from "./text";
import { patchExact, replaceExact, type PatchHunk } from "./edits";
import { EXECUTABLE_ARGUMENT_BYTES } from "../api/limits";
import { WorkspaceLeaseManager, type WorkspaceLease } from "./ownership";

export type ChangeOperation =
  | { type: "create"; path: string; content: string }
  | { type: "mkdir"; path: string }
  | { type: "update"; path: string; expectedHash: string; content: string }
  | { type: "replace"; path: string; expectedHash: string; oldText: string; newText: string }
  | { type: "patch"; path: string; expectedHash: string; hunks: PatchHunk[] }
  | { type: "delete"; path: string; expectedHash: string }
  | { type: "move"; path: string; to: string; expectedHash: string };
export interface PreparedFile {
  path: string;
  parentIdentity: string;
  before: FileImage | null;
  after: { text: string; hash: string; mode: number } | null;
  kind?: "file" | "directory";
  directory?: { before: { identity: string; mode: number } | null; after: { mode: number } | null };
}
export interface ChangeSummary { path: string; action: "create" | "update" | "delete" | "mkdir" | "rmdir"; added: number; removed: number }
export interface PreparedChange {
  version: 1 | 2;
  changeId: string;
  project: string;
  projectIdentity: string;
  createdAt: string;
  inverseOf: string | null;
  files: PreparedFile[];
  diff: string;
  summary: ChangeSummary[];
  digest: string;
}
export interface ChangeReview {
  changeId: string; digest: string; artifactId: string; diff: string; summary: ChangeSummary[];
}
export interface ChangeJournal {
  version: 1; changeId: string; digest: string;
  state: "applying" | "applied" | "partial" | "failed";
  files: { path: string; state: "pending" | "executing" | "applied" | "failed" | "outcome_unknown"; error: WorkspaceErrorCode | null; directoryIdentity?: string }[];
}
export interface ApplyResult {
  ok: boolean;
  changeId: string; digest: string; artifactId: string; status: ChangeJournal["state"];
  summary: ChangeSummary[];
  files: ChangeJournal["files"]; compensation: "none" | "explicit_undo_required";
}
export interface ChangeOptions {
  signal?: AbortSignal;
  grant?: AccessGrant;
  /** Trusted host hook, e.g. a held workspace lease check, called immediately before each effect. */
  beforeEffect?: () => void | Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const stamp = /^\d+:\d+$/;
const maxPreparedEntries = 192;
const parentPath = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
const createdParent = (path: string) => `created:${path.toLowerCase()}`;
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail("invalid_change");
}
export function validateOperations(input: unknown): asserts input is ChangeOperation[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > workspaceLimits.changes
    || Reflect.ownKeys(input).length !== input.length + 1) fail("invalid_change");
  try {
    if (Buffer.byteLength(JSON.stringify({ operations: input })) > EXECUTABLE_ARGUMENT_BYTES) fail("invalid_change");
  } catch { fail("invalid_change"); }
  const used = new Set<string>();
  for (const op of input) {
    if (!op || typeof op !== "object") fail("invalid_change");
    const fields = op.type === "create" ? ["type", "path", "content"] : op.type === "mkdir" ? ["type", "path"] : op.type === "update" ? ["type", "path", "expectedHash", "content"]
      : op.type === "replace" ? ["type", "path", "expectedHash", "oldText", "newText"]
      : op.type === "patch" ? ["type", "path", "expectedHash", "hunks"]
      : op.type === "delete" ? ["type", "path", "expectedHash"] : op.type === "move" ? ["type", "path", "to", "expectedHash"] : null;
    if (!fields) fail("invalid_change");
    object(op, fields);
    for (const name of op.type === "move" ? [op.path, op.to] : [op.path]) {
      if (typeof name !== "string") fail("invalid_change");
      const path = projectPath(name), key = path.toLowerCase();
      if (path.split("/").some((part) => part.toLowerCase().startsWith(".edgey-"))) fail("protected_path");
      if (used.has(key)) fail("invalid_change");
      used.add(key);
    }
    if (op.type !== "create" && op.type !== "mkdir" && (typeof op.expectedHash !== "string" || !hash.test(op.expectedHash))) fail("invalid_change");
    if (op.type === "create" || op.type === "update") validText(op.content, EXECUTABLE_ARGUMENT_BYTES);
    if (op.type === "replace") {
      validText(op.oldText, EXECUTABLE_ARGUMENT_BYTES); validText(op.newText, EXECUTABLE_ARGUMENT_BYTES);
      if (!op.oldText || op.oldText === op.newText) fail("invalid_change");
    }
    if (op.type === "patch") {
      if (!Array.isArray(op.hunks) || !op.hunks.length || op.hunks.length > 128
        || Reflect.ownKeys(op.hunks).length !== op.hunks.length + 1) fail("invalid_patch");
      for (const hunk of op.hunks) {
        object(hunk, ["startLine", "oldText", "newText"]);
        if (typeof hunk.startLine !== "number" || !Number.isSafeInteger(hunk.startLine) || hunk.startLine < 1) fail("invalid_patch");
        validText(hunk.oldText, EXECUTABLE_ARGUMENT_BYTES); validText(hunk.newText, EXECUTABLE_ARGUMENT_BYTES);
        if (hunk.oldText === hunk.newText) fail("invalid_patch");
      }
    }
  }
}
function fileDiff(file: PreparedFile, compact = false): string {
  if (file.kind === "directory") return `${file.directory!.after ? "mkdir" : "rmdir"} ${JSON.stringify(file.path)}\n`;
  const a = file.before ? lines(file.before.text) : [], b = file.after ? lines(file.after.text) : [];
  const name = (prefix: string) => JSON.stringify(`${prefix}/${file.path}`);
  const header = `diff --git ${name("a")} ${name("b")}\n`
    + (!file.before ? `new file mode ${file.after!.mode & 0o111 ? "100755" : "100644"}\n` : !file.after ? `deleted file mode ${file.before.mode & 0o111 ? "100755" : "100644"}\n` : "")
    + `--- ${file.before ? name("a") : "/dev/null"}\n+++ ${file.after ? name("b") : "/dev/null"}\n`;
  if (!a.length && !b.length) return header;
  const render = (items: string[], prefix: string) => items.map((line) => `${prefix}${line}${line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`).join("");
  if (!compact) return header + `@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n` + render(a, "-") + render(b, "+");
  // Linear scan with bounded lookahead; unmatched regions remain exact replacements.
  const edits: { a: number; b: number; removed: string[]; added: string[] }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    const startA = i, startB = j;
    do {
      let da = -1, db = -1;
      for (let n = 1; n <= 64; n++) {
        if (j < b.length && i + n < a.length && a[i + n] === b[j]) { da = n; break; }
        if (i < a.length && j + n < b.length && b[j + n] === a[i]) { db = n; break; }
      }
      if (da >= 0) i += da;
      else if (db >= 0) j += db;
      else { if (i < a.length) i++; if (j < b.length) j++; }
    } while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j]));
    edits.push({ a: startA, b: startB, removed: a.slice(startA, i), added: b.slice(startB, j) });
  }
  return header + edits.map((edit) => `@@ -${edit.a + (edit.removed.length ? 1 : 0)},${edit.removed.length} +${edit.b + (edit.added.length ? 1 : 0)},${edit.added.length} @@\n`
    + render(edit.removed, "-") + render(edit.added, "+")).join("");
}
function description(files: PreparedFile[], compact = true, legacyCounts = false): { diff: string; summary: ChangeSummary[] } {
  const diffs = files.map((file) => fileDiff(file, compact));
  const count = (diff: string, prefix: string) => {
    const source = diff.split("\n");
    if (legacyCounts) return source.filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix.repeat(3)} `)).length;
    const hunk = source.findIndex((line) => line.startsWith("@@ "));
    return hunk < 0 ? 0 : source.slice(hunk).filter((line) => line.startsWith(prefix)).length;
  };
  return { diff: diffs.join(""), summary: files.map((file, i) => ({ path: file.path,
    action: file.kind === "directory" ? file.directory!.after ? "mkdir" : "rmdir" : !file.before ? "create" : !file.after ? "delete" : "update",
    added: file.kind === "directory" ? 0 : count(diffs[i], "+"),
    removed: file.kind === "directory" ? 0 : count(diffs[i], "-") })) };
}
function comparable(image: FileImage | null, expected: FileImage | null): boolean {
  return image === null ? expected === null : expected !== null && image.hash === expected.hash && image.identity === expected.identity && image.mode === expected.mode;
}
function beforeMatches(image: FileImage | null, before: FileImage | null): boolean {
  return image === null ? before === null : before !== null && image.hash === before.hash && image.mode === before.mode;
}
function afterMatches(image: FileImage | null, after: PreparedFile["after"]): boolean {
  return image === null ? after === null : after !== null && image.hash === after.hash && image.mode === after.mode;
}

export class ChangeEngine {
  private readonly artifacts: ArtifactStore;
  constructor(private readonly paths: WorkspacePaths, private readonly artifactDir: string, private readonly secrets: readonly string[] = []) {
    this.artifacts = new ArtifactStore(artifactDir, paths.root);
  }
  private parent(path: string, grant?: AccessGrant): string {
    const stat = this.paths.resolve(parentPath(path), { allowRoot: true, grant }).stat;
    if (!stat?.isDirectory()) fail("not_directory");
    return identity(stat);
  }
  private plannedParent(path: string, files: readonly PreparedFile[], grant?: AccessGrant): string {
    const parent = files.find((file) => file.path.toLowerCase() === parentPath(path).toLowerCase() && file.directory?.after);
    return parent ? createdParent(parent.path) : this.parent(path, grant);
  }
  private file(path: string, before: PreparedFile["before"], after: PreparedFile["after"], grant?: AccessGrant, files: readonly PreparedFile[] = []): PreparedFile {
    return { path, parentIdentity: this.plannedParent(path, files, grant), before, after, kind: "file" };
  }
  private prepareDirectory(path: string, files: PreparedFile[], grant?: AccessGrant): void {
    if (path === ".") return;
    const planned = files.find((file) => file.path.toLowerCase() === path.toLowerCase());
    if (planned) { if (!planned.directory?.after) fail("invalid_change"); return; }
    const target = this.paths.resolve(path, { allowMissing: true, grant });
    if (target.stat) { if (!target.stat.isDirectory()) fail("not_directory"); return; }
    this.prepareDirectory(parentPath(path), files, grant);
    if (files.length >= maxPreparedEntries) fail("invalid_change");
    files.push({ path, parentIdentity: this.plannedParent(path, files, grant), before: null, after: null, kind: "directory",
      directory: { before: null, after: { mode: process.platform === "win32" ? 0o666 : 0o755 & ~process.umask() } } });
  }
  private record(files: PreparedFile[], inverseOf: string | null = null): PreparedChange {
    const display = description(files);
    if (Buffer.byteLength(display.diff) > workspaceLimits.changeBytes) fail("output_limit");
    const content = { version: 2 as const, changeId: randomUUID(), project: this.paths.root,
      projectIdentity: identity(this.paths.resolve(".", { allowRoot: true }).stat!),
      createdAt: new Date().toISOString(), inverseOf, files, ...display };
    if (!files.length || files.length > maxPreparedEntries) fail("invalid_change");
    retainable(content, this.secrets, artifactLimit - 1024);
    const record = { ...content, digest: digest(content as unknown as JsonValue) };
    this.artifacts.create(`${record.changeId}.prepared.json`, record as unknown as JsonValue);
    return record;
  }
  prepareChanges(operations: readonly ChangeOperation[], options: ChangeOptions = {}): ChangeReview {
    return safely(() => {
      aborted(options.signal);
      validateOperations(operations);
      retainable(operations, this.secrets);
      const files: PreparedFile[] = [];
      // Expand all missing parents before file effects; preparation itself never mkdirs.
      for (const op of operations) {
        const path = projectPath(op.type === "move" ? op.to : op.path);
        if (op.type === "mkdir") {
          if (this.paths.resolve(path, { allowMissing: true, grant: options.grant }).stat) fail("conflict");
          this.prepareDirectory(path, files, options.grant);
        } else if (op.type === "create" || op.type === "move") this.prepareDirectory(parentPath(path), files, options.grant);
      }
      for (const op of operations) {
        aborted(options.signal);
        if (op.type === "mkdir") continue;
        const path = projectPath(op.path), before = readImage(this.paths, path, options.grant);
        if (files.some((file) => file.path.toLowerCase() === path.toLowerCase())) fail("invalid_change");
        if (op.type === "create") {
          if (before) fail("conflict");
          files.push(this.file(path, null, { text: op.content, hash: hashText(op.content), mode: process.platform === "win32" ? 0o666 : 0o644 }, options.grant, files));
        } else {
          if (!before || before.hash !== op.expectedHash) fail("conflict");
          if (op.type === "update" || op.type === "replace" || op.type === "patch") {
            const content = op.type === "update" ? op.content : op.type === "replace"
              ? replaceExact(before.text, op.oldText, op.newText) : patchExact(before.text, op.hunks);
            if (content === before.text) fail("invalid_change");
            files.push(this.file(path, before, { text: content, hash: hashText(content), mode: before.mode }, options.grant, files));
          } else if (op.type === "delete") files.push(this.file(path, before, null, options.grant, files));
          else {
            const to = projectPath(op.to);
            if (files.some((file) => file.path.toLowerCase() === to.toLowerCase())) fail("invalid_change");
            if (readImage(this.paths, to, options.grant)) fail("conflict");
            files.push(this.file(to, null, { text: before.text, hash: before.hash, mode: before.mode }, options.grant, files), this.file(path, before, null, options.grant, files));
          }
        }
      }
      return this.review(this.record(files));
    });
  }
  private review(record: PreparedChange): ChangeReview {
    return { changeId: record.changeId, digest: record.digest, artifactId: `change:${record.changeId}`, diff: record.diff, summary: record.summary };
  }
  getPrepared(changeId: string, expectedDigest: string): PreparedChange {
    return safely(() => {
      if (!uuid.test(changeId) || !hash.test(expectedDigest)) fail("invalid_change");
      const value = this.artifacts.read(`${changeId}.prepared.json`);
      object(value, ["version", "changeId", "project", "projectIdentity", "createdAt", "inverseOf", "files", "diff", "summary", "digest"]);
      const record = value as unknown as PreparedChange;
      if (![1, 2].includes(record.version) || record.changeId !== changeId || record.digest !== expectedDigest || record.project !== this.paths.root
        || record.projectIdentity !== identity(this.paths.resolve(".", { allowRoot: true }).stat!)
        || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
        || (record.inverseOf !== null && !uuid.test(record.inverseOf)) || !Array.isArray(record.files)
        || record.files.length === 0 || record.files.length > maxPreparedEntries) fail("artifact_corrupt");
      const { digest: recordedDigest, ...body } = record;
      if (digest(body as unknown as JsonValue) !== recordedDigest) fail("artifact_corrupt");
      const seen = new Set<string>();
      const directories = new Set<string>();
      for (const file of record.files) {
        if (!file || typeof file !== "object" || Array.isArray(file)) fail("artifact_corrupt");
        object(file, ["path", "parentIdentity", "before", "after", ...(file.kind !== undefined ? ["kind"] : []), ...(file.kind === "directory" ? ["directory"] : [])]);
        if (typeof file.path !== "string" || projectPath(file.path) !== file.path || seen.has(file.path.toLowerCase())) fail("artifact_corrupt");
        if (typeof file.parentIdentity !== "string" || (!stamp.test(file.parentIdentity)
          && !(record.version === 2 && file.parentIdentity === createdParent(parentPath(file.path)) && directories.has(file.parentIdentity)))) fail("artifact_corrupt");
        seen.add(file.path.toLowerCase());
        if (file.kind !== "file" && file.kind !== "directory" && !(record.version === 1 && file.kind === undefined)) fail("artifact_corrupt");
        if (file.kind === "directory") {
          if (record.version !== 2 || file.before !== null || file.after !== null || !file.directory) fail("artifact_corrupt");
          object(file.directory, ["before", "after"]);
          for (const [kind, value] of [["before", file.directory.before], ["after", file.directory.after]] as const) {
            if (value === null) continue;
            object(value, kind === "before" ? ["identity", "mode"] : ["mode"]);
            if (!Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777) fail("artifact_corrupt");
            if (kind === "before" && !stamp.test((value as { identity: string }).identity)) fail("artifact_corrupt");
          }
          if ((file.directory.before === null) === (file.directory.after === null)) fail("artifact_corrupt");
          if (file.directory.after) directories.add(createdParent(file.path));
          continue;
        }
        for (const [kind, image] of [["before", file.before], ["after", file.after]] as const) {
          if (image === null) continue;
          object(image, kind === "before" ? ["text", "hash", "identity", "mode", "bytes"] : ["text", "hash", "mode"]);
          validText(image.text);
          if (image.hash !== hashText(image.text) || !Number.isInteger(image.mode) || image.mode < 0 || image.mode > 0o777) fail("artifact_corrupt");
          if (kind === "before") {
            const before = image as FileImage;
            if (typeof before.identity !== "string" || !/^\d+:\d+$/.test(before.identity) || before.bytes !== Buffer.byteLength(before.text)) fail("artifact_corrupt");
          }
        }
        if ((!file.before && !file.after) || (file.before && file.after && file.before.hash === file.after.hash)) fail("artifact_corrupt");
      }
      const displays = record.version === 1 ? [description(record.files, false, true), description(record.files, true, true)] : [description(record.files)];
      if (!displays.some((display) => display.diff === record.diff && digest(display.summary as unknown as JsonValue) === digest(record.summary as unknown as JsonValue))) fail("artifact_corrupt");
      retainable(record, this.secrets, artifactLimit - 1024);
      return record;
    });
  }
  getChangeReview(changeId: string, expectedDigest: string): ChangeReview { return this.review(this.getPrepared(changeId, expectedDigest)); }
  inspectChange(changeId: string, expectedDigest: string): { review: ChangeReview; journal: ChangeJournal | null } {
    const record = this.getPrepared(changeId, expectedDigest);
    const filename = `${changeId}.journal.json`;
    if (!this.artifacts.exists(filename)) return { review: this.review(record), journal: null };
    const value = this.artifacts.read(filename);
    object(value, ["version", "changeId", "digest", "state", "files"]);
    const journal = value as unknown as ChangeJournal;
    if (journal.version !== 1 || journal.changeId !== changeId || journal.digest !== expectedDigest
      || !["applying", "applied", "partial", "failed"].includes(journal.state) || !Array.isArray(journal.files)
      || journal.files.length !== record.files.length) fail("artifact_corrupt");
    journal.files.forEach((file, i) => {
      object(file, file.directoryIdentity !== undefined ? ["path", "state", "error", "directoryIdentity"] : ["path", "state", "error"]);
      if (file.path !== record.files[i].path || !["pending", "executing", "applied", "failed", "outcome_unknown"].includes(file.state)
        || (file.error !== null && (typeof file.error !== "string" || !/^[a-z_]+$/.test(file.error)))) fail("artifact_corrupt");
      if (file.directoryIdentity !== undefined && (typeof file.directoryIdentity !== "string" || !stamp.test(file.directoryIdentity) || !record.files[i].directory?.after)) fail("artifact_corrupt");
    });
    return { review: this.review(record), journal };
  }
  private bindParent(file: PreparedFile, record: PreparedChange, journal: ChangeJournal, grant?: AccessGrant): PreparedFile {
    // Check every newly created ancestor, not just the immediate parent.
    for (let i = 0; i < record.files.length; i++) {
      const ancestor = record.files[i];
      if (!ancestor.directory?.after || !file.path.toLowerCase().startsWith(`${ancestor.path.toLowerCase()}/`)) continue;
      const current = this.paths.resolve(ancestor.path, { grant }).stat;
      if (!current?.isDirectory() || !journal.files[i].directoryIdentity || identity(current) !== journal.files[i].directoryIdentity) fail("conflict");
    }
    if (!file.parentIdentity.startsWith("created:")) return file;
    const entry = journal.files.find((entry) => createdParent(entry.path) === file.parentIdentity);
    if (!entry?.directoryIdentity) fail("conflict");
    return { ...file, parentIdentity: entry.directoryIdentity };
  }
  private emptyDirectory(file: PreparedFile, grant?: AccessGrant, removals: readonly PreparedFile[] = []): void {
    const target = this.paths.resolve(file.path, { grant });
    const directory = opendirSync(target.absolute);
    try {
      let child;
      while ((child = directory.readSync())) {
        const path = `${file.path}/${child.name}`;
        if (!removals.some((item) => item.path === path && (item.directory ? item.directory.after === null : item.after === null))) fail("directory_not_empty");
      }
    } finally { directory.closeSync(); }
    const current = this.paths.resolve(file.path, { grant }).stat;
    if (!current || identity(current) !== identity(target.stat!)) fail("conflict");
  }
  private revalidate(file: PreparedFile, grant?: AccessGrant, initial = false, removals: readonly PreparedFile[] = []): void {
    if (initial && file.parentIdentity.startsWith("created:")) {
      if (this.paths.resolve(file.path, { allowMissing: true, grant }).stat) fail("conflict");
      return;
    }
    if (this.parent(file.path, grant) !== file.parentIdentity) fail("conflict");
    if (file.directory) {
      const stat = this.paths.resolve(file.path, { allowMissing: true, grant }).stat;
      const before = file.directory.before;
      if (before ? !stat?.isDirectory() || identity(stat) !== before.identity || (stat.mode & 0o777) !== before.mode : stat !== null) fail("conflict");
      if (before) this.emptyDirectory(file, grant, removals);
    } else if (!comparable(readImage(this.paths, file.path, grant), file.before)) fail("conflict");
  }
  private directoryMatches(file: PreparedFile, after: boolean, grant?: AccessGrant, createdIdentity?: string): boolean {
    if (this.parent(file.path, grant) !== file.parentIdentity) return false;
    const expected = after ? file.directory!.after : file.directory!.before;
    const stat = this.paths.resolve(file.path, { allowMissing: true, grant }).stat;
    if (!expected) return stat === null;
    const expectedIdentity = after ? createdIdentity : file.directory!.before!.identity;
    return !!stat?.isDirectory() && expectedIdentity !== undefined && identity(stat) === expectedIdentity && (stat.mode & 0o777) === expected.mode;
  }
  private write(file: PreparedFile, options: ChangeOptions): string | null {
    this.revalidate(file, options.grant);
    if (file.kind === "directory") {
      const directory = file.directory!;
      const target = this.paths.resolve(file.path, { allowMissing: true, grant: options.grant });
      aborted(options.signal);
      if (directory.after) {
        mkdirSync(target.absolute, { mode: directory.after.mode });
        return identity(this.paths.resolve(file.path, { grant: options.grant }).stat!);
      } else {
        rmdirSync(target.absolute);
      }
      return null;
    }
    const target = this.paths.resolve(file.path, { allowMissing: true, grant: options.grant });
    if (file.after === null) { aborted(options.signal); this.revalidate(file, options.grant); unlinkSync(target.absolute); return null; }
    const parentPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
    const parent = this.paths.resolve(parentPath, { allowRoot: true, grant: options.grant });
    if (!parent.stat?.isDirectory()) fail("not_directory");
    const tmp = join(dirname(target.absolute), `.edgey-${randomUUID()}.tmp`);
    let tmpIdentity: string | null = null;
    try {
      const fd = openSync(tmp, "wx", 0o600);
      try {
        tmpIdentity = identity(lstatSync(tmp));
        writeFileSync(fd, file.after.text, "utf8");
        fchmodSync(fd, file.after.mode);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      aborted(options.signal);
      this.revalidate(file, options.grant);
      const currentParent = this.paths.resolve(parentPath, { allowRoot: true, grant: options.grant });
      if (!currentParent.stat || identity(currentParent.stat) !== identity(parent.stat)) fail("path_changed");
      const currentTmp = lstatSync(tmp);
      if (!currentTmp.isFile() || currentTmp.isSymbolicLink() || currentTmp.nlink !== 1 || identity(currentTmp) !== tmpIdentity) fail("path_changed");
      renameSync(tmp, target.absolute);
      return null;
    } finally {
      // Never remove a replacement or anything outside this exact temporary file's parent.
      const currentParent = this.paths.resolve(parentPath, { allowRoot: true, grant: options.grant });
      if (currentParent.stat && identity(currentParent.stat) === identity(parent.stat)) {
        try { const stat = lstatSync(tmp); if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && identity(stat) === tmpIdentity) unlinkSync(tmp); }
        catch (error) { if (!missing(error)) throw error; }
      }
    }
  }
  async applyChanges(changeId: string, expectedDigest: string, options: ChangeOptions = {}): Promise<ApplyResult> {
    const ownership=new WorkspaceLeaseManager(this.artifactDir,"file-mutations");
    const signal=options.signal??new AbortController().signal;
    let mutation:WorkspaceLease|undefined;
    try {
      const deadline=Date.now()+30000;
      while(!mutation){
        aborted(signal);
        try{mutation=await ownership.acquire({project:this.paths.root,runId:changeId,ownerId:`change-${randomUUID()}`,signal});}
        catch(error){
          if(safeError(error).code!=="lease_conflict"||Date.now()>=deadline)throw error;
          try{
            const lock=ownership.inspect(this.paths.root);
            if(lock)ownership.recoverStale({project:this.paths.root,token:lock.token,confirmedStopped:true});
          }catch(stale){if(!["recovery_required","lease_lost","lease_conflict"].includes(safeError(stale).code))throw stale;}
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }
      aborted(options.signal);
      const record = this.getPrepared(changeId, expectedDigest);
      if (this.artifacts.exists(`${changeId}.journal.json`)) fail("already_started");
      // All preconditions checked before the first write, then again immediately per file.
      for (const file of record.files) this.revalidate(file, options.grant, true, record.files);
      const journal: ChangeJournal = { version: 1, changeId, digest: expectedDigest, state: "applying",
        files: record.files.map((file) => ({ path: file.path, state: "pending", error: null })) };
      this.artifacts.create(`${changeId}.journal.json`, journal as unknown as JsonValue);
      const save = () => { try { this.artifacts.replace(`${changeId}.journal.json`, journal as unknown as JsonValue); } catch { fail("journal_failed"); } };
      for (let i = 0; i < record.files.length; i++) {
        const entry = journal.files[i];
        let file = record.files[i];
        try {
          aborted(options.signal);
          file = this.bindParent(file, record, journal, options.grant);
          await options.beforeEffect?.();
          aborted(options.signal);
          file = this.bindParent(file, record, journal, options.grant);
          this.revalidate(file, options.grant);
          entry.state = "executing"; save();
          const directoryIdentity = this.write(file, options);
          if (directoryIdentity) { entry.directoryIdentity = directoryIdentity; save(); }
          const postcondition = file.directory ? this.directoryMatches(file, true, options.grant, entry.directoryIdentity)
            : afterMatches(readImage(this.paths, file.path, options.grant), file.after);
          if (!postcondition) fail("conflict");
          entry.state = "applied"; save();
        } catch (error) {
          if (safeError(error).code === "journal_failed") throw error;
          // Even a failed syscall can have an observable effect: reconcile exact bytes, never rollback silently.
          try {
            const current = file.directory ? null : readImage(this.paths, file.path, options.grant);
            const after = file.directory ? this.directoryMatches(file, true, options.grant, entry.directoryIdentity) : afterMatches(current, file.after);
            const before = file.directory ? this.directoryMatches(file, false, options.grant) : comparable(current, file.before);
            entry.state = after ? "applied" : before ? "failed" : "outcome_unknown";
          } catch { entry.state = "outcome_unknown"; }
          entry.error = safeError(error).code;
          journal.state = journal.files.some((item) => item.state === "applied" || item.state === "outcome_unknown") ? "partial" : "failed";
          save();
          return { ok: false, changeId, digest: expectedDigest, artifactId: `change:${changeId}`, status: journal.state, summary: record.summary,
            files: journal.files, compensation: journal.state === "partial" ? "explicit_undo_required" : "none" };
        }
      }
      journal.state = "applied"; save();
      return { ok: true, changeId, digest: expectedDigest, artifactId: `change:${changeId}`, status: "applied", summary: record.summary, files: journal.files, compensation: "none" };
    } catch (error) { throw safeError(error); }
    finally { mutation?.release(); }
  }
  private inverse(changeId: string, expectedDigest: string, options: ChangeOptions): PreparedFile[] {
    aborted(options.signal);
    const record = this.getPrepared(changeId, expectedDigest), { journal } = this.inspectChange(changeId, expectedDigest);
    if (!journal) fail("invalid_change");
    const files: PreparedFile[] = [];
    for (let i = record.files.length - 1; i >= 0; i--) {
      let file = record.files[i];
      const entry = journal.files[i], state = entry.state;
      if (state === "pending" || state === "failed") continue;
      // An absent original creation is already compensated; do not bind its now-absent parent.
      if (!file.before && !file.directory?.before && !this.paths.resolve(file.path, { allowMissing: true, grant: options.grant }).stat) continue;
      const restoredParent = files.some((item) => item.directory?.after && item.path.toLowerCase() === parentPath(file.path).toLowerCase());
      if (restoredParent) {
        if (this.paths.resolve(file.path, { allowMissing: true, grant: options.grant }).stat) fail("conflict");
        file = { ...file, parentIdentity: createdParent(parentPath(file.path)) };
      } else file = this.bindParent(file, record, journal, options.grant);
      if (file.directory) {
        if (!restoredParent && this.directoryMatches(file, false, options.grant)) continue;
        if (!restoredParent && !this.directoryMatches(file, true, options.grant, entry.directoryIdentity)) fail("conflict");
        if (file.directory.after) {
          files.push({ path: file.path, parentIdentity: file.parentIdentity, before: null, after: null, kind: "directory",
            directory: { before: { identity: entry.directoryIdentity!, mode: file.directory.after.mode }, after: null } });
        } else {
          files.push({ path: file.path, parentIdentity: this.plannedParent(file.path, files, options.grant), before: null, after: null, kind: "directory",
            directory: { before: null, after: { mode: file.directory.before!.mode } } });
        }
        continue;
      }
      const current = readImage(this.paths, file.path, options.grant);
      // Repeated compensation only skips bytes already restored; it never replays the original edit.
      if (beforeMatches(current, file.before)) continue;
      if ((state === "executing" || state === "outcome_unknown") && comparable(current, file.before)) continue;
      if (!afterMatches(current, file.after)) fail("conflict");
      if (!restoredParent && this.parent(file.path, options.grant) !== file.parentIdentity) fail("conflict");
      files.push(this.file(file.path, current, file.before ? { text: file.before.text, hash: file.before.hash, mode: file.before.mode } : null, options.grant, files));
    }
    if (!files.length) fail("invalid_change");
    for (const file of files) if (file.directory?.before) this.emptyDirectory(file, options.grant, files);
    return files;
  }
  getUndoReview(changeId: string, expectedDigest: string, options: ChangeOptions = {}): ChangeReview {
    const files = this.inverse(changeId, expectedDigest, options);
    return { changeId, digest: expectedDigest, artifactId: `change:${changeId}`, ...description(files) };
  }
  prepareUndo(changeId: string, expectedDigest: string, options: ChangeOptions = {}): ChangeReview {
    return this.review(this.record(this.inverse(changeId, expectedDigest, options), changeId));
  }
  async undoChanges(changeId: string, expectedDigest: string, options: ChangeOptions = {}): Promise<ApplyResult> {
    const inverse = this.prepareUndo(changeId, expectedDigest, options);
    return this.applyChanges(inverse.changeId, inverse.digest, options);
  }
}
