import type { JsonObject, JsonValue, ToolDefinition } from "../types";
import { parseToolArguments, validateArguments, validateTools } from "../api/tool-schema";
import { EXECUTABLE_ARGUMENT_BYTES } from "../api/limits";
import { AgentError } from "./errors";
import { AgentSanitizer, canonical, digest, freeze } from "./data";
import { ToolArgumentError } from "../api/tool-validation";
import { validateToolContract } from "../tools/contracts";

export type ToolEffect = "read" | "execute" | "write" | "network" | "destructive";
export type ToolScope = "project" | "external" | "remote";
export interface ToolInvocationContext {
  readonly runId: string;
  readonly requestId: string;
  readonly toolId: string;
  readonly project: string;
  readonly signal: AbortSignal;
}

export interface AgentTool {
  readonly name: string;
  readonly version: string;
  readonly schemaVersion: string;
  readonly definition: ToolDefinition;
  readonly effect: ToolEffect;
  readonly scope: ToolScope;
  /** Abort is requested at this deadline; execute must settle only after cleanup. Default 120s. */
  readonly timeoutMs?: number;
  /** additional validation only; arguments cannot be rewritten after approval. */
  readonly validate: (args: Readonly<JsonObject>) => boolean;
  readonly execute: (args: Readonly<JsonObject>, context: ToolInvocationContext) => JsonValue | Promise<JsonValue>;
}

export class ToolRegistry {
  private readonly entries = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: AgentTool): void {
    try {
      if (this.entries.has(tool.name)) throw new AgentError("duplicate_tool");
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(tool.version) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(tool.schemaVersion)
        || !["read", "execute", "write", "network", "destructive"].includes(tool.effect)
        || !["project", "external", "remote"].includes(tool.scope)
        || (tool.timeoutMs !== undefined && (!Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs < 1 || tool.timeoutMs > 86_400_000))
        || typeof tool.validate !== "function" || typeof tool.execute !== "function") throw new AgentError("invalid_registry");
      const definitions = validateTools([...this.definitions(), tool.definition]);
      const definition = JSON.parse(canonical(definitions.at(-1)! as unknown as JsonValue)) as ToolDefinition;
      if (tool.name !== definition.function.name) throw new AgentError("invalid_registry");
      new AgentSanitizer().exact(definitions, 256 * 1024);
      this.entries.set(tool.name, freeze({ name: tool.name, version: tool.version, schemaVersion: tool.schemaVersion,
        effect: tool.effect, scope: tool.scope, ...(tool.timeoutMs !== undefined ? { timeoutMs: tool.timeoutMs } : {}),
        definition, validate: tool.validate, execute: tool.execute }));
    } catch (error) {
      throw new AgentError(error instanceof AgentError && error.code === "duplicate_tool" ? "duplicate_tool" : "invalid_registry");
    }
  }

  definitions(): ToolDefinition[] {
    return [...this.entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map((tool) => structuredClone(tool.definition));
  }

  snapshot(): ToolRegistry { return new ToolRegistry([...this.entries.values()]); }

  fingerprint(): string {
    return digest([...this.entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((tool) => ({
      name: tool.name, version: tool.version, schemaVersion: tool.schemaVersion, definition: tool.definition,
      effect: tool.effect, scope: tool.scope, timeoutMs: tool.timeoutMs ?? 120_000,
    })) as unknown as JsonValue);
  }

  get(name: string): AgentTool {
    const tool = this.entries.get(name);
    if (!tool) throw new AgentError("unknown_tool");
    return tool;
  }

  validate(name: string, argumentsText: string): { tool: AgentTool; args: JsonObject } {
    const tool = this.get(name);
    try {
      if (Buffer.byteLength(argumentsText) > EXECUTABLE_ARGUMENT_BYTES) throw new Error();
      const args = parseToolArguments(argumentsText, "invalid_tool_arguments");
      validateArguments(args, tool.definition.function.parameters);
      validateToolContract(name, args);
      freeze(args);
      if (tool.validate(args) !== true) throw new ToolArgumentError({stage:"contract",path:"$",code:"constraint",expected:"arguments satisfying the documented tool constraints; inspect the selected operation and its fields",receivedType:"object"});
      return { tool, args };
    } catch(error) { if(error instanceof ToolArgumentError)throw error; throw new AgentError("invalid_tool_arguments"); }
  }
}
