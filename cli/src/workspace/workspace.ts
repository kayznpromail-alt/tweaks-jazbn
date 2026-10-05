import { opendirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { ChangeEngine, type ChangeOptions, type ChangeOperation, type ApplyResult, type ChangeReview } from "./changes";
import { aborted, fail, safely, WorkspaceError } from "./errors";
import { projectPath, protectedPath, WorkspacePaths, type AccessGrant } from "./paths";
import { WorkspaceIgnore } from "./ignore";
import { globMatcher, textMatcher } from "./patterns";
import { boundedText, integer, lines, newline, readImage, retainable, workspaceLimits } from "./text";

export interface WorkspaceOptions { root: string; artifactDir: string; secrets?: readonly string[]; allowProtectedFiles?: boolean }
export interface ReadOptions { startLine?: number; limit?: number; maxBytes?: number; signal?: AbortSignal; grant?: AccessGrant }
export interface FileRead {
  path: string; hash: string; encoding: "utf8"; bom: boolean; newline: "lf" | "crlf" | "mixed" | "none";
  bytes: number; startLine: number; endLine: number; totalLines: number; content: string;
  nextLine: number | null; truncated: boolean; partialLine: boolean;
}
export interface ListOptions { path?: string; offset?: number; limit?: number; includeIgnored?: boolean; signal?: AbortSignal }
export interface FileEntry { path: string; type: "file" | "directory" }
export interface FileList { entries: FileEntry[]; nextOffset: number | null; truncated: boolean; scanned: number }
export interface GlobOptions extends ListOptions { pattern: string; /** Host-only base for a relative pattern. */ patternBase?: string }
export interface SearchOptions extends GlobOptions { query: string; regex?: boolean; caseSensitive?: boolean }
export interface SearchResult {
  matches: { path: string; hash: string; line: number; column: number; text: string; truncated: boolean }[];
  nextOffset: number | null; truncated: boolean; scannedFiles: number; skippedFiles: number;
  status: "matches" | "no_matches" | "incomplete";
}
export interface InstructionSource { path: string; scope: string; hash: string; content: string }
export interface InstructionResult { sources: InstructionSource[]; content: string; truncated: boolean }
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Bounded, project-only filesystem services. Methods do not interpret file text as permission.
 * Standard Node APIs cannot close every adversarial rename race; use OS isolation for that boundary. */
export class Workspace {
  readonly root: string;
  readonly paths: WorkspacePaths;
  private readonly changes: ChangeEngine;
  private readonly secrets: readonly string[];
  constructor(options: WorkspaceOptions);
  constructor(root: string, options: Omit<WorkspaceOptions, "root">);
  constructor(input: WorkspaceOptions | string, options?: Omit<WorkspaceOptions, "root">) {
    const settings = typeof input === "string" ? { ...options!, root: input } : input;
    this.paths = new WorkspacePaths(settings.root, settings.allowProtectedFiles);
    this.root = this.paths.root;
    this.secrets = [...(settings.secrets ?? [])];
    this.changes = new ChangeEngine(this.paths, settings.artifactDir, this.secrets);
  }
  private entries(path: string, ignore: WorkspaceIgnore, signal?: AbortSignal): { entries: FileEntry[]; truncated: boolean; scanned: number } {
    return safely(() => {
      aborted(signal);
      const target = this.paths.resolve(path, { allowRoot: true });
      if (!target.stat?.isDirectory()) fail("not_directory");
      retainable(path, this.secrets);
      if (path.split("/").some((part) => part.startsWith(".edgey-")) || !ignore.enter(path)) return { entries: [], truncated: false, scanned: 0 };
      const directory = opendirSync(target.absolute), entries: FileEntry[] = [];
      let scanned = 0, truncated = false;
      try {
        let entry;
        while ((entry = directory.readSync())) {
          aborted(signal);
          if (++scanned > workspaceLimits.directoryEntries) { truncated = true; break; }
          const child = path === "." ? entry.name : `${path}/${entry.name}`;
          try { projectPath(child); } catch { continue; }
          try { retainable(child, this.secrets); } catch { continue; }
          if (entry.name.startsWith(".edgey-") || (!this.paths.allowProtectedFiles && protectedPath(child)) || entry.name.toLowerCase() === ".git") continue;
          if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue;
          let type: FileEntry["type"] | undefined;
          try {
            const resolved = this.paths.resolve(child);
            if (resolved.stat?.isFile() || resolved.stat?.isDirectory()) type = resolved.stat.isDirectory() ? "directory" : "file";
          } catch (error) {
            if (!(error instanceof WorkspaceError) || !["unsafe_link", "outside_workspace", "not_found", "path_changed"].includes(error.code)) throw error;
          }
          // Ignore configuration failures must propagate, not enter the child-link skip.
          if (type && !ignore.ignored(child, type === "directory")) entries.push({ path: child, type });
        }
      } finally { directory.closeSync(); }
      this.paths.resolve(path, { allowRoot: true });
      // A capped directory never exposes a filesystem-order-dependent subset.
      return { entries: truncated ? [] : entries.sort((a, b) => order(a.path, b.path)), truncated, scanned };
    });
  }
  list(options: ListOptions = {}): FileList {
    const offset = integer(options.offset, 0, 0, workspaceLimits.entries), limit = integer(options.limit, 100, 1, workspaceLimits.pageEntries);
    const ignore = new WorkspaceIgnore(this.paths, options.includeIgnored === true, options.signal);
    const result = this.entries(projectPath(options.path ?? ".", true), ignore, options.signal);
    let bytes = 0;
    const entries: FileEntry[] = [];
    for (const entry of result.entries.slice(offset, offset + limit)) {
      bytes += Buffer.byteLength(JSON.stringify(entry));
      if (bytes > workspaceLimits.outputBytes) break;
      entries.push(entry);
    }
    const more = offset + entries.length < result.entries.length;
    return { entries, nextOffset: more ? offset + entries.length : null, truncated: result.truncated || more, scanned: result.scanned };
  }
  private walk(options: ListOptions): { files: string[]; truncated: boolean; scanned: number } {
    const pending = [projectPath(options.path ?? ".", true)], files: string[] = [];
    const ignore = new WorkspaceIgnore(this.paths, options.includeIgnored === true, options.signal);
    let scanned = 0, truncated = false;
    const deadline = performance.now() + workspaceLimits.searchMs;
    while (pending.length) {
      aborted(options.signal);
      if (scanned >= workspaceLimits.entries || performance.now() > deadline) { truncated = true; break; }
      const directory = pending.pop()!, result = this.entries(directory, ignore, options.signal);
      scanned += result.scanned;
      truncated ||= result.truncated;
      for (const entry of [...result.entries].reverse()) {
        if (entry.type === "directory") pending.push(entry.path); else files.push(entry.path);
      }
    }
    return { files: files.sort(order), truncated, scanned };
  }
  private patternMatcher(options: GlobOptions): (path: string) => boolean {
    const matcher = globMatcher(options.pattern), base = projectPath(options.patternBase ?? ".", true);
    if (base === ".") return matcher;
    const prefix = `${base}/`;
    return path => path.startsWith(prefix) && matcher(path.slice(prefix.length));
  }
  glob(options: GlobOptions): { paths: string[]; nextOffset: number | null; truncated: boolean; scanned: number } {
    const matcher = this.patternMatcher(options), walk = this.walk(options);
    const offset = integer(options.offset, 0, 0, workspaceLimits.entries), limit = integer(options.limit, 100, 1, workspaceLimits.pageEntries);
    const all: string[] = [], paths: string[] = [], deadline = performance.now() + workspaceLimits.searchMs;
    for (const path of walk.files) {
      aborted(options.signal);
      if (performance.now() > deadline) { walk.truncated = true; break; }
      if (matcher(path)) all.push(path);
    }
    let bytes = 0;
    for (const path of all.slice(offset, offset + limit)) {
      bytes += Buffer.byteLength(JSON.stringify(path));
      if (bytes > workspaceLimits.outputBytes) break;
      paths.push(path);
    }
    const more = offset + paths.length < all.length;
    return { paths, nextOffset: more ? offset + paths.length : null, truncated: walk.truncated || more, scanned: walk.scanned };
  }
  read(path: string, options: ReadOptions = {}): FileRead {
    return safely(() => {
      aborted(options.signal);
      const startLine = integer(options.startLine, 1, 1, 1_000_001), limit = integer(options.limit, 200, 1, 2000);
      const maxBytes = integer(options.maxBytes, 32 * 1024, 4, workspaceLimits.outputBytes);
      const image = readImage(this.paths, path, options.grant);
      if (!image) fail("not_found");
      retainable(image.text, this.secrets);
      const source = lines(image.text), selected: string[] = [];
      let bytes = 0, partialLine = false;
      for (let i = startLine - 1; i < Math.min(source.length, startLine - 1 + limit); i++) {
        const line = source[i], length = Buffer.byteLength(line);
        if (bytes + length > maxBytes) {
          if (!selected.length) { selected.push(boundedText(line, maxBytes)); partialLine = true; }
          break;
        }
        selected.push(line); bytes += length;
      }
      const endLine = startLine + selected.length - 1, more = endLine < source.length;
      return { path: projectPath(path), hash: image.hash, encoding: "utf8", bom: image.text.startsWith("\ufeff"), newline: newline(image.text),
        bytes: image.bytes, startLine, endLine, totalLines: source.length, content: selected.join(""),
        nextLine: partialLine ? null : more ? endLine + 1 : null, truncated: partialLine || more, partialLine };
    });
  }
  search(options: SearchOptions): SearchResult {
    return safely(() => {
      const matcher = textMatcher(options.query, options.regex === true, options.caseSensitive !== false), glob = this.patternMatcher(options);
      const offset = integer(options.offset, 0, 0, 100_000), limit = integer(options.limit, 100, 1, 500);
      const walk = this.walk(options), matches: SearchResult["matches"] = [];
      let scannedFiles = 0, skippedFiles = 0, inputBytes = 0, outputBytes = 0, seen = 0, more = false, truncated = walk.truncated;
      const deadline = performance.now() + workspaceLimits.searchMs;
      outer: for (const path of walk.files) {
        aborted(options.signal);
        if (performance.now() > deadline || inputBytes >= workspaceLimits.searchBytes) { truncated = true; break; }
        if (!glob(path)) continue;
        try {
          const image = readImage(this.paths, path);
          if (!image) { skippedFiles++; continue; }
          inputBytes += image.bytes; scannedFiles++;
          if (inputBytes > workspaceLimits.searchBytes) { truncated = true; break; }
          retainable(image.text, this.secrets);
          const source = lines(image.text);
          for (let i = 0; i < source.length; i++) {
            if ((i & 127) === 0) { aborted(options.signal); if (performance.now() > deadline) { truncated = true; break outer; } }
            const text = source[i].replace(/\r?\n$/, ""), index = matcher(text);
            if (index < 0) continue;
            if (seen++ < offset) continue;
            if (matches.length === limit || outputBytes > workspaceLimits.outputBytes - 4096) { more = true; break outer; }
            const excerpt = boundedText(text, 1024);
            matches.push({ path, hash: image.hash, line: i + 1, column: [...text.slice(0, index)].length + 1, text: excerpt, truncated: excerpt !== text });
            outputBytes += Buffer.byteLength(excerpt) + Buffer.byteLength(path) + 128;
          }
        } catch (error) {
          if (error instanceof WorkspaceError && ["binary_file", "file_limit", "unsafe_data", "not_found", "path_changed", "unsafe_link"].includes(error.code)) skippedFiles++;
          else throw error;
        }
      }
      truncated ||= more;
      return { matches, nextOffset: more ? offset + matches.length : null, truncated, scannedFiles, skippedFiles,
        status: matches.length ? "matches" : truncated || skippedFiles ? "incomplete" : "no_matches" };
    });
  }
  instructions(targets: readonly string[] = ["."], options: { signal?: AbortSignal; ignore?: readonly string[] } = {}): InstructionResult {
    return safely(() => {
      if (!Array.isArray(targets) || targets.length > 64) fail("invalid_input");
      const candidates = new Set<string>(["AGENTS.md"]), ignored = new Set((options.ignore ?? []).map((path) => projectPath(path)));
      for (const target of targets) {
        const path = projectPath(target, true), resolved = this.paths.resolve(path, { allowRoot: true, allowMissing: true });
        const parts = path === "." ? [] : path.split("/");
        if (!resolved.stat?.isDirectory()) parts.pop();
        for (let i = 1; i <= parts.length; i++) candidates.add(`${parts.slice(0, i).join("/")}/AGENTS.md`);
      }
      const sources: InstructionSource[] = [];
      let bytes = 0, truncated = false;
      for (const path of [...candidates].sort((a, b) => a.split("/").length - b.split("/").length || order(a, b))) {
        aborted(options.signal);
        if (ignored.has(path)) continue;
        const image = readImage(this.paths, path);
        if (!image) continue;
        retainable(image.text, this.secrets);
        const scope = path === "AGENTS.md" ? "." : path.slice(0, -"/AGENTS.md".length);
        const header = `project instructions: ${path} (scope: ${scope}; sha256: ${image.hash})\n`;
        if (bytes + image.bytes + Buffer.byteLength(header) + 2 > workspaceLimits.instructionBytes) { truncated = true; break; }
        sources.push({ path, scope, hash: image.hash, content: image.text });
        bytes += image.bytes + Buffer.byteLength(header) + 2;
      }
      return { sources, content: sources.map((source) => `project instructions: ${source.path} (scope: ${source.scope}; sha256: ${source.hash})\n${source.content}`).join("\n\n"), truncated };
    });
  }
  readAttachments(attachments: readonly ({ path: string } & ReadOptions)[]): { files: FileRead[]; truncated: boolean } {
    if (!Array.isArray(attachments) || attachments.length > 32) fail("invalid_input");
    const files: FileRead[] = [], seen = new Set<string>();
    let bytes = 0, truncated = false;
    for (const attachment of attachments) {
      const path = projectPath(attachment.path), key = `${path}:${attachment.startLine ?? 1}:${attachment.limit ?? 200}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = this.read(path, attachment);
      if (bytes + Buffer.byteLength(file.content) > workspaceLimits.outputBytes) { truncated = true; break; }
      bytes += Buffer.byteLength(file.content); files.push(file); truncated ||= file.truncated;
    }
    return { files, truncated };
  }
  prepareChanges(operations: readonly ChangeOperation[], options?: ChangeOptions): ChangeReview { return this.changes.prepareChanges(operations, options); }
  applyChanges(changeId: string, digest: string, options?: ChangeOptions): Promise<ApplyResult> { return this.changes.applyChanges(changeId, digest, options); }
  undoChanges(changeId: string, digest: string, options?: ChangeOptions): Promise<ApplyResult> { return this.changes.undoChanges(changeId, digest, options); }
  prepareUndo(changeId: string, digest: string, options?: ChangeOptions): ChangeReview { return this.changes.prepareUndo(changeId, digest, options); }
  getChangeReview(changeId: string, digest: string): ChangeReview { return this.changes.getChangeReview(changeId, digest); }
  getUndoReview(changeId: string, digest: string, options?: ChangeOptions): ChangeReview { return this.changes.getUndoReview(changeId, digest, options); }
  inspectChange(changeId: string, digest: string): ReturnType<ChangeEngine["inspectChange"]> { return this.changes.inspectChange(changeId, digest); }
}
