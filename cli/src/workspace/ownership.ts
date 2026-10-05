import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactRoot, ensureDirectory, readPrivate } from "./artifacts";
import { aborted, fail, missing, safely } from "./errors";
import { checkAbsoluteDirectory, identity, pathKey, WorkspacePaths } from "./paths";
import { hashText, retainable } from "./text";

export interface WorkspaceLeaseInput { project: string; runId: string; ownerId: string; signal: AbortSignal }
export interface WorkspaceLease { check(): void; release(): void }
export interface WorkspaceLockRecord { version: 1; projectHash: string; runId: string; ownerId: string; token: string; pid: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** All instances must share artifactDir. Locks never expire or get reclaimed automatically.
 * recoverStale requires the observed UUID token, an explicit stopped confirmation AND ESRCH.
 * PID reuse or uncertain liveness refuses recovery. A crashed maintenance guard requires manual
 * offline cleanup with every CLI stopped; there is deliberately no unsafe force-unlink API. */
export class WorkspaceLeaseManager {
  constructor(private readonly artifactDir: string, private readonly scope?: string) {}
  private location(project: string): { paths: WorkspacePaths; lock: string; guard: string; projectHash: string } {
    const paths = new WorkspacePaths(project), root = artifactRoot(this.artifactDir, paths.root);
    const directory = join(root, "workspace-locks");
    ensureDirectory(directory);
    const projectHash = hashText(pathKey(paths.root)), lock = join(directory, `${projectHash}${this.scope ? `.${hashText(this.scope)}` : ""}.lock`);
    return { paths, lock, guard: `${lock}.guard`, projectHash };
  }
  private guarded<T>(guard: string, action: () => T): T {
    return safely(() => {
      checkAbsoluteDirectory(join(guard, ".."));
      let fd: number;
      try { fd = openSync(guard, "wx", 0o600); } catch { fail("lease_conflict"); }
      const stamp = identity(lstatSync(guard));
      try { return action(); }
      finally {
        closeSync(fd);
        const stat = lstatSync(guard);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || identity(stat) !== stamp) fail("lease_lost");
        unlinkSync(guard);
      }
    });
  }
  private read(lock: string, projectHash: string): WorkspaceLockRecord {
    try {
      const record = JSON.parse(readPrivate(lock, 8192).toString("utf8")) as WorkspaceLockRecord;
      if (!record || typeof record !== "object" || Object.keys(record).sort().join() !== "ownerId,pid,projectHash,runId,token,version"
        || record.version !== 1 || record.projectHash !== projectHash || !uuid.test(record.token)
        || !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.ownerId !== "string" || typeof record.runId !== "string") fail("lease_lost");
      retainable(record, [], 8192);
      return record;
    } catch { fail("lease_lost"); }
  }
  async acquire(input: WorkspaceLeaseInput): Promise<WorkspaceLease> {
    return safely(() => {
      aborted(input.signal);
      if (![input.runId, input.ownerId].every((id) => typeof id === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id))) fail("invalid_input");
      const { paths, lock, guard, projectHash } = this.location(input.project);
      const record: WorkspaceLockRecord = { version: 1, projectHash, runId: input.runId, ownerId: input.ownerId, token: randomUUID(), pid: process.pid };
      const stamp = this.guarded(guard, () => {
        aborted(input.signal);
        let fd: number;
        try { fd = openSync(lock, "wx", 0o600); } catch { fail("lease_conflict"); }
        try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
        return identity(lstatSync(lock));
      });
      let released = false;
      const verify = () => {
        paths.checkRoot();
        const current = this.read(lock, projectHash), stat = lstatSync(lock);
        if (released || identity(stat) !== stamp || current.token !== record.token || current.pid !== record.pid
          || current.runId !== record.runId || current.ownerId !== record.ownerId) fail("lease_lost");
      };
      const lease: WorkspaceLease = {
        check: () => safely(() => { aborted(input.signal); verify(); }),
        release: () => {
          if (released) return;
          this.guarded(guard, () => { verify(); unlinkSync(lock); released = true; });
        },
      };
      // Aborting a live effect does not release ownership; the runner releases after cleanup.
      if (input.signal.aborted) { lease.release(); fail("aborted"); }
      return lease;
    });
  }
  inspect(project: string): WorkspaceLockRecord | null {
    return safely(() => {
      const { lock, projectHash } = this.location(project);
      try { lstatSync(lock); } catch (error) { if (missing(error)) return null; throw error; }
      return this.read(lock, projectHash);
    });
  }
  recoverStale(input: { project: string; token: string; confirmedStopped: true }): void {
    safely(() => {
      if (input.confirmedStopped !== true || !uuid.test(input.token)) fail("invalid_input");
      const { lock, guard, projectHash } = this.location(input.project);
      this.guarded(guard, () => {
        const record = this.read(lock, projectHash);
        if (record.token !== input.token) fail("lease_lost");
        try { process.kill(record.pid, 0); fail("recovery_required"); }
        catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") fail("recovery_required");
        }
        if (this.read(lock, projectHash).token !== input.token) fail("lease_lost");
        // Quarantine evidence under an exclusive cooperative guard; do not delete a new owner's lock.
        renameSync(lock, `${lock}.recovered-${randomUUID()}`);
      });
    });
  }
}
