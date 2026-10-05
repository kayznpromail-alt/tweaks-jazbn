import type { RequestAttemptStatus, RunStatus, ToolExecutionStatus, Usage } from "../types";
import type { SafeAgentError } from "./errors";
import type { ContextCompactionReport } from "./context-budget";

export type AgentPhase = "preparing_context" | "requesting_model" | "validating_calls" | "repairing_arguments" | "awaiting_approval"
  | "executing_tools" | "recording_results" | "completed" | "failed" | "interrupted" | "recovery_required";
export type AgentEvent = { runId: string } & (
  | ({ type: "context_budget" } & import("./context-usage").ContextUsage)
  | { type: "subagent"; id: string; model: string; title: string; prompt: string; taskId?: string; status: "running" | "completed" | "failed" | "interrupted"; text: string; evidence?: import("../tools/explorer").ExplorerEvidence[]; requests?: number; error?: { code: string; message: string }; repairs?: number; phase?: import("../tools/explorer").ExplorerPhase; handoff?: import("../tools/explorer").ExplorerHandoff }
  | { type: "phase"; phase: AgentPhase }
  | { type: "validation_repair"; requestId: string; attempt: number; exhausted: boolean; issues: import("../api/tool-validation").ToolValidationIssue[] }
  | { type: "context_compacted"; report: ContextCompactionReport }
  | { type: "request"; requestId: string; sequence: number; status: RequestAttemptStatus; usage?: Usage }
  | { type: "tool"; requestId: string; toolId: string; name: string; status: ToolExecutionStatus }
  | { type: "tool_draft"; requestId: string; index: number; name: string; preview: string; bytes: number; files?: import("./draft").DraftFile[] }
  | { type: "output"; requestId: string; text: string; truncated: boolean; partial?: boolean; replace?: boolean }
  | { type: "finished"; status: RunStatus; error?: SafeAgentError }
);
