import type { JsonObject } from "../types";
import type { AgentTool, ToolEffect, ToolScope } from "./registry";
import { digest, freeze } from "./data";
import { AgentError } from "./errors";
import { matchingRule, type PermissionRule } from "./permission-rules";

export type PermissionMode = "plan" | "review" | "trusted" | "auto" | "bypass";
export interface PermissionBinding {
  readonly name: string;
  readonly version: string;
  readonly schemaVersion: string;
  readonly argumentsDigest: string;
  readonly project: string;
  readonly scope: ToolScope;
  readonly effect: ToolEffect;
  readonly descriptorDigest: string;
}
export interface PermissionDecision {
  readonly action: "allow" | "deny" | "ask";
  readonly binding: PermissionBinding;
  readonly approvalScope: string;
}
export interface ApprovalRequest extends PermissionDecision {
  readonly runId: string;
  readonly requestId: string;
  readonly toolId: string;
  readonly args: Readonly<JsonObject>;
}
export type ApprovalCallback = (request: ApprovalRequest, signal: AbortSignal) => Promise<"allow" | "deny">;

/** only trusted host metadata enters this policy; model fields cannot grant permission. */
export class PermissionPolicy {
  constructor(readonly mode: PermissionMode = "review", readonly rules: readonly PermissionRule[] = []) {
    if (!["plan", "review", "trusted", "auto", "bypass"].includes(mode)) throw new AgentError("invalid_input");
    this.rules = freeze(structuredClone(rules));
    Object.freeze(this);
  }

  decide(tool: AgentTool, args: JsonObject, project: string): PermissionDecision {
    const binding: PermissionBinding = { name: tool.name, version: tool.version, schemaVersion: tool.schemaVersion,
      argumentsDigest: digest(args), project, scope: tool.scope, effect: tool.effect,
      descriptorDigest: digest({ definition: tool.definition, timeoutMs: tool.timeoutMs ?? 120_000 } as unknown as JsonObject) };
    const read = tool.effect === "read" && tool.scope === "project";
    const rule = matchingRule(this.rules, project, tool, args);
    const action = this.mode === "bypass" ? "allow" : rule === "deny" ? "deny" : this.mode !== "plan" && rule === "allow" ? "allow"
      : this.mode === "auto" ? (tool.scope === "project" && ["read", "write", "execute"].includes(tool.effect) ? "allow" : "ask")
      : this.mode === "plan" ? (read ? "allow" : "deny")
      : read ? "allow" : this.mode === "review" || tool.effect === "destructive" || tool.effect === "network" || tool.scope !== "project" ? "ask" : "allow";
    return freeze({ action, binding, approvalScope: `permission-v1:${digest(binding as unknown as JsonObject)}` });
  }
}
