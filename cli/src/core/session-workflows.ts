import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { AgentSanitizer } from "../agent/data";
import type { DurableStore, Store } from "../types";

export class SessionWorkflows {
  constructor(private store: Store & DurableStore, private secrets: readonly string[] = []) {}
  private session(id: string) {
    const session = this.store.loadSession(id);
    if (!session) throw new Error("session unavailable");
    if (this.store.listRuns(id).some((run) => run.ownerId || ["running", "awaiting_approval", "recovery_required"].includes(run.status))) throw new Error("session has active or unresolved work");
    return session;
  }
  rename(id: string, title: string) {
    if (!title.trim() || title.length > 160 || /[\x00-\x1f]/.test(title)) throw new Error("invalid session title");
    const session = this.session(id); session.title = new AgentSanitizer(this.secrets).text(title.trim());
    this.store.saveSession(session); return session;
  }
  export(id: string, destination: string) {
    const session = this.session(id), safe = new AgentSanitizer(this.secrets);
    const runs = this.store.listRuns(id).map((run) => ({ run,
      requests: this.store.listRequestAttempts(run.id), tools: this.store.listToolExecutions(run.id) }));
    // exclude request contexts, prompts and arbitrary output in diagnostic mode only; this is explicit transcript export.
    const body = JSON.stringify(safe.result({ version: 1, exportedAt: new Date().toISOString(), session, runs }, 32 * 1024 * 1024), null, 2);
    if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw new Error("export exceeds 32 mib");
    JSON.parse(body);
    writeFileSync(destination, body, { flag: "wx", mode: 0o600 }); return destination;
  }
  fork(id: string) {
    const source = this.session(id), target = this.store.createSession(source.project, source.model);
    if(source.privateMode)target.privateMode=structuredClone(source.privateMode);
    if(source.instructionSources)target.instructionSources=structuredClone(source.instructionSources);
    target.title = source.title.slice(0, 140) + " (fork)";
    target.messages = structuredClone(source.messages).map((message) => ({ ...message, id: randomUUID(), status: message.status === "streaming" ? "interrupted" : message.status }));
    target.messages.unshift({ id: randomUUID(), role: "user", status: "complete", createdAt: new Date().toISOString(),
      content: `[session fork: source ${source.id}, revision ${source.revision}; copied transcript only. original tool journal and undo remain in the source session.]` });
    this.store.saveSession(target); return target;
  }
  diagnostics(destination: string) {
    const runs = this.store.listRuns();
    const body = { version: 1, runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
      runs: runs.map((run) => ({ id: run.id, status: run.status,
        requests: this.store.listRequestAttempts(run.id).map((request) => ({ id: request.id, status: request.status, error: request.error })),
        tools: this.store.listToolExecutions(run.id).map((tool) => ({ id: tool.id, name: tool.name, status: tool.status, error: tool.error })) })) };
    writeFileSync(destination, new AgentSanitizer(this.secrets).text(JSON.stringify(body, null, 2)), { flag: "wx", mode: 0o600 }); return destination;
  }
}
