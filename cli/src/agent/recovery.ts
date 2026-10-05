import { randomUUID } from "node:crypto";
import { AgentSanitizer } from "./data";
import { AgentError } from "./errors";
import type { AgentContinueInput } from "./runner";
import type { DurableStore } from "../types";

/** Close observed local outcomes without provider calls or current registry validation. */
export function resolveStoppedRun(store: DurableStore, runId: string, resolutions: NonNullable<AgentContinueInput["resolutions"]>,
  confirmStopped: () => void, secrets: readonly string[] = []): void {
  const before = store.loadRun(runId);
  if (!before) throw new AgentError("invalid_input");
  if (before.leaseExpiresAt && Date.parse(before.leaseExpiresAt) > Date.now()) throw new AgentError("lease_conflict");
  const unknown = store.listToolExecutions(runId).filter(tool => ["executing","outcome_unknown"].includes(tool.status));
  if (unknown.length !== resolutions.length || new Set(resolutions.map(item => item.toolId)).size !== unknown.length
    || resolutions.some(item => !unknown.some(tool => tool.id === item.toolId) || !["succeeded","failed"].includes(item.status))) throw new AgentError("recovery_required");
  new AgentSanitizer(secrets).exact(resolutions, 1024 * 1024);
  confirmStopped(); // Includes the independent workspace PID check, before any durable mutation.
  let run = store.recoverRun(runId, `recovery-${randomUUID()}`, 30000, before.revision);
  if (!run.ownerId) return;
  const lease = { ownerId: run.ownerId, token: run.leaseToken! };
  for (const item of resolutions) {
    const tool = store.loadToolExecution(item.toolId)!;
    store.transitionToolExecution(item.toolId, item.status, { revision: tool.revision, result: item.result }, lease);
  }
  run = store.loadRun(runId)!;
  if (run.status === "recovery_required") run = store.updateRun({ ...run, status: "interrupted" }, lease);
  store.releaseRunLease(runId, lease, run.revision);
}
