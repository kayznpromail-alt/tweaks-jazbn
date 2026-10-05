import { ApiError } from "../api/errors";
import { NEW_CONTEXT_HINT } from "./context-usage";

const messages = {
  jailbreak_not_allowed: "jailbreak access for this model is no longer available. type /jailbreak to disable it and continue.",
  jailbreak_model_mismatch: "jailbreak is not available for this model. type /jailbreak to disable it and continue.",
  jailbreak_revision_changed: "jailbreak instructions changed. type /jailbreak to disable it and start a new request.",
  invalid_input: "invalid agent input.",
  invalid_registry: "invalid tool registry.",
  duplicate_tool: "tool names must be unique.",
  unknown_tool: "the requested tool is not registered.",
  invalid_tool_arguments: "tool arguments failed validation.",
  invalid_tool_call: "invalid or duplicate tool call.",
  permission_denied: "tool permission denied.",
  approval_failed: "tool approval could not be obtained.",
  aborted: "the run was interrupted.",
  timeout: "the operation timed out.",
  tool_failed: "the tool failed.",
  invalid_tool_result: "the tool returned an invalid result.",
  outcome_unknown: "the tool outcome requires explicit recovery.",
  request_limit: "the saved run's request budget was reached. start a new task to continue from the recorded work; this is not the model context limit.",
  tool_limit: "the saved run's tool budget was reached. start a new task to continue from the recorded work.",
  output_limit: "the output limit was reached.",
  context_limit: "the local request storage limit was reached. reduce the current task or attachments; model context usage is unavailable for this unsent request.",
  checkpoint_limit: "the saved task configuration exceeds 1 mib. reduce selected instructions; no model request was sent.",
  instructions_limit: "project AGENTS.md instructions exceed the local instruction limit. reduce the project instruction files; this is not the model context limit.",
  model_context_exceeded: NEW_CONTEXT_HINT,
  repeated_call: "a repeated tool cycle was stopped.",
  repeated_failure: "repeated tool failures were stopped.",
  unsafe_data: "data could not be recorded safely.",
  lease_conflict: "this session already has active or interrupted work. open a new session to start another task in this folder, or use /recover for this session.",
  persistence_failed: "execution state could not be saved. open /diagnostics for the storage code; history is preserved.",
  model_pricing_unavailable: "model pricing is unavailable; no generation was sent. open /diagnostics for the request reference.",
  recovery_required: "work paused: a previous operation needs review. open /recover to inspect it before continuing.",
  registry_changed: "tool contracts changed. use /recover to resolve old local outcomes, then send a new task. history and files are preserved.",
  checkpoint_missing: "this run has no complete response checkpoint for continuation.",
  model_failed: "the model could not finish this response. review the recorded work in /tools before continuing.",
  model_first_response_timeout: "the api did not return a response within the allowed waiting time. completed work is saved; use /retry to try again explicitly.",
  model_request_too_large: "the api rejected the request size after context reduction. reduce the current task or attachments; this is not a model token usage report.",
  model_unauthorized: "the api key is invalid or expired.",
  model_key_expired: "the api key has expired. contact the key owner to renew access.",
  model_key_paused: "the api key is paused. contact the key owner.",
  model_forbidden: "the model is unavailable to this key.",
  model_quota: "the api key quota is exhausted. open /account and contact the key owner about the limit.",
  model_rate_limited: "the api request rate limit was reached.",
  model_concurrency_limited: "too many requests are running. wait for the current work to finish.",
  model_api_error: "the provider reported an error during generation. partial output is saved; inspect /tools before retrying.",
  model_unavailable: "the api is temporarily unavailable.",
  model_network: "the connection ended before an api response arrived. completed work is saved; use /retry or describe how to continue.",
  model_protocol: "the model response did not complete correctly.",
  model_invalid_response: "the api returned an invalid response envelope or usage report (invalid_response).",
  model_empty_response: "the model returned no answer or tool calls. completed tools are saved; use /retry to continue without replaying them.",
  task_blocked: "the task has blocked steps and is not complete. review the model's explanation, then send a new prompt in this chat to continue. completed work is saved.",
  model_invalid_tool_call: "the api returned inconsistent or incomplete tool-call fields (invalid_tool_call).",
  model_unknown_tool: "the model requested a tool absent from this request (unknown_tool).",
  model_invalid_tool_arguments: "the model returned tool arguments that do not match the declared schema (invalid_tool_arguments).",
  model_truncated_stream: "the response stream ended without its completion marker (truncated_stream). partial output is saved.",
  model_output_truncated: "the model reached its output token limit (output_truncated). partial output is saved; incomplete tools were not executed. split large file changes into smaller edits.",
  model_unsupported_tools: "the api returned a legacy or unsupported tool-call format (unsupported_tools).",
} as const;

export type AgentErrorCode = keyof typeof messages;
export interface StorageDiagnostic { code: import("../storage/errors").StorageErrorCode; stage: "acquire_run" | "checkpoint"; nativeCode?: string }
export interface SafeAgentError { code: AgentErrorCode; message: string; storage?: StorageDiagnostic }

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  constructor(code: AgentErrorCode, readonly storage?: StorageDiagnostic) {
    const safe = Object.hasOwn(messages, code) ? code : "model_failed";
    super(messages[safe]);
    this.name = "AgentError";
    this.code = safe;
  }
}

export function safeAgentError(code: AgentErrorCode): SafeAgentError {
  const error = new AgentError(code);
  return { code: error.code, message: error.message };
}

export function modelError(error: unknown): AgentError {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "context_length_exceeded": return new AgentError("model_context_exceeded");
      case "request_too_large": return new AgentError("model_request_too_large");
      case "jailbreak_not_allowed": case "jailbreak_model_mismatch": case "jailbreak_revision_changed": return new AgentError(error.code);
      case "aborted": return new AgentError("aborted");
      case "timeout": return new AgentError("timeout");
      case "first_response_timeout": return new AgentError("model_first_response_timeout");
      case "key_expired": return new AgentError("model_key_expired");
      case "key_paused": return new AgentError("model_key_paused");
      case "unauthorized": return new AgentError("model_unauthorized");
      case "model_forbidden": case "forbidden": return new AgentError("model_forbidden");
      case "quota_exceeded": return new AgentError("model_quota");
      case "concurrency_limited": return new AgentError("model_concurrency_limited");
      case "rate_limited": return new AgentError("model_rate_limited");
      case "api_error": return new AgentError("model_api_error");
      case "network": return new AgentError("model_network");
      case "model_pricing_unavailable": return new AgentError("model_pricing_unavailable");
      case "unavailable": return new AgentError("model_unavailable");
      case "invalid_response": return new AgentError("model_invalid_response");
      case "empty_response": return new AgentError("model_empty_response");
      case "invalid_tool_call": return new AgentError("model_invalid_tool_call");
      case "unknown_tool": return new AgentError("model_unknown_tool");
      case "invalid_tool_arguments": return new AgentError("model_invalid_tool_arguments");
      case "truncated_stream": return new AgentError("model_truncated_stream");
      case "output_truncated": return new AgentError("model_output_truncated");
      case "unsupported_tools": return new AgentError("model_unsupported_tools");
      case "response_too_large": return new AgentError("output_limit");
    }
  }
  return new AgentError("model_failed");
}
