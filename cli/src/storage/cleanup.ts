import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ArtifactStore, readPrivate } from "../workspace/artifacts";
import { WorkspaceLeaseManager } from "../workspace/ownership";
import type { DurableStore } from "../types";

export interface CleanupPreview { digest: string; bytes: number; retainedBytes: number; files: { name: string; bytes: number; hash: string }[] }
/** only finalized process logs with no remaining run are disposable; all change/undo records stay. */
export function previewCleanup(store: DurableStore, root: string, project: string): CleanupPreview {
  if (new WorkspaceLeaseManager(root).inspect(project)) throw new Error("workspace is owned; cleanup unavailable");
  const runs = store.listRuns(), artifacts = new ArtifactStore(root, project), files: CleanupPreview["files"] = [];
  if (runs.some((run) => run.project === project && (run.ownerId || ["running", "awaiting_approval", "recovery_required"].includes(run.status)))) throw new Error("active or recoverable work must be resolved first");
  let retainedBytes = 0;
  for (const name of readdirSync(artifacts.directory)) {
    const info = lstatSync(join(artifacts.directory, name));
    if (info.isFile()) retainedBytes += info.size;
    const match = /^process-([a-f0-9-]{36})\.(stdout|stderr)\.txt$/.exec(name);
    if (!match || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || Date.now() - info.mtimeMs < 7 * 86400000) continue;
    const metadata = artifacts.read(`process-job-${match[1]}.json`) as any;
    if (!metadata?.result || metadata.result.cleanup !== "confirmed" || metadata.result.status === "running" || runs.some((run) => run.id === metadata.result.ownerId)) continue;
    const content = readPrivate(join(artifacts.directory, name), 16 * 1024 * 1024);
    files.push({ name, bytes: content.length, hash: createHash("sha256").update(content).digest("hex") });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return { files, bytes, retainedBytes: retainedBytes - bytes, digest: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
export async function applyCleanup(store: DurableStore, root: string, project: string, digest: string) {
  const preview = previewCleanup(store, root, project);
  if (preview.digest !== digest) throw new Error("cleanup preview changed");
  const lease = await new WorkspaceLeaseManager(root).acquire({ project, runId: "storage-cleanup", ownerId: "storage-cleanup", signal: new AbortController().signal });
  let removedBytes = 0;
  try {
    if (store.listRuns().some((run) => run.project === project && (run.ownerId || ["running", "awaiting_approval", "recovery_required"].includes(run.status)))) throw new Error("work started after preview");
    const artifacts = new ArtifactStore(root, project);
    for (const file of preview.files) {
      lease.check();
      const path = join(artifacts.directory, file.name), data = readPrivate(path, 16 * 1024 * 1024);
      if (createHash("sha256").update(data).digest("hex") !== file.hash) throw new Error("cleanup file changed");
      unlinkSync(path); removedBytes += file.bytes;
    }
    return { removedBytes };
  } finally { await lease.release(); }
}
