import type { CompletedToolCall, ToolCall, ToolChoice, ToolDefinition } from "../types";
import { ApiError, isRecord } from "./errors";
import { API_LIMITS, EXECUTABLE_ARGUMENT_BYTES } from "./limits";
import { byteLength, denseArray, parseToolArguments, plainRecord, toolName, validateArguments } from "./tool-schema";
import { ToolArgumentError, ToolBatchValidationError, argumentIssue, type ToolValidationIssue } from "./tool-validation";

export function toolId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && byteLength(value) <= API_LIMITS.toolIdBytes && !/[\u0000-\u001f\u007f]/.test(value);
}

/** History uses its original schema version, not necessarily today's declarations. */
export function historyToolCall(value: unknown): ToolCall {
  if (!plainRecord(value) || !toolId(value.id) || value.type !== "function" || !plainRecord(value.function)
    || !toolName(value.function.name) || typeof value.function.arguments !== "string"
    || byteLength(value.function.arguments) > EXECUTABLE_ARGUMENT_BYTES) throw new ApiError("invalid_request");
  parseToolArguments(value.function.arguments, "invalid_request");
  return { id: value.id, type: "function", function: { name: value.function.name, arguments: value.function.arguments } };
}

interface PartialCall {
  preview?: string;
  id?: string;
  type?: "function";
  name?: string;
  parts: string[];
  bytes: number;
  seenArguments: boolean;
  trailingHighSurrogate?: boolean;
}

/** finish is the only executable publication boundary; drafts are display-only. */
export class ToolCallAssembler {
  private readonly calls = new Map<number, PartialCall>();
  private readonly ids = new Map<string, number>();
  private bytes = 0;
  private completeUnindexedBatch = false;

  constructor(private readonly previousIds: ReadonlySet<string> = new Set(),
    private readonly onDraft?: (draft: { index: number; name: string; preview: string; bytes: number }) => void,
    private readonly declaredNames: readonly string[] = []) {}

  get size(): number { return this.calls.size; }

  accept(value: unknown, streaming: boolean): void {
    if (value == null) return;
    if (!Array.isArray(value)) throw new ApiError("invalid_tool_call");
    if (value.length > API_LIMITS.toolCalls) throw new ApiError("response_too_large");
    if (!denseArray(value, API_LIMITS.toolCalls)) throw new ApiError("invalid_tool_call");
    if (value.length && this.completeUnindexedBatch) throw new ApiError("invalid_tool_call");
    // Some compatible gateways emit one complete JSON-style batch inside SSE.
    // Accept only a self-contained first batch; never guess indexes for fragments
    // or merge indexed and unindexed calls.
    if (streaming && value.length && value.every(item => isRecord(item) && item.index === undefined)) {
      if (this.calls.size) throw new ApiError("invalid_tool_call");
      for (const item of value) {
        if (!isRecord(item) || !toolId(item.id) || item.type !== 'function' || !isRecord(item.function)
          || !toolName(item.function.name) || typeof item.function.arguments !== 'string') throw new ApiError('invalid_tool_call');
        parseToolArguments(item.function.arguments, 'invalid_tool_call');
      }
      this.completeUnindexedBatch = true;
      streaming = false;
    }
    const indexes = new Set<number>();
    for (let position = 0; position < value.length; position++) {
      const item = value[position];
      if (!isRecord(item)) throw new ApiError("invalid_tool_call");
      const index = streaming ? item.index : position;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= API_LIMITS.toolCalls
        || indexes.has(index) || (!streaming && item.index !== undefined && item.index !== position)) {
        throw new ApiError("invalid_tool_call");
      }
      indexes.add(index);
      const call = this.calls.get(index) ?? { parts: [], bytes: 0, seenArguments: false };
      this.calls.set(index, call);
      // stream placeholders do not replace metadata from an earlier delta.
      const present = (value: unknown) => value !== undefined && !(streaming && (value === null || value === ""));
      if (present(item.id)) {
        if (!toolId(item.id) || this.previousIds.has(item.id) || (call.id !== undefined && call.id !== item.id)
          || (this.ids.has(item.id) && this.ids.get(item.id) !== index)) throw new ApiError("invalid_tool_call");
        call.id = item.id;
        this.ids.set(item.id, index);
      }
      if (present(item.type)) {
        if (item.type !== "function") throw new ApiError("invalid_tool_call");
        call.type = item.type;
      }
      if (present(item.function)) {
        if (!isRecord(item.function)) throw new ApiError("invalid_tool_call");
        if (present(item.function.name)) {
          if (!toolName(item.function.name)) throw new ApiError("invalid_tool_call");
          const next = call.name === undefined || call.name === item.function.name
            ? item.function.name : call.name + item.function.name;
          if (call.name !== undefined && call.name !== item.function.name
            && !(streaming && this.declaredNames.some(name => name.startsWith(next)))) throw new ApiError("invalid_tool_call");
          call.name = next;
        }
        if (item.function.arguments !== undefined && !(streaming && item.function.arguments === null)) {
          if (typeof item.function.arguments !== "string") throw new ApiError("invalid_tool_call");
          const fragment = item.function.arguments;
          const first = fragment.charCodeAt(0);
          const joinsPair = call.trailingHighSurrogate && first >= 0xdc00 && first <= 0xdfff;
          // joined surrogate pairs encode as four bytes, not two replacement characters.
          const bytes = byteLength(fragment) - (joinsPair ? 2 : 0);
          call.bytes += bytes;
          this.bytes += bytes;
          if (call.bytes > EXECUTABLE_ARGUMENT_BYTES || this.bytes > API_LIMITS.totalToolArgumentsBytes) {
            throw new ApiError("response_too_large");
          }
          // Empty fragments have no retained allocation, even on long streams.
          if (bytes) call.parts.push(item.function.arguments);
          call.preview = (call.preview ?? "") + fragment;
          if (fragment.length > 0) {
            const last = fragment.charCodeAt(fragment.length - 1);
            call.trailingHighSurrogate = last >= 0xd800 && last <= 0xdbff;
          }
          call.seenArguments = true;
        }
      }
      if (call.name && this.onDraft) this.onDraft({ index, name: call.name, preview: call.preview ?? "", bytes: call.bytes });
    }
  }

  finish(tools: ToolDefinition[], choice: ToolChoice | undefined, finishReason: string | null): CompletedToolCall[] | undefined {
    if (this.calls.size === 0) {
      if (finishReason === "tool_calls" || choice === "required" || typeof choice === "object") {
        throw new ApiError("invalid_tool_call");
      }
      return undefined;
    }
    if (finishReason !== "tool_calls" || choice === "none") throw new ApiError("invalid_tool_call");
    const definitions = new Map(tools.map((tool) => [tool.function.name, tool.function.parameters]));
    const completed: CompletedToolCall[] = [];
    const issues: ToolValidationIssue[] = [], rawCalls: ToolCall[] = [];
    let validJson = true;
    // provider content-block indexes can include text/reasoning blocks.
    // indexes correlate deltas; they are not a required dense array offset.
    for (const [, call] of [...this.calls.entries()].sort(([a], [b]) => a - b)) {
      if (!call?.id || call.type !== "function" || !call.name || !call.seenArguments) throw new ApiError("invalid_tool_call");
      const schema = definitions.get(call.name);
      if (!schema) throw new ApiError("unknown_tool");
      if (typeof choice === "object" && choice.function.name !== call.name) throw new ApiError("invalid_tool_call");
      const args = call.parts.join("");
      rawCalls.push({id:call.id,type:"function",function:{name:call.name,arguments:args}});
      try {
        const parsedArguments = parseToolArguments(args, "invalid_tool_arguments");
        validateArguments(parsedArguments, schema);
        completed.push({ id: call.id, type: "function", function: { name: call.name, arguments: args }, parsedArguments });
      } catch(error) {
        // Size/depth/nonfinite/protocol violations are not repairable model mistakes.
        if(!(error instanceof ToolArgumentError))throw error;
        if(error.detail.stage==="json")validJson=false;
        issues.push(argumentIssue(error,call.name,call.id));
      }
    }
    if(issues.length)throw new ToolBatchValidationError(issues,validJson?rawCalls:undefined);
    return completed;
  }
}

export function emptyLegacyPlaceholder(value: unknown): boolean {
  return isRecord(value) && value.name === "" && value.arguments === ""
    && Object.keys(value).every(key => key === "name" || key === "arguments");
}

export function rejectDeprecatedTools(value: Record<string, unknown>, streaming = false): void {
  if ((value.function_call != null && !(streaming && emptyLegacyPlaceholder(value.function_call)))
    || value.finish_reason === "function_call") throw new ApiError("unsupported_tools");
}
