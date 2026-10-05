import { AgentSanitizer, boundedText, digest } from "../agent/data";
import { record, usage as validateUsage } from "../storage/execution-validation";
import type { JsonValue, Usage } from "../types";
import { ArtifactStore } from "../workspace/artifacts";
import { fail } from "../workspace/errors";
import { WorkspacePaths } from "../workspace/paths";
import { hashText } from "../workspace/text";

export type DelegatedRequest = {
  error?: { code: string; message: string };
  repairs?: number;
  validation?: import("../api/tool-validation").ToolValidationIssue[];
  evidence?: import("./explorer").ExplorerEvidence[];
  requests?: number;
  phase?: import("./explorer").ExplorerPhase;
  handoff?: import("./explorer").ExplorerHandoff;
  id: string;
  model: string;
  title: string;
  prompt: string;
  taskId?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  text: string;
  usage?: Usage;
};

const controls = /[\x00-\x1f\x7f-\x9f]/;
const fields = ["id", "model", "title", "prompt", "taskId", "status", "text", "usage", "evidence", "requests", "error", "repairs", "validation", "phase", "handoff"];
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && value.isWellFormed();
const label = (value: unknown): value is string => text(value, 4096) && value.trim().length > 0 && !controls.test(value);

/** Signed snapshots are scoped to a workspace and a hashed tool id, never a prompt or credential. */
export class DelegationJournal {
  private readonly artifacts: ArtifactStore;
  private readonly sanitizer: AgentSanitizer;

  constructor(artifactDir: string, project: string, secrets: readonly string[] = []) {
    this.artifacts = new ArtifactStore(artifactDir, new WorkspacePaths(project).root);
    this.sanitizer = new AgentSanitizer(secrets);
  }

  private key(toolId: string): string {
    if (!label(toolId)) fail("invalid_input");
    return hashText(toolId);
  }

  private agents(value: unknown): DelegatedRequest[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 3
      || Reflect.ownKeys(value).length !== value.length + 1) fail("invalid_input");
    const ids = new Set<string>();
    const agents = Array.from({ length: value.length }, (_, index): DelegatedRequest => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("invalid_input");
      const agent: unknown = descriptor.value;
      if (!record(agent) || Object.keys(agent).some((key) => !fields.includes(key))
        || !label(agent.id) || ids.has(agent.id) || !label(agent.model)
        || !text(agent.title, 160) || controls.test(agent.title) || !text(agent.prompt, 48_000)
        || !text(agent.text, 32 * 1024) || Buffer.byteLength(agent.text) > 32 * 1024
        || !["running", "completed", "failed", "interrupted"].includes(agent.status as string)
        || (agent.taskId !== undefined && (typeof agent.taskId !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(agent.taskId)))) fail("invalid_input");
      // Identifiers must remain stable; redaction must not merge distinct requests/tasks.
      if ([agent.id, agent.model, agent.taskId].some((item) => typeof item === "string" && this.sanitizer.text(item) !== item)) fail("unsafe_data");
      ids.add(agent.id);
      if (agent.phase !== undefined && (typeof agent.phase !== "string" || !["requesting_model", "executing_tools", "repairing_arguments"].includes(agent.phase))) fail("invalid_input");
      if (agent.handoff !== undefined && (typeof agent.handoff !== "string" || !["requests", "tools", "context"].includes(agent.handoff))) fail("invalid_input");
      if (agent.error !== undefined && (!record(agent.error) || Object.keys(agent.error).sort().join() !== "code,message"
        || !label(agent.error.code) || !text(agent.error.message, 8192))) fail("invalid_input");
      if (agent.repairs !== undefined && (!Number.isSafeInteger(agent.repairs) || Number(agent.repairs) < 0 || Number(agent.repairs) > 2)) fail("invalid_input");
      if (agent.validation !== undefined && (!Array.isArray(agent.validation) || agent.validation.length > 64
        || agent.validation.some(issue => !record(issue) || !label(issue.tool) || !label(issue.callId) || !label(issue.path)
          || !text(issue.expected,4096) || !label(issue.receivedType) || issue.retryable !== true))) fail("invalid_input");
      if (agent.requests !== undefined && (!Number.isSafeInteger(agent.requests) || Number(agent.requests) < 0 || Number(agent.requests) > 6)) fail("invalid_input");
      if (agent.evidence !== undefined) {
        if (!Array.isArray(agent.evidence) || agent.evidence.length > 24) fail("invalid_input");
        for (const item of agent.evidence) {
          if (!record(item) || Object.keys(item).some((key) => !["callId", "name", "args", "status", "result"].includes(key))
            || !label(item.callId) || !["read_file", "list_files", "glob_files", "search_text"].includes(String(item.name))
            || !["executing", "succeeded", "failed"].includes(String(item.status)) || !record(item.args)) fail("invalid_input");
        }
        this.sanitizer.exact(agent.evidence, 512 * 1024);
      }
      let usage: Usage | undefined;
      if (agent.usage !== undefined) {
        try { validateUsage(agent.usage); } catch { fail("invalid_input"); }
        usage = { inputTokens: agent.usage.inputTokens, outputTokens: agent.usage.outputTokens, totalTokens: agent.usage.totalTokens,
          ...(agent.usage.totalSource === undefined ? {} : { totalSource: agent.usage.totalSource }),
          ...(agent.usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: agent.usage.cachedInputTokens }) };
      }
      return {
        ...(agent.phase === undefined ? {} : { phase: agent.phase as DelegatedRequest["phase"] }),
        ...(agent.handoff === undefined ? {} : { handoff: agent.handoff as DelegatedRequest["handoff"] }),
        ...(agent.error === undefined ? {} : { error: structuredClone(agent.error) as DelegatedRequest["error"] }),
        ...(agent.repairs === undefined ? {} : { repairs: agent.repairs as number }),
        ...(agent.validation === undefined ? {} : { validation: structuredClone(agent.validation) as DelegatedRequest["validation"] }),
        ...(agent.evidence === undefined ? {} : { evidence: structuredClone(agent.evidence) as DelegatedRequest["evidence"] }),
        ...(agent.requests === undefined ? {} : { requests: agent.requests as number }),
        id: agent.id, model: agent.model,
        title: this.sanitizer.text(agent.title).slice(0, 160).toWellFormed(),
        prompt: this.sanitizer.text(agent.prompt).slice(0, 48_000).toWellFormed(),
        ...(agent.taskId === undefined ? {} : { taskId: agent.taskId as string }),
        status: agent.status as DelegatedRequest["status"],
        text: boundedText(this.sanitizer.text(agent.text), 32 * 1024),
        ...(usage === undefined ? {} : { usage }),
      };
    });
    this.sanitizer.exact(agents, 2 * 1024 * 1024);
    return agents;
  }

  save(toolId: string, agents: DelegatedRequest[]): void {
    const tool = this.key(toolId), name = `delegation-${tool}.json`;
    const body = { version: 1, tool, agents: this.agents(agents) };
    const payload = { ...body, digest: digest(body as unknown as JsonValue) } as unknown as JsonValue;
    if (this.artifacts.exists(name)) this.artifacts.replace(name, payload);
    else this.artifacts.create(name, payload);
  }

  load(toolId: string): DelegatedRequest[] {
    const tool = this.key(toolId), name = `delegation-${tool}.json`;
    if (!this.artifacts.exists(name)) return [];
    try {
      const payload = this.artifacts.read(name);
      if (!record(payload) || Object.keys(payload).sort().join() !== "agents,digest,tool,version"
        || payload.version !== 1 || payload.tool !== tool || typeof payload.digest !== "string") fail("artifact_corrupt");
      const agents = this.agents(payload.agents);
      if (payload.digest !== digest({ version: 1, tool, agents: payload.agents } as JsonValue)) fail("artifact_corrupt");
      return agents;
    } catch { fail("artifact_corrupt"); }
  }
}
