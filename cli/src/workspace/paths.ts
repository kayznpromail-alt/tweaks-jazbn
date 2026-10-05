import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fail, missing, safely } from "./errors";

export const ignoredDirectories = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "out", "coverage", ".next", ".nuxt",
  ".cache", ".turbo", ".venv", "venv", "__pycache__", "target", "bin", "obj",
]);
export interface AccessGrant {
  /** Host-only, exact paths; never read from instructions or model tool arguments. */
  readonly protectedPaths: readonly string[];
}
export function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
export function contained(root: string, candidate: string): boolean {
  const rel = relative(pathKey(root), pathKey(candidate));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function projectPath(value: string, allowRoot = false): string {
  if (typeof value !== "string" || value.length > 2048 || !value.isWellFormed()
    || /[\x00-\x1f\x7f-\x9f:*?"<>|]/.test(value) || /^[\\/]/.test(value)) fail("invalid_path");
  if (allowRoot && (value === "." || value === "")) return ".";
  const parts = value.replace(/\\/g, "/").split("/");
  if (parts.length > 64 || parts.some((part) => !part || part === "." || part === ".." || /[ .]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) || part.includes("~"))) fail("invalid_path");
  return parts.join("/");
}
export function protectedPath(path: string): boolean {
  return path.split("/").some((part) => /^\.edgey(?:-artifacts)?$/i.test(part) || /^\.env(?:\.|$)/i.test(part)
    || /^(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.npmrc|\.netrc|\.pypirc)$/i.test(part)
    || /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(part)
    || /(?:\.(?:pem|key|p12|pfx|keystore)|\.vault-key)$/i.test(part));
}
export function identity(stat: Stats): string { return `${stat.dev}:${stat.ino}`; }

/** No link traversal, even for reads: a hardlink may alias a protected file. */
export class WorkspacePaths {
  readonly root: string;
  private readonly rootIdentity: string;
  constructor(root: string, readonly allowProtectedFiles = false) {
    this.root = safely(() => {
      if (typeof root !== "string" || !isAbsolute(root)) fail("invalid_path");
      // Match the session/controller spelling. Bun on Windows preserves caller
      // casing in realpathSync, whereas .native returns filesystem casing.
      // Mixing the two makes the session/run project equality check fail.
      // Root identity and native revalidation below still guard replacement.
      const canonical = realpathSync(root);
      if (!lstatSync(canonical).isDirectory()) fail("not_directory");
      return canonical;
    });
    this.rootIdentity = safely(() => identity(lstatSync(this.root)));
  }
  checkRoot(): void {
    safely(() => {
      const stat = lstatSync(this.root);
      if (stat.isSymbolicLink() || !stat.isDirectory() || identity(stat) !== this.rootIdentity
        || pathKey(realpathSync.native(this.root)) !== pathKey(this.root)) fail("path_changed");
    });
  }
  resolve(value: string, options: { allowRoot?: boolean; allowMissing?: boolean; grant?: AccessGrant } = {}): {
    path: string; absolute: string; stat: Stats | null;
  } {
    return safely(() => {
      const path = projectPath(value, options.allowRoot);
      const granted = options.grant?.protectedPaths.some((entry) => pathKey(projectPath(entry)) === pathKey(path));
      if (protectedPath(path) && !granted && !this.allowProtectedFiles) fail("protected_path");
      // Internal metadata is never a project-edit target, even with a protected-file grant.
      if (path.split("/").some((part) => [".git", ".edgey-artifacts"].includes(part.toLowerCase()))) fail("protected_path");
      this.checkRoot();
      let absolute = this.root, stat: Stats | null = lstatSync(this.root);
      const parts = path === "." ? [] : path.split("/");
      for (let i = 0; i < parts.length; i++) {
        absolute = join(absolute, parts[i]);
        try { stat = lstatSync(absolute); }
        catch (error) {
          if (!missing(error)) throw error;
          if (!options.allowMissing) fail("not_found");
          stat = null;
          absolute = resolve(absolute, ...parts.slice(i + 1));
          break;
        }
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) fail("unsafe_link");
        if (pathKey(realpathSync.native(absolute)) !== pathKey(absolute) || !contained(this.root, absolute)) fail("outside_workspace");
        if (i < parts.length - 1 && !stat.isDirectory()) fail("not_directory");
      }
      if (!contained(this.root, absolute)) fail("outside_workspace");
      return { path, absolute, stat };
    });
  }
}

/** Check every ancestor of an artifact location; callers create missing components individually. */
export function checkAbsoluteDirectory(path: string): void {
  if (!isAbsolute(path)) fail("artifact_location");
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unsafe_link");
    if (pathKey(realpathSync.native(current)) !== pathKey(current)) fail("path_changed");
  }
}
