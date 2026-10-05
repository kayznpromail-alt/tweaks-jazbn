import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonical } from "../agent/data";
import type { JsonValue } from "../types";
import { fail, missing, safely } from "./errors";
import { checkAbsoluteDirectory, contained, identity, pathKey } from "./paths";
import { hashText } from "./text";

export const artifactLimit = 4 * 1024 * 1024;
export function defaultArtifactDirectory(dataDirectory: string, project: string): string {
  const reserved = join(dataDirectory, ".edgey-artifacts"), ordinary = join(dataDirectory, "artifacts");
  if (contained(project, dataDirectory)) return reserved;
  const workspace = `workspace-${hashText(pathKey(project))}`;
  // 0.2.16 retained its startup location after changing projects. Keep those
  // signed records accessible on restart; never migrate or overwrite them.
  return !existsSync(join(ordinary, workspace)) && existsSync(join(reserved, workspace)) ? reserved : ordinary;
}
export function ensureDirectory(path: string): void {
  try { checkAbsoluteDirectory(path); }
  catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    ensureDirectory(parent);
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "EEXIST")) throw e; }
    checkAbsoluteDirectory(path);
  }
}
export function artifactRoot(root: string, project: string): string {
  return safely(() => {
    if (typeof root !== "string" || !isAbsolute(root)) fail("artifact_location");
    const location = resolve(root);
    // Home-directory workspaces need private storage inside the home. Only this
    // reserved, ungrantable subtree is accepted; all project file tools exclude it.
    const reserved = relative(project, location).split(sep).some(part => part.toLowerCase() === ".edgey-artifacts");
    if ((contained(project, location) && !reserved) || contained(location, project)) fail("artifact_location");
    ensureDirectory(location);
    return location;
  });
}
export function readPrivate(path: string, max = artifactLimit): Buffer {
  return safely(() => {
    checkAbsoluteDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) fail("artifact_corrupt");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || identity(stat) !== identity(before) || before.size > max) fail("artifact_corrupt");
      const buffer = Buffer.alloc(before.size + 1);
      let size = 0, count: number;
      while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, size)) > 0) size += count;
      const after = fstatSync(fd), current = lstatSync(path);
      if (size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
        || identity(current) !== identity(before) || current.nlink !== 1 || current.isSymbolicLink()) fail("artifact_corrupt");
      return buffer.subarray(0, size);
    } finally { closeSync(fd); }
  });
}
function exclusive(path: string, content: string | Buffer): void {
  checkAbsoluteDirectory(dirname(path));
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Signed records reject rewritten JSON/digests after reopening. This is not a same-user OS sandbox:
 * the host must keep this directory private, outside the project, and never expose the signing key. */
export class ArtifactStore {
  readonly directory: string;
  private readonly key: Buffer;
  constructor(root: string, project: string) {
    this.directory = safely(() => {
      const base = artifactRoot(root, project);
      const directory = join(base, `workspace-${hashText(pathKey(project))}`);
      ensureDirectory(directory);
      return directory;
    });
    this.key = safely(() => {
      const path = join(this.directory, ".signing-key");
      try { exclusive(path, randomBytes(32)); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
      const key = readPrivate(path, 32);
      if (key.length !== 32) fail("artifact_corrupt");
      return key;
    });
  }
  private filename(name: string): string {
    if (!/^[a-z0-9][a-z0-9.-]{0,160}\.json$/.test(name)) fail("artifact_corrupt");
    checkAbsoluteDirectory(this.directory);
    return join(this.directory, name);
  }
  private mac(payload: JsonValue): string { return createHmac("sha256", this.key).update(canonical(payload)).digest("hex"); }
  create(name: string, payload: JsonValue): void {
    safely(() => {
      const text = JSON.stringify({ payload, mac: this.mac(payload) });
      if (Buffer.byteLength(text) > artifactLimit) fail("output_limit");
      exclusive(this.filename(name), text);
    });
  }
  replace(name: string, payload: JsonValue): void {
    safely(() => {
      const filename = this.filename(name);
      this.read(name);
      const tmp = `${filename}.${randomUUID()}.tmp`;
      const text = JSON.stringify({ payload, mac: this.mac(payload) });
      if (Buffer.byteLength(text) > artifactLimit) fail("output_limit");
      exclusive(tmp, text);
      const stamp = identity(lstatSync(tmp));
      try {
        this.read(name);
        checkAbsoluteDirectory(this.directory);
        renameSync(tmp, filename);
      } finally {
        // Only the unique file created by this invocation is eligible for cleanup.
        try { const stat = lstatSync(tmp); if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && identity(stat) === stamp) unlinkSync(tmp); } catch (e) { if (!missing(e)) throw e; }
      }
    });
  }
  read(name: string): JsonValue {
    return safely(() => {
      let envelope: { payload: JsonValue; mac: string };
      try { envelope = JSON.parse(readPrivate(this.filename(name)).toString("utf8")); }
      catch { fail("artifact_corrupt"); }
      if (!envelope || typeof envelope !== "object" || Object.keys(envelope).sort().join() !== "mac,payload"
        || typeof envelope.mac !== "string" || !/^[0-9a-f]{64}$/.test(envelope.mac)) fail("artifact_corrupt");
      try {
        if (!timingSafeEqual(Buffer.from(envelope.mac, "hex"), Buffer.from(this.mac(envelope.payload), "hex"))) fail("artifact_corrupt");
      } catch { fail("artifact_corrupt"); }
      return envelope.payload;
    });
  }
  exists(name: string): boolean {
    return safely(() => { try { lstatSync(this.filename(name)); return true; } catch (error) { if (missing(error)) return false; throw error; } });
  }
}
