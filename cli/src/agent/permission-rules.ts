import { readFileSync, lstatSync } from "node:fs";
import { canonical } from "./data";
import { AgentSanitizer } from "./data";
import type { JsonObject } from "../types";
import type { AgentTool } from "./registry";
export interface PermissionRule { project: string; tool: string; version: string; decision: "allow" | "deny"; args: JsonObject }
/** host-owned exact argument rules include every path, argv, cwd and environment value. */
export function loadPermissionRules(path: string): PermissionRule[] {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) throw new Error("invalid permission rules");
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(value) || value.length > 128) throw new Error("invalid permission rules");
    for (const rule of value) {
      if (!rule || Object.keys(rule).sort().join() !== "args,decision,project,tool,version" || !["allow", "deny"].includes(rule.decision)
        || ![rule.project, rule.tool, rule.version].every((item) => typeof item === "string" && item.length > 0)
        || !rule.args || typeof rule.args !== "object" || Array.isArray(rule.args)) throw new Error("invalid permission rules");
      new AgentSanitizer().exact(rule, 65536);
    }
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export function matchingRule(rules: readonly PermissionRule[], project: string, tool: AgentTool, args: JsonObject) {
  const matches = rules.filter((rule) => rule.project === project && rule.tool === tool.name && rule.version === tool.version && canonical(rule.args) === canonical(args));
  return matches.some((rule) => rule.decision === "deny") ? "deny" : matches.some((rule) => rule.decision === "allow") ? "allow" : undefined;
}
