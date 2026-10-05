import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { aborted, fail, safely } from "./errors";
import { identity, ignoredDirectories, type WorkspacePaths } from "./paths";
import { decodeText } from "./text";

/** Discovery-only gitignore subset, independent of git and global configuration.
 * Each scope applies .gitignore then .ignore; deeper scopes and later lines win.
 * Matching is case-sensitive, on unicode codepoints (no locale/core.ignoreCase).
 * Supports comments, escapes, negation, anchoring, directory suffixes, *, ?, ranges
 * and whole-component **. Other consecutive stars act as *. No brace/extglob
 * expansion: those characters are literals, as in gitignore. POSIX named classes,
 * collating/equivalence classes, malformed ranges/escapes, escaped separators,
 * separators inside classes and empty/dot path components explicitly fail with
 * unsupported_pattern. No line continuations or external/global excludes.
 * Configurations must be regular, singly linked utf8 files, at most 128 kib each
 * and in aggregate per traversal. Links fail without following them. Errors never
 * contain source text. Work/rule bounds fail explicitly instead of dropping rules.
 */
const maxBytes = 128 * 1024, maxRules = 4096, maxPattern = 2048;
type Range = readonly [number, number];
type Token = { kind: "literal"; value: string } | { kind: "star" | "any" }
  | { kind: "class"; inverted: boolean; ranges: Range[] };
type Segment = { tokens: Token[]; literal: string | null } | "**";
interface Rule { negate: boolean; directory: boolean; basename: boolean; parts: Segment[] }

class MatchBudget {
  private remaining = 64 * 1024 * 1024;
  constructor(private readonly signal?: AbortSignal) {}
  spend(amount = 1): void {
    aborted(this.signal);
    this.remaining -= amount;
    if (this.remaining < 0) fail("unsupported_pattern");
  }
}

function characterClass(chars: string[], start: number): { token: Token; end: number } {
  let i = start + 1;
  const inverted = chars[i] === "!" || chars[i] === "^";
  if (inverted) i++;
  const members: { value: string; escaped: boolean }[] = [];
  // An initial ] is literal; an initial/final - is also literal.
  if (chars[i] === "]") members.push({ value: chars[i++], escaped: false });
  while (i < chars.length && chars[i] !== "]") {
    let value = chars[i++], escaped = false;
    if (value === "\\") { escaped = true; value = chars[i++]; if (value === undefined) fail("unsupported_pattern"); }
    else if (value === "[" && [":", ".", "="].includes(chars[i])) fail("unsupported_pattern");
    if (value === "/") fail("unsupported_pattern");
    members.push({ value, escaped });
  }
  if (chars[i] !== "]" || !members.length) fail("unsupported_pattern");
  const ranges: Range[] = [];
  for (let j = 0; j < members.length; j++) {
    const low = members[j].value.codePointAt(0)!;
    if (j + 2 < members.length && members[j + 1].value === "-" && !members[j + 1].escaped) {
      const high = members[j + 2].value.codePointAt(0)!;
      if (low > high) fail("unsupported_pattern");
      ranges.push([low, high]); j += 2;
    } else ranges.push([low, low]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 1) merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
    else merged.push(range);
  }
  return { token: { kind: "class", inverted, ranges: merged }, end: i };
}

function compileRule(line: string): Rule | null {
  if (!line || line.startsWith("#")) return null;
  // Remove only unescaped trailing spaces. A backslash quotes exactly one char.
  let end = line.length;
  while (end && line[end - 1] === " ") {
    let slashes = 0;
    for (let i = end - 2; i >= 0 && line[i] === "\\"; i--) slashes++;
    if (slashes % 2) break;
    end--;
  }
  line = line.slice(0, end);
  if (!line) return null;
  const negate = line.startsWith("!");
  if (negate) line = line.slice(1);
  if (!line || line.length > maxPattern) fail("unsupported_pattern");
  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  const directory = line.endsWith("/");
  if (directory) line = line.slice(0, -1);
  if (!line) fail("unsupported_pattern");
  const chars = [...line], components: Token[][] = [[]];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], tokens = components[components.length - 1];
    if (c === "\\") {
      const value = chars[++i];
      if (value === undefined || value === "/") fail("unsupported_pattern");
      tokens.push({ kind: "literal", value });
    } else if (c === "/") components.push([]);
    else if (c === "[") { const parsed = characterClass(chars, i); tokens.push(parsed.token); i = parsed.end; }
    else if (c === "*") tokens.push({ kind: "star" });
    else if (c === "?") tokens.push({ kind: "any" });
    else tokens.push({ kind: "literal", value: c });
  }
  if (components.length > 64) fail("unsupported_pattern");
  const parts = components.map((tokens): Segment => {
    if (!tokens.length) fail("unsupported_pattern");
    if (tokens.length === 2 && tokens.every((token) => token.kind === "star")) return "**";
    const literal = tokens.every((token) => token.kind === "literal")
      ? tokens.map((token) => token.value).join("") : null;
    if (literal === "." || literal === "..") fail("unsupported_pattern");
    return { literal, tokens: tokens.filter((token, i) => token.kind !== "star" || tokens[i - 1]?.kind !== "star") };
  });
  return { negate, directory, basename: !anchored && parts.length === 1, parts };
}

function tokenMatches(token: Token, char: string): boolean {
  if (token.kind === "literal") return token.value === char;
  if (token.kind !== "class") return true;
  const point = char.codePointAt(0)!;
  let low = 0, high = token.ranges.length - 1, found = false;
  while (low <= high) {
    const mid = (low + high) >>> 1, range = token.ranges[mid];
    if (point < range[0]) high = mid - 1;
    else if (point > range[1]) low = mid + 1;
    else { found = true; break; }
  }
  return found !== token.inverted;
}

// Like patterns.ts, this uses rolling DP rows, never a backtracking regex.
// O(pattern tokens * input codepoints), with logarithmic class membership.
function segmentMatches(segment: Exclude<Segment, string>, value: string, budget: MatchBudget): boolean {
  if (segment.literal !== null) { budget.spend(value.length + 1); return segment.literal === value; }
  const chars = [...value];
  let prev = new Uint8Array(chars.length + 1); prev[0] = 1;
  for (const token of segment.tokens) {
    budget.spend((chars.length + 1) * (token.kind === "class" ? 1 + Math.ceil(Math.log2(token.ranges.length + 1)) : 1));
    const next = new Uint8Array(chars.length + 1);
    if (token.kind === "star") next[0] = prev[0];
    for (let j = 1; j <= chars.length; j++) next[j] = token.kind === "star" ? (next[j - 1] | prev[j])
      : (prev[j - 1] && tokenMatches(token, chars[j - 1]) ? 1 : 0);
    prev = next;
  }
  return prev[chars.length] === 1;
}

function ruleMatches(rule: Rule, path: string, directory: boolean, budget: MatchBudget): boolean {
  budget.spend();
  if (rule.directory && !directory) return false;
  const names = path.split("/");
  if (rule.basename) return rule.parts[0] === "**" || segmentMatches(rule.parts[0], names[names.length - 1], budget);
  let prev = new Uint8Array(names.length + 1); prev[0] = 1;
  for (let i = 0; i < rule.parts.length; i++) {
    const part = rule.parts[i], next = new Uint8Array(names.length + 1);
    // a/** matches descendants, not a itself. Leading/middle ** may be empty.
    const trailing = part === "**" && i > 0 && i === rule.parts.length - 1;
    budget.spend(names.length + 1);
    if (part === "**" && !trailing) next[0] = prev[0];
    for (let j = 1; j <= names.length; j++) next[j] = part === "**"
      ? (next[j - 1] | (trailing ? prev[j - 1] : prev[j]))
      : (prev[j - 1] && segmentMatches(part, names[j - 1], budget) ? 1 : 0);
    prev = next;
  }
  return prev[names.length] === 1;
}

/** Per-entry evaluator. The caller must prune excluded ancestors before applying
 * child rules; this class alone intentionally does not perform filesystem traversal. */
export class IgnoreRules {
  private readonly rules: Rule[];
  readonly count: number;
  constructor(text: string) {
    if (typeof text !== "string" || !text.isWellFormed()) fail("binary_file");
    if (Buffer.byteLength(text) > maxBytes) fail("file_limit");
    decodeText(Buffer.from(text));
    this.rules = [];
    for (const line of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
      if (line.includes("\r")) fail("unsupported_pattern");
      const rule = compileRule(line);
      if (rule) this.rules.push(rule);
      if (this.rules.length > maxRules) fail("file_limit");
    }
    this.count = this.rules.length;
  }
  ignored(path: string, directory: boolean, previous = false, budget = new MatchBudget()): boolean {
    if (!path || path.length > 2048 || !path.isWellFormed() || path.split("/").length > 64) fail("invalid_path");
    for (const rule of this.rules) if (ruleMatches(rule, path, directory, budget)) previous = !rule.negate;
    return previous;
  }
}

function readRules(paths: WorkspacePaths, path: string, remaining: number): { rules: IgnoreRules; bytes: number } | null {
  return safely(() => {
    const target = paths.resolve(path, { allowMissing: true });
    if (!target.stat) return null;
    if (!target.stat.isFile()) fail("not_file");
    if (target.stat.size > remaining) fail("file_limit");
    const fd = openSync(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || identity(before) !== identity(target.stat)) fail("path_changed");
      if (before.size > remaining) fail("file_limit");
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0, count = 0;
      while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, length)) > 0) length += count;
      const after = fstatSync(fd), current = paths.resolve(path);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || after.nlink !== 1 || !current.stat
        || identity(current.stat) !== identity(before)) fail("path_changed");
      return { rules: new IgnoreRules(decodeText(bytes.subarray(0, length))), bytes: length };
    } finally { closeSync(fd); }
  });
}

interface Scope { base: string; parent: Scope | null; files: IgnoreRules[] }
const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";

/** One instance per list/walk, including cached absent configs and pruned scopes.
 * Builtin directory skips precede user rules; only includeIgnored bypasses them.
 * Safety remains in WorkspacePaths/Workspace and is never bypassed here. */
export class WorkspaceIgnore {
  private readonly scopes = new Map<string, Scope | null>();
  private readonly budget: MatchBudget;
  private bytes = 0;
  private rules = 0;
  constructor(private readonly paths: WorkspacePaths, private readonly includeIgnored = false, private readonly signal?: AbortSignal) {
    this.budget = new MatchBudget(signal);
  }
  private scope(path: string): Scope | null {
    if (this.scopes.has(path)) return this.scopes.get(path)!;
    aborted(this.signal);
    const parent = path === "." ? null : this.scope(parentOf(path));
    if (path !== "." && (!parent || this.matches(parent, path, true))) { this.scopes.set(path, null); return null; }
    const files: IgnoreRules[] = [];
    for (const name of [".gitignore", ".ignore"]) {
      const file = readRules(this.paths, path === "." ? name : `${path}/${name}`, maxBytes - this.bytes);
      if (file) {
        this.bytes += file.bytes; this.rules += file.rules.count;
        if (this.rules > maxRules) fail("file_limit");
        files.push(file.rules);
      }
    }
    const scope = { base: path, parent, files };
    this.scopes.set(path, scope);
    return scope;
  }
  private matches(scope: Scope, path: string, directory: boolean): boolean {
    if (directory && ignoredDirectories.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase())) return true;
    let ignored = scope.parent ? this.matches(scope.parent, path, directory) : false;
    const relative = scope.base === "." ? path : path.slice(scope.base.length + 1);
    for (const file of scope.files) ignored = file.ignored(relative, directory, ignored, this.budget);
    return ignored;
  }
  ignored(path: string, directory: boolean): boolean {
    aborted(this.signal);
    if (this.includeIgnored || path === ".") return false;
    const parent = this.scope(parentOf(path));
    return !parent || this.matches(parent, path, directory);
  }
  enter(path: string): boolean {
    aborted(this.signal);
    return this.includeIgnored || this.scope(path) !== null;
  }
}
