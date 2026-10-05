import { isAbsolute, relative, resolve } from "node:path";
import type { JsonObject } from "../types";
import { contained, projectPath } from "../workspace/paths";
import { fail } from "../workspace/errors";

/** accept familiar spelling; actual access remains fenced by workspace paths. */
export function fileToolPath(value: unknown, allowRoot = false): string {
  if (typeof value !== "string" || value.length > 2048 || !value.isWellFormed()
    || /[\x00-\x1f\x7f-\x9f]/.test(value)) fail("invalid_path");
  let path = value.replace(/\\/g, "/");
  if (path.startsWith("//")) fail("invalid_path");
  while (path.startsWith("./")) path = path.slice(2);
  const prefix = /^[a-z]:\//i.test(path) ? path.slice(0, 3) : path.startsWith("/") ? "/" : "";
  let tail = path.slice(prefix.length).replace(/\/+$/, "");
  // parent navigation is classified against the selected root before any io.
  if (!prefix) while (tail === ".." || tail.startsWith("../")) tail = tail === ".." ? "" : tail.slice(3);
  projectPath(tail || (allowRoot ? "." : ""), allowRoot);
  return prefix + path.slice(prefix.length).replace(/\/+$/, "") || ".";
}

export function relativeFileToolPath(root: string, value: unknown, allowRoot = false): string {
  const path = fileToolPath(value, allowRoot);
  if (/^[a-z]:\//i.test(path) && process.platform !== "win32") fail("outside_workspace");
  if (path.startsWith("/") && process.platform === "win32") fail("invalid_path");
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!contained(root, absolute)) fail("outside_workspace");
  // do not collapse a parent traversal through an unchecked directory/link.
  if (path.split("/").includes("..")) fail("invalid_path");
  return projectPath(relative(root, absolute).replace(/\\/g, "/") || ".", allowRoot);
}

/** resolve a fresh copy; retain original proposal/approval arguments verbatim. */
export function fileToolArguments(root: string, name: string, args: Readonly<JsonObject>): JsonObject {
  const copy = structuredClone(args) as JsonObject;
  if (copy.path !== undefined) copy.path = relativeFileToolPath(root, copy.path, name !== "read_file");
  if (name === "prepare_change") {
    for (const operation of copy.operations as JsonObject[]) {
      operation.path = relativeFileToolPath(root, operation.path);
      if (operation.to !== undefined) operation.to = relativeFileToolPath(root, operation.to);
    }
  }
  return copy;
}
