import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { AgentSanitizer, boundedText } from "../agent/data";
import { fail, safely } from "./errors";
import { identity, type AccessGrant, type WorkspacePaths } from "./paths";

export const workspaceLimits = Object.freeze({ fileBytes: 1024 * 1024, outputBytes: 128 * 1024,
  changeBytes: 384 * 1024, changes: 32, entries: 10_000, directoryEntries: 4096,
  pageEntries: 500, searchBytes: 16 * 1024 * 1024, searchMs: 2000, instructionBytes: 32 * 1024 });
export function hashText(text: string | Buffer): string { return createHash("sha256").update(text).digest("hex"); }
export function decodeText(bytes: Buffer): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail("binary_file");
    return text;
  } catch { fail("binary_file"); }
}
export function validText(text: unknown, max = workspaceLimits.fileBytes): asserts text is string {
  if (typeof text !== "string" || !text.isWellFormed()) fail("binary_file");
  if (Buffer.byteLength(text) > max) fail("file_limit");
  decodeText(Buffer.from(text));
}
export function retainable(value: unknown, secrets: readonly string[] = [], max = 2 * 1024 * 1024): void {
  try { new AgentSanitizer(secrets).exact(value, max); } catch { fail("unsafe_data"); }
}
export interface FileImage { text: string; hash: string; identity: string; mode: number; bytes: number }
export function readImage(paths: WorkspacePaths, path: string, grant?: AccessGrant): FileImage | null {
  return safely(() => {
    const target = paths.resolve(path, { allowMissing: true, grant });
    if (!target.stat) return null;
    if (!target.stat.isFile()) fail("not_file");
    if (target.stat.size > workspaceLimits.fileBytes) fail("file_limit");
    const fd = openSync(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || identity(before) !== identity(target.stat)) fail("path_changed");
      if (before.size > workspaceLimits.fileBytes) fail("file_limit");
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0, count = 0;
      while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, length)) > 0) length += count;
      const after = fstatSync(fd), current = paths.resolve(path, { grant });
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || after.nlink !== 1 || !current.stat
        || identity(current.stat) !== identity(before)) fail("path_changed");
      const content = bytes.subarray(0, length);
      return { text: decodeText(content), hash: hashText(content), identity: identity(before), mode: before.mode & 0o777, bytes: length };
    } finally { closeSync(fd); }
  });
}
export function lines(text: string): string[] {
  if (text === "") return [];
  const result = text.split(/(?<=\n)/);
  if (result.at(-1) === "") result.pop();
  return result;
}
export function newline(text: string): "lf" | "crlf" | "mixed" | "none" {
  const crlf = text.includes("\r\n"), lf = /(^|[^\r])\n/.test(text);
  return crlf && lf ? "mixed" : crlf ? "crlf" : lf ? "lf" : "none";
}
export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("invalid_input");
  return value;
}
export { boundedText };
