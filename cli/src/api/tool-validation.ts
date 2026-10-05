import { ApiError } from "./errors";
import type { ToolCall, WireMessage } from "../types";

export interface ToolValidationIssue {
  tool: string; callId: string; stage: "json" | "schema" | "contract";
  path: string; code: "invalid_json" | "type" | "required" | "additional_property" | "enum" | "constraint";
  expected: string; receivedType: string; retryable: true;
}
export const MAX_TOOL_REPAIRS = 2;
export class ToolArgumentError extends ApiError {
  constructor(readonly detail: Omit<ToolValidationIssue, "tool" | "callId" | "retryable">) { super("invalid_tool_arguments"); }
}
export class ToolBatchValidationError extends ApiError {
  constructor(readonly issues: ToolValidationIssue[], readonly calls?: ToolCall[]) { super("invalid_tool_arguments"); }
}
export function argumentIssue(error: unknown, tool: string, callId: string): ToolValidationIssue {
  return { tool, callId, ...(error instanceof ToolArgumentError ? error.detail : {
    stage: "contract" as const, path: "$", code: "constraint" as const,
    expected: "arguments satisfying the documented tool constraints", receivedType: "object",
  }), retryable: true };
}
export function issueSummary(issue: ToolValidationIssue): string {
  return `${issue.tool} at ${issue.path}: expected ${issue.expected}; received ${issue.receivedType}. not executed.`;
}
/** Rejected payloads may contain entire files. Retain only correlation and diagnostics,
 * never their values; these messages are rejection evidence, not executable proposals. */
export function repairMessages(error: ToolBatchValidationError): WireMessage[] {
  if(error.issues.some(issue=>issue.receivedType==='unfinished_tasks'))return [{role:'user',content:
    'The host task plan still contains pending or in_progress steps. Your last response did not finish the task. Continue the remaining authorized work using structured tool calls. Read the current host task state and reuse completed results; never repeat completed operations. Update task status with actual supporting tool evidence. Do not delete unfinished steps or claim success merely to close the plan. If work cannot continue safely or needs user input, mark the affected steps blocked and explain the concrete blocker and what is needed. Do not bypass permissions or safety constraints. Use fresh call ids.'}];
  const truncated = error.issues.some(issue => issue.stage === "contract" && issue.receivedType === "truncated");
  const missingOperations = error.issues.some(issue => issue.tool === "prepare_change" && issue.path === "$.operations" && issue.code === "required");
  const textCall=error.issues.some(issue=>issue.receivedType==='text_tool_call');
  const feedback = `Correct the rejected tool arguments. Nothing in this batch was executed. ${error.issues.map(issueSummary).join(" ")} Do not repeat completed operations. Use fresh call ids.`
    + (textCall ? ' Your response ended with a tool invocation written as plain text. No tool was dispatched. Continue the current task by returning an actual structured tool_calls array through the API, with type function, function.name and function.arguments containing a JSON object matching the supplied schema. Do not print <tool_call> tags, XML, or a code block as a substitute. Do not merely announce that you will act. If no tool is needed, provide the actual final answer or explain the blocker without claiming unfinished work is complete.' : '')
    + (missingOperations ? ' prepare_change requires a top-level "operations" array containing at least one operation object. Each operation needs "type" and "path", plus the fields required by that operation in the tool definition. Put changes inside this array, not at the top level. Use actual task paths and content; for existing files use the expectedHash from read_file. If those inputs are missing, call read_file first. Return one small complete tool call; do not guess file contents or hashes.' : "")
    + (error.calls ? " Empty argument objects in the rejected history are redacted placeholders, not valid examples; construct corrected arguments from the tool definition and actual task context." : "")
    + (truncated ? " The previous response exceeded the output budget, not the input context. On the next response return exactly one small tool call, no explanatory text. Keep new file content below 2000 characters; create a small initial file, then extend it with separate exact replacements in subsequent turns. Do not resend a complete large file or combine unrelated edits. Close all JSON strings and objects before stopping." : "");
  if (!error.calls) return [{ role: "user", content: feedback }];
  return [{ role: "assistant", content: "Rejected batch; argument values omitted from history. No tools executed.",
    tool_calls: error.calls.map(call => ({ ...call, function: { name: call.function.name, arguments: "{}" } })) },
    ...error.calls.map(call => ({ role: "tool" as const, tool_call_id: call.id,
      content: JSON.stringify({ ok: false, status: "rejected_before_execution",
        error: error.issues.find(issue => issue.callId === call.id) ?? { code: "batch_rejected", message: "not executed because another call requires correction" } }) })),
    { role: "user", content: feedback }];
}
