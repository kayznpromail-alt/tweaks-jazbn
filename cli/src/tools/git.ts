import { createHash, randomUUID } from "node:crypto";
import { toolParameters } from "./contracts";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { AgentSanitizer, digest } from "../agent/data";
import { AgentError } from "../agent/errors";
import type { AgentTool, ToolInvocationContext } from "../agent/registry";
import { validateArguments } from "../api/tool-schema";
import { getDataDirectory } from "../storage/paths";
import type { JsonObject, JsonValue, ToolSchema } from "../types";
import { ArtifactStore, readPrivate } from "../workspace/artifacts";
import { contained, identity, pathKey, projectPath, WorkspacePaths } from "../workspace/paths";
import { ProcessManager, PROCESS_LIMITS, type ProcessResult } from "./process";

export interface GitOptions {
  project: string; artifactDir?: string; secrets?: readonly string[];
  /** Passed to every process launch, including later mutations after awaited Git reads. */
  beforeEffect?: () => void;
}
export interface GitStatusEntry { index: string; worktree: string; path: string; originalPath?: string; kind: "ordinary" | "rename" | "unmerged" | "untracked" | "ignored" }
class GitToolError extends Error { constructor(readonly code: string) { super(code.replaceAll("_", " ")); } }
function fail(code: string): never { throw new GitToolError(code); }
const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const sha256 = /^[0-9a-f]{64}$/;
function nulRecords(text: string): string[] {
  if (text === "") return [];
  if (!text.endsWith("\0")) fail("invalid_git_output");
  return text.slice(0, -1).split("\0");
}
function statusPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").some((part) => part === "..") || value.includes("\0")) fail("invalid_git_output");
  return value;
}

/** Git's documented porcelain -z grammar: https://git-scm.com/docs/git-status#_porcelain_format_version_1 */
export function parseGitStatus(text: string, version: 1 | 2 = 1): GitStatusEntry[] {
  const records = nulRecords(text), entries: GitStatusEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (version === 1) {
      if (record.length < 4 || record[2] !== " " || !/^[ MADRCUT?!]{2}$/.test(record.slice(0, 2))) fail("invalid_git_output");
      const xy = record.slice(0, 2);
      if ((xy.includes("?") && xy !== "??") || (xy.includes("!") && xy !== "!!") || xy === "  ") fail("invalid_git_output");
      const entry: GitStatusEntry = { index: xy[0], worktree: xy[1], path: statusPath(record.slice(3)),
        kind: xy === "??" ? "untracked" : xy === "!!" ? "ignored" : /R|C/.test(xy) ? "rename" : /U/.test(xy) || ["AA", "DD"].includes(xy) ? "unmerged" : "ordinary" };
      if (entry.kind === "rename") entry.originalPath = statusPath(records[++i] ?? "");
      entries.push(entry);
    } else {
      if (record.startsWith("? ") || record.startsWith("! ")) {
        entries.push({ index: record[0], worktree: record[0], kind: record[0] === "?" ? "untracked" : "ignored", path: statusPath(record.slice(2)) }); continue;
      }
      // No --branch/--show-stash headers are requested. Reject unknown records rather than guessing.
      const match = /^(1|2|u) ([.MADRCUT]{2}) (N\.\.\.|S[.C][.M][.U]) (.*)$/.exec(record);
      if (!match) fail("invalid_git_output");
      const type = match[1], count = type === "u" ? 7 : type === "2" ? 6 : 5;
      const fields: string[] = [], rest = match[4]; let start = 0;
      for (let n = 0; n < count; n++) {
        const end = rest.indexOf(" ", start);
        if (end < 0) fail("invalid_git_output");
        fields.push(rest.slice(start, end)); start = end + 1;
      }
      const modes = type === "u" ? 4 : 3, hashes = type === "u" ? 3 : 2;
      if (!fields.slice(0, modes).every((v) => /^[0-7]{6}$/.test(v)) || !fields.slice(modes, modes + hashes).every((v) => oid.test(v))) fail("invalid_git_output");
      if (type === "2" && !/^[RC](?:100|[0-9]{1,2})$/.test(fields[5])) fail("invalid_git_output");
      const entry: GitStatusEntry = { index: match[2][0].replace(".", " "), worktree: match[2][1].replace(".", " "), path: statusPath(rest.slice(start)), kind: type === "u" ? "unmerged" : type === "2" ? "rename" : "ordinary" };
      if (type === "2") entry.originalPath = statusPath(records[++i] ?? "");
      entries.push(entry);
    }
  }
  return entries;
}

/** All arguments are documented standard Git flags; tests assert the arrays even without Git.
 * https://git-scm.com/docs/git ; /git-diff ; /git-log ; /git-show ; /git-config
 * Local config still exists. These overrides suppress read-time helper execution, not OS privileges. */
export const GIT_READ_PREFIX = Object.freeze(["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
  "-c", "core.pager=cat", "-c", "color.ui=false", "-c", "diff.external=", "-c", "submodule.recurse=false"]);
export function gitReadArguments(name: "status" | "diff" | "log" | "show", options: { paths?: string[]; staged?: boolean; limit?: number; revision?: string } = {}): string[] {
  const paths = (options.paths ?? ["."]).map((path) => projectPath(path, true));
  const revision = options.revision ?? "HEAD";
  if (name === "show" && !validRevision(revision)) fail("invalid_revision");
  let args: string[];
  if (name === "status") args = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"];
  else if (name === "diff") args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--ignore-submodules=all", ...(options.staged ? ["--cached"] : [])];
  else if (name === "log") args = ["log", "--no-ext-diff", "--no-textconv", "--no-color", "--no-show-signature", `--max-count=${options.limit ?? 20}`, "--format=%H %P%n%an <%ae>%n%aI%n%s%n%b"];
  else args = ["show", "--no-ext-diff", "--no-textconv", "--no-color", "--no-show-signature", "--ignore-submodules=all", revision];
  return [...GIT_READ_PREFIX, ...args, "--", ...paths];
}
function validRevision(value: string): boolean { return value === "HEAD" || oid.test(value); }
function validBranch(value: string): boolean {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value)
    && !value.includes("..") && !value.includes("//") && !value.endsWith("/") && !value.endsWith(".")
    && !value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock")) && value !== "HEAD";
}
function validRemote(value: string): boolean { return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/.test(value); }
export function findGit(): string | null {
  const onPath = Bun.which("git");
  if (onPath || process.platform !== "win32") return onPath;
  // Only documented installation locations under environment-provided Program Files roots.
  // Bun.which checks executability; there is no recursive search, install, or configuration change.
  for (const root of [process.env.ProgramFiles, process.env.ProgramW6432, process.env["ProgramFiles(x86)"]]) {
    if (root) for (const subpath of ["Git/cmd/git.exe", "Git/bin/git.exe"]) {
      const found = Bun.which(join(root, subpath)); if (found) return found;
    }
  }
  return null;
}
interface GitRun { process: ProcessResult; raw: string }
interface Repo { root: string; prefix: string; head: string | null; index: string }
interface IndexEntry { mode: string; hash: string; stage: number; path: string }
interface CommitPreview {
  previewId: string; expectedTree: string; expectedHead: string | null; paths: string[];
  diff: string; indexHash: string; indexArtifact: string; repository: string; project: string; runId: string;
  state: "prepared" | "executing" | "finished"; outcome?: JsonValue;
}

function parseIndex(raw: string): IndexEntry[] {
  return nulRecords(raw).map((line) => {
    const match = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t([\s\S]+)$/.exec(line);
    if (!match) fail("invalid_git_output");
    return { mode: match[1], hash: match[2], stage: Number(match[3]), path: statusPath(match[4]) };
  });
}

export type GitTools = AgentTool[] & { manager: ProcessManager };
export function createGitTools(options: GitOptions): GitTools {
  const paths = new WorkspacePaths(options.project);
  const artifactDir = options.artifactDir ?? join(getDataDirectory(), "artifacts");
  const manager = new ProcessManager({ ...options, artifactDir }), artifacts = new ArtifactStore(artifactDir, paths.root);
  const sanitizer = new AgentSanitizer(options.secrets), git = findGit();
  let repositoryRoot = paths.root;
  // Serialize this factory's operations; the runner's workspace lease fences cooperating writers.
  let queue = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action); queue = result.then(() => {}, () => {}); return result;
  };
  const run = async (args: string[], ctx: ToolInvocationContext, settings: { mutation?: boolean; env?: Record<string, string>; raw?: boolean } = {}): Promise<GitRun> => {
    if (!git) fail("git_unavailable");
    if (ctx.signal.aborted) fail("aborted");
    let bytes = 0; const chunks: Buffer[] = [];
    const result = await manager.run({ executable: git, args, cwd: ".", ownerId: ctx.runId, signal: ctx.signal, modelBytes: 256 * 1024,
      env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_PAGER: "", GIT_NO_REPLACE_OBJECTS: "1", LC_ALL: "C",
        ...(settings.mutation ? {} : { GIT_OPTIONAL_LOCKS: "0" }), ...settings.env },
      onStdout: settings.raw ? (chunk) => {
        bytes += chunk.length;
        if (bytes > PROCESS_LIMITS.artifactBytes) fail("git_output_limit");
        chunks.push(Buffer.from(chunk));
      } : undefined });
    if (result.cleanup === "failed" || result.status === "outcome_unknown") throw new AgentError("outcome_unknown");
    let raw = "";
    if (settings.raw) {
      if (bytes > PROCESS_LIMITS.artifactBytes) fail("git_output_limit");
      try { raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
      catch { fail("invalid_git_encoding"); }
    }
    // Credentials embedded in repository remote URLs must never reach logs or tool artifacts.
    // The process layer redacts configured values; discover no raw URL here and redact output too.
    return { process: result, raw };
  };
  const command = (args: string[], ctx: ToolInvocationContext, mutation = false, env?: Record<string, string>) =>
    run([...GIT_READ_PREFIX, ...args], ctx, { mutation, env, raw: true });
  const exact = async (args: string[], ctx: ToolInvocationContext, env?: Record<string, string>): Promise<string> => {
    const result = await command(args, ctx, false, env);
    if (!result.process.ok) fail("git_command_failed");
    return result.raw;
  };
  const repo = async (ctx: ToolInvocationContext): Promise<Repo> => {
    const rootResult = await command(["rev-parse", "--show-toplevel"], ctx);
    if (!rootResult.process.ok) {
      // Exit 128 also covers corrupt repositories and ownership/permission failures.
      const absent = rootResult.process.exitCode === 128 && /^fatal: not a git repository \(or any (?:of the )?parent\b/m.test(rootResult.process.stderr);
      fail(absent ? "not_repository" : "git_command_failed");
    }
    const root = realpathSync.native(rootResult.raw.trimEnd());
    if (!contained(root, paths.root)) fail("repository_scope_mismatch");
    repositoryRoot = root;
    const head = await command(["rev-parse", "--verify", "HEAD"], ctx);
    const hash = head.process.ok ? head.raw.trim() : null;
    if (hash !== null && !oid.test(hash)) fail("invalid_git_output");
    if (!head.process.ok && !(await command(["symbolic-ref", "-q", "HEAD"], ctx)).process.ok) fail("invalid_head");
    const index = (await exact(["rev-parse", "--path-format=absolute", "--git-path", "index"], ctx)).trimEnd();
    return { root, prefix: relative(root, paths.root).replaceAll("\\", "/"), head: hash, index };
  };
  const tree = async (ctx: ToolInvocationContext, env?: Record<string, string>) => {
    const value = (await exact(["write-tree"], ctx, env)).trim();
    if (!oid.test(value)) fail("invalid_git_output"); return value;
  };
  const indexEntries = async (ctx: ToolInvocationContext, env?: Record<string, string>) =>
    parseIndex(await exact(["-C", repositoryRoot, "ls-files", "--stage", "--full-name", "-z"], ctx, env));
  const changedPaths = async (repository: Repo, ctx: ToolInvocationContext, env?: Record<string, string>): Promise<string[]> => {
    const raw = await exact(["-C", repository.root, "diff", "--cached", "--name-only", "--no-relative", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "-z", ...(repository.head ? [repository.head] : []), "--"], ctx, env);
    // git diff from a subdirectory defaults to the complete index without pathspecs.
    return nulRecords(raw).map(statusPath).sort();
  };
  const scoped = (selected: unknown): string[] => {
    if (!Array.isArray(selected) || !selected.length || selected.length > 200 || selected.some((p) => typeof p !== "string")) fail("invalid_paths");
    const normalized = (selected as string[]).map((p) => projectPath(p));
    if (new Set(normalized.map(pathKey)).size !== normalized.length) fail("invalid_paths");
    for (const path of normalized) paths.resolve(path, { allowMissing: true });
    return normalized.sort();
  };
  const rootPaths = (repository: Repo, selected: string[]) => selected.map((path) => repository.prefix ? `${repository.prefix}/${path}` : path).sort();
  const assertIndex = async (repository: Repo, expectedTree: string, expectedHead: string | null, ctx: ToolInvocationContext) => {
    const now = await repo(ctx);
    if (pathKey(now.root) !== pathKey(repository.root) || now.head !== expectedHead || await tree(ctx) !== expectedTree) fail("stale_index");
  };
  const workHash = (path: string): string | null => {
    const entry = paths.resolve(path, { allowMissing: true });
    if (!entry.stat) return null;
    if (!entry.stat.isFile()) fail("not_regular_file");
    const fd = openSync(entry.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd), hash = createHash("sha256"), buffer = Buffer.alloc(65536);
      if (!before.isFile() || before.nlink !== 1 || identity(before) !== identity(entry.stat)) fail("path_changed");
      let size = 0, count: number;
      while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        size += count; if (size > 64 * 1024 * 1024) fail("file_limit"); hash.update(buffer.subarray(0, count));
      }
      const after = fstatSync(fd), current = paths.resolve(path);
      if (!current.stat || identity(current.stat) !== identity(before) || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== size) fail("path_changed");
      return hash.digest("hex");
    } finally { closeSync(fd); }
  };
  const snapshot = (index: string, id: string): { name: string; hash: string } => {
    const bytes = readPrivate(index, PROCESS_LIMITS.artifactBytes);
    const name = `git-index-${id}.bin`;
    const fd = openSync(join(artifacts.directory, name), "wx", 0o600);
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    return { name, hash: createHash("sha256").update(bytes).digest("hex") };
  };
  const status = async (ctx: ToolInvocationContext) => {
    let repository: Repo;
    try { repository = await repo(ctx); }
    catch (error) {
      if (error instanceof GitToolError && error.code === "not_repository") return {
        ok: true, status: "not_repository", repository: null,
        message: "this folder is not a git repository. continue working with files; run git init only when version control is requested.",
      };
      if (error instanceof GitToolError && error.code === "git_unavailable") return {
        ok: true, status: "git_unavailable", repository: null,
        message: "git is not installed or available on PATH. continue working with files; git commands require installing git.",
      };
      throw error;
    }
    const result = await run(gitReadArguments("status"), ctx, { raw: true });
    if (!result.process.ok) return { ok: false, process: result.process };
    const entries = parseGitStatus(result.raw);
    const conflict = (await indexEntries(ctx)).some((entry) => entry.stage !== 0);
    const limited: GitStatusEntry[] = []; let size = 0;
    for (const entry of entries) {
      size += Buffer.byteLength(JSON.stringify(entry));
      if (size > 256 * 1024 || limited.length >= 2000) break;
      limited.push(entry);
    }
    return { ok: true, repository: repository.root, projectPrefix: repository.prefix, head: repository.head,
      entries: limited, truncated: limited.length !== entries.length, expectedTree: conflict ? null : await tree(ctx) };
  };
  const clean = async (ctx: ToolInvocationContext): Promise<void> => {
    const result = await command(["-C", repositoryRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], ctx);
    if (!result.process.ok) fail("git_command_failed");
    if (parseGitStatus(result.raw).length) fail("dirty_worktree");
  };
  const stage = async (args: Readonly<JsonObject>, ctx: ToolInvocationContext) => {
    const selected = scoped(args.paths), repository = await repo(ctx);
    const expected = args.expectedHashes as Record<string, string | null>;
    if (!expected || Object.keys(expected).sort().join("\0") !== selected.join("\0")) fail("invalid_hashes");
    for (const path of selected) if (expected[path] !== workHash(path)) fail("stale_file");
    await assertIndex(repository, args.expectedTree as string, args.expectedHead as string | null, ctx);
    const before = await indexEntries(ctx);
    if (before.some((entry) => entry.stage !== 0 || ["160000", "120000"].includes(entry.mode) && rootPaths(repository, selected).includes(entry.path))) fail("unsupported_index");
    const rootSelected = rootPaths(repository, selected);
    if (before.some((entry) => rootSelected.some((path) => entry.path.startsWith(`${path}/`)))) fail("exact_file_paths_required");
    for (const path of selected) if (expected[path] !== workHash(path)) fail("stale_file");
    const result = await command(["add", "--", ...selected], ctx, true);
    const after = await indexEntries(ctx), selectedRoot = new Set(rootPaths(repository, selected));
    const unrelated = (entries: IndexEntry[]) => entries.filter((entry) => !selectedRoot.has(entry.path));
    const raced = selected.some((path) => expected[path] !== workHash(path)) || digest(unrelated(before) as unknown as JsonValue) !== digest(unrelated(after) as unknown as JsonValue);
    return { ok: result.process.ok && !raced, process: result.process, ...(raced ? { error: { code: "stage_race", message: "worktree or unrelated index changed during staging; inspect current state" } } : {}), state: await status(ctx) };
  };
  const prepare = async (args: Readonly<JsonObject>, ctx: ToolInvocationContext): Promise<JsonValue> => {
    const selected = scoped(args.paths), repository = await repo(ctx), entries = await indexEntries(ctx);
    if (entries.some((entry) => entry.stage !== 0)) fail("unmerged_index");
    const changed = await changedPaths(repository, ctx);
    if (JSON.stringify(changed) !== JSON.stringify(rootPaths(repository, selected))) fail("unrelated_staged_changes");
    if (entries.some((entry) => ["160000", "120000"].includes(entry.mode) && changed.includes(entry.path))) fail("unsupported_index");
    const expectedTree = await tree(ctx), id = randomUUID(), saved = snapshot(repository.index, id);
    const env = { GIT_INDEX_FILE: join(artifacts.directory, saved.name) };
    if (await tree(ctx, env) !== expectedTree) fail("stale_index");
    const diff = await command(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "--ignore-submodules=all", "--", ...selected], ctx, false, env);
    if (!diff.process.ok || Buffer.byteLength(diff.raw) > 512 * 1024) fail("commit_preview_limit");
    // Signed previews must contain no configured secrets or terminal controls.
    const safeDiff = sanitizer.text(diff.raw);
    if (safeDiff !== diff.raw) fail("unsafe_commit_preview");
    sanitizer.exact({ paths: selected, diff: safeDiff, project: paths.root, runId: ctx.runId, repository: repository.root }, 768 * 1024);
    await assertIndex(repository, expectedTree, repository.head, ctx);
    const preview: CommitPreview = { previewId: id, expectedTree, expectedHead: repository.head, paths: selected, diff: safeDiff,
      indexHash: saved.hash, indexArtifact: saved.name, repository: repository.root, project: paths.root, runId: ctx.runId, state: "prepared" };
    artifacts.create(`git-preview-${id}.json`, preview as unknown as JsonValue);
    return { ok: true, previewId: id, expectedTree, expectedHead: repository.head ?? "unborn", paths: selected, diff: safeDiff,
      artifactRef: `git-preview-${id}.json`, hooks: "commit hooks and signing configuration run with host privileges" };
  };
  const commit = async (args: Readonly<JsonObject>, ctx: ToolInvocationContext): Promise<JsonValue> => {
    const name = `git-preview-${args.previewId}.json`;
    const preview = artifacts.read(name) as unknown as CommitPreview;
    if (preview.state !== "prepared") fail("commit_already_attempted");
    if (preview.runId !== ctx.runId || preview.project !== paths.root || preview.expectedTree !== args.expectedTree || preview.expectedHead !== args.expectedHead) fail("preview_mismatch");
    const repository = await repo(ctx);
    if (pathKey(repository.root) !== pathKey(preview.repository)) fail("preview_mismatch");
    await assertIndex(repository, preview.expectedTree, preview.expectedHead, ctx);
    if (JSON.stringify(await changedPaths(repository, ctx)) !== JSON.stringify(rootPaths(repository, preview.paths))) fail("unrelated_staged_changes");
    const snapshotPath = join(artifacts.directory, preview.indexArtifact), bytes = readPrivate(snapshotPath, PROCESS_LIMITS.artifactBytes);
    if (createHash("sha256").update(bytes).digest("hex") !== preview.indexHash) fail("preview_corrupt");
    const reviewEntries = await indexEntries(ctx, { GIT_INDEX_FILE: snapshotPath });
    const currentEntries = await indexEntries(ctx);
    if (digest(reviewEntries as unknown as JsonValue) !== digest(currentEntries as unknown as JsonValue)) fail("stale_index");
    const originalIndexHash = createHash("sha256").update(readPrivate(repository.index, PROCESS_LIMITS.artifactBytes)).digest("hex");
    const activeIndex = join(artifacts.directory, `git-commit-${randomUUID()}.index`);
    const fd = openSync(activeIndex, "wx", 0o600);
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    const env = { GIT_INDEX_FILE: activeIndex };
    preview.state = "executing";
    artifacts.replace(name, preview as unknown as JsonValue);
    let outcome: JsonValue;
    let dispatched = false;
    try {
      await assertIndex(repository, preview.expectedTree, preview.expectedHead, ctx);
      // Isolated reviewed index preserves unrelated concurrent staging. Hooks are intentionally enabled.
      dispatched = true;
      const result = await command(["commit", "-m", args.message as string], ctx, true, env);
      const observed = await repo({ ...ctx, signal: new AbortController().signal });
      const verifyCtx = { ...ctx, signal: new AbortController().signal };
      let matched = false;
      if (observed.head && observed.head !== preview.expectedHead) {
        const evidence = (await exact(["show", "-s", "--no-show-signature", "--format=%T%n%P", observed.head, "--"], verifyCtx)).trim().split("\n");
        matched = evidence[0] === preview.expectedTree && (evidence[1] ?? "") === (preview.expectedHead ?? "");
      }
      const indexUnchanged = createHash("sha256").update(readPrivate(repository.index, PROCESS_LIMITS.artifactBytes)).digest("hex") === originalIndexHash;
      outcome = { ok: result.process.ok && matched, process: result.process as unknown as JsonValue,
        head: observed.head, approvedTreeCommitted: matched, originalIndexUnchanged: indexUnchanged,
        ...(result.process.ok && !matched ? { error: { code: "commit_state_changed", message: "hook or concurrent repository change invalidated the approved commit; inspect head and index" } } : {}) };
    } catch (error) {
      if (dispatched) throw new AgentError("outcome_unknown");
      throw error;
    } finally {
      // Unique owned temporary index only; the preview and original index remain for recovery.
      try { if (lstatSync(activeIndex).isFile()) unlinkSync(activeIndex); } catch { /* keep evidence if locked */ }
    }
    preview.state = "finished"; preview.outcome = outcome;
    try { artifacts.replace(name, preview as unknown as JsonValue); } catch { throw new AgentError("outcome_unknown"); }
    return outcome;
  };
  const str: ToolSchema = { type: "string" }, hash: ToolSchema = { type: "string" }, nullable: ToolSchema = { type: "string" };
  // The schema subset uses a null enum through a union-free nullable argument encoded as "unborn".
  const strings: ToolSchema = { type: "array", items: str };
  const object = (properties: Record<string, ToolSchema>, required: string[] = []): ToolSchema & { type: "object" } => ({ type: "object", properties, required, additionalProperties: false });
  const binding = { expectedTree: hash, expectedHead: nullable };
  const bound = (args: Readonly<JsonObject>) => oid.test(args.expectedTree as string) && (args.expectedHead === "unborn" || oid.test(args.expectedHead as string));
  const tool = (name: string, description: string, schema: ToolSchema & { type: "object" }, effect: AgentTool["effect"],
    action: (args: Readonly<JsonObject>, ctx: ToolInvocationContext) => unknown | Promise<unknown>, check: (args: Readonly<JsonObject>) => boolean = () => true): AgentTool => {
    schema = toolParameters(name, schema);
    const validate = (args: Readonly<JsonObject>) => { try { validateArguments(args as JsonObject, schema); return check(args); } catch { return false; } };
    return { name, version: "1", schemaVersion: "1", effect, scope: effect === "read" ? "project" : effect === "network" ? "remote" : "external",
      timeoutMs: 15 * 60_000, definition: { type: "function", function: { name, description, parameters: schema } }, validate,
      execute: (args, ctx) => serial(async () => {
        try {
          if (!validate(args)) fail("invalid_arguments");
          paths.checkRoot();
          if (pathKey(new WorkspacePaths(ctx.project).root) !== pathKey(paths.root)) fail("project_mismatch");
          if (ctx.signal.aborted) fail("aborted");
          const normalized = args.expectedHead === "unborn" ? { ...args, expectedHead: null } : args;
          return sanitizer.result(await action(normalized, ctx), PROCESS_LIMITS.modelBytes);
        } catch (error) {
          if (error instanceof AgentError && error.code === "outcome_unknown") throw error;
          return { ok: false, error: { code: error instanceof GitToolError ? error.code : "git_failed", message: error instanceof GitToolError ? error.message : "git operation failed" } };
        }
      }) };
  };
  const tools: AgentTool[] = [
    tool("git_status", "read porcelain status, repository scope, head and index tree. missing git or repository is a normal availability result; continue file work. does not initialize repositories.", object({}), "read", (_, ctx) => status(ctx)),
    tool("git_diff", "read staged or working diff within the selected project with external diff/textconv/fsmonitor and submodule helpers disabled.", object({ staged: { type: "boolean" }, paths: strings }), "read", async (args, ctx) => {
      if (args.paths) scoped(args.paths);
      await repo(ctx); return (await run(gitReadArguments("diff", args as { staged?: boolean; paths?: string[] }), ctx)).process;
    }),
    tool("git_log", "read bounded history without pager, signatures or external diff helpers.", object({ limit: { type: "integer" } }), "read", async (args, ctx) => {
      await repo(ctx); return (await run(gitReadArguments("log", args as { limit?: number }), ctx)).process;
    }, (args) => args.limit === undefined || Number.isSafeInteger(args.limit) && (args.limit as number) >= 1 && (args.limit as number) <= 100),
    tool("git_show", "show HEAD or a full commit hash without external diff/textconv/signature helpers.", object({ revision: str, paths: strings }), "read", async (args, ctx) => {
      if (args.paths) scoped(args.paths);
      await repo(ctx); return (await run(gitReadArguments("show", args as { revision?: string; paths?: string[] }), ctx)).process;
    }, (args) => args.revision === undefined || validRevision(args.revision as string)),
    tool("git_stage", "stage exact files after sha256 preimage and index/head checks. expectedHashes maps each path to its sha256 or 'missing'. expectedHead is a full hash or 'unborn'. git filters may execute with host privileges.",
      object({ paths: strings, expectedHashes: { type: "object", additionalProperties: str }, ...binding }, ["paths", "expectedHashes", "expectedTree", "expectedHead"]), "write",
      (args, ctx) => stage({ ...args, expectedHashes: Object.fromEntries(Object.entries(args.expectedHashes as JsonObject).map(([path, value]) => [path, value === "missing" ? null : value])) }, ctx),
      (args) => bound(args) && Object.values(args.expectedHashes as JsonObject).every((v) => v === "missing" || typeof v === "string" && sha256.test(v))),
    tool("git_unstage", "unstage exact paths after tree/head checks; preserve working files and unrelated index entries. expectedHead uses 'unborn' before the first commit.",
      object({ paths: strings, ...binding }, ["paths", "expectedTree", "expectedHead"]), "write", async (args, ctx) => {
        const selected = scoped(args.paths), repository = await repo(ctx);
        for (const path of selected) if (paths.resolve(path, { allowMissing: true }).stat?.isDirectory()) fail("not_regular_file");
        const before = await indexEntries(ctx), selectedRoot = new Set(rootPaths(repository, selected));
        if (before.some((entry) => entry.stage !== 0)) fail("unmerged_index");
        if (before.some((entry) => [...selectedRoot].some((path) => entry.path.startsWith(`${path}/`)))) fail("exact_file_paths_required");
        await assertIndex(repository, args.expectedTree as string, args.expectedHead as string | null, ctx);
        const result = await command(repository.head ? ["reset", "-q", repository.head, "--", ...selected] : ["rm", "--cached", "--", ...selected], ctx, true);
        const after = await indexEntries(ctx);
        const unrelated = (entries: IndexEntry[]) => entries.filter((entry) => !selectedRoot.has(entry.path));
        const raced = digest(unrelated(before) as unknown as JsonValue) !== digest(unrelated(after) as unknown as JsonValue);
        return { ok: result.process.ok && !raced, process: result.process, state: await status(ctx),
          ...(raced ? { error: { code: "index_race", message: "unrelated index state changed during the operation" } } : {}) };
      }, bound),
    tool("git_prepare_commit", "durably preview the entire intended staged index. paths must exactly match ALL staged changes, including deletions; unrelated staged work blocks preparation. returns previewId, expectedTree, expectedHead (use 'unborn' for null), paths and diff.",
      object({ paths: strings }, ["paths"]), "read", prepare),
    tool("git_commit", "commit only a durable reviewed preview, exact tree/head and explicit message. hooks/signing run normally. no amend, no hook bypass. expectedHead is a hash or 'unborn'. a preview is single-use even after failure.",
      object({ previewId: str, ...binding, message: str }, ["previewId", "expectedTree", "expectedHead", "message"]), "execute", commit,
      (args) => bound(args) && /^[0-9a-f-]{36}$/.test(args.previewId as string) && typeof args.message === "string" && !!args.message.trim() && Buffer.byteLength(args.message) <= 16384 && !args.message.includes("\0")),
    tool("git_branch", "create an explicitly named branch at the expected HEAD; no force, delete or history rewriting.", object({ name: str, expectedHead: str }, ["name", "expectedHead"]), "write", async (args, ctx) => {
      const repository = await repo(ctx); if (repository.head !== args.expectedHead) fail("stale_head");
      return (await command(["branch", "--", args.name as string, args.expectedHead as string], ctx, true)).process;
    }, (args) => validBranch(args.name as string) && oid.test(args.expectedHead as string)),
    tool("git_switch", "switch to an existing branch only with a clean index/worktree and expected HEAD. always requires exact operation review; no force or detached switching.",
      object({ branch: str, expectedHead: str }, ["branch", "expectedHead"]), "destructive", async (args, ctx) => {
        const repository = await repo(ctx); if (repository.head !== args.expectedHead) fail("stale_head");
        await clean(ctx);
        return (await command(["switch", "--no-guess", "--", args.branch as string], ctx, true)).process;
      }, (args) => validBranch(args.branch as string) && oid.test(args.expectedHead as string)),
    ...(["fetch", "pull", "push"] as const).map((operation) => tool(`git_${operation}`,
      `${operation} one named remote and branch after explicit network review. helpers and hooks have host privileges. no URL arguments, pruning, force, tags or configuration changes; pull is fast-forward only and requires a clean worktree.`,
      object({ remote: str, branch: str, expectedHead: str }, ["remote", "branch", "expectedHead"]), "network", async (args, ctx) => {
        const repository = await repo(ctx); if (repository.head !== args.expectedHead) fail("stale_head");
        if (operation === "pull") await clean(ctx);
        const argv = operation === "fetch" ? ["fetch", "--no-tags", "--no-recurse-submodules", "--", args.remote as string, `refs/heads/${args.branch}`]
          : operation === "pull" ? ["pull", "--ff-only", "--no-rebase", "--no-tags", "--no-recurse-submodules", "--", args.remote as string, `refs/heads/${args.branch}`]
          : ["push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", "--", args.remote as string, `HEAD:refs/heads/${args.branch}`];
        const result = await command(argv, ctx, true);
        return { ok: result.process.ok, process: result.process, state: await status({ ...ctx, signal: new AbortController().signal }) };
      }, (args) => validRemote(args.remote as string) && validBranch(args.branch as string) && oid.test(args.expectedHead as string))),
  ];
  return Object.assign(tools, { manager });
}
