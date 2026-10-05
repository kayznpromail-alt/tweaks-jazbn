import {readPrivateMode,privateModeId} from "./private-mode";
import type { ChatRequest, ChatResult, Gateway, Model } from "../types";
import { ApiError, checkResponseError, codedHttpError, isRecord } from "./errors";
import { API_LIMITS } from "./limits";
import { readSse } from "./sse";
import { checkAbort, parseJson, readJson, withRequest, fetchConnected } from "./transport";
import { normalizeBaseUrl } from "./url";
import { readCompletionUsage } from "./usage";
import { ImageStore } from "../media/images";
import { prepareChatRequest, type PreparedChatRequest } from "./chat-request";
import { emptyLegacyPlaceholder, rejectDeprecatedTools, ToolCallAssembler } from "./tool-calls";
import { ToolBatchValidationError } from "./tool-validation";
import { edgeyEfforts, parseEfforts, type EffortCatalog } from "./effort";
import { parseModelMetadata, parseModelContext, type ModelMetadata, type ModelContext } from "./model-metadata";
import { canonicalModel } from './model-transport';
import { prepareMessagesRequest, messagesCompletion, MessagesStream } from './messages-transport';

export { ApiError, userFacingError, type ApiErrorCode } from "./errors";
export { normalizeBaseUrl } from "./url";

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ApiError("invalid_response");
  return value;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function checkTools(value: Record<string, unknown>, streaming: boolean): void {
  if ((value.tool_calls != null && !(Array.isArray(value.tool_calls) && value.tool_calls.length === 0))
    || (value.function_call != null && !(streaming && emptyLegacyPlaceholder(value.function_call))) || value.finish_reason === "tool_calls" || value.finish_reason === "function_call") {
    throw new ApiError("unsupported_tools");
  }
}

class Completion {
  readonly result: ChatResult;
  usageWarning?: "cached_tokens_exceed_input";
  providerFinishReason?: "stop_with_tool_calls";
  private seenChoice = false;
  private pendingUsage = false;
  private outputBytes = 0;
  private hasVisibleOutput = false;
  private readonly calls: ToolCallAssembler;
  private readonly encoder = new TextEncoder();

  constructor(private readonly request: ChatRequest, private readonly signal: AbortSignal,
    private readonly protocol: PreparedChatRequest) {
    this.result = { model: request.model, finishReason: null };
    this.calls = new ToolCallAssembler(protocol.historyToolCallIds, (draft) => {
      checkAbort(this.signal);
      try { this.request.onToolDraft?.(draft); } catch { throw new ApiError("callback_error"); }
    }, protocol.tools.map(tool => tool.function.name));
  }

  accept(value: unknown, streaming: boolean): void {
    const payload = record(value);
    checkResponseError(payload);
    if (payload.model !== undefined) {
      if (!validId(payload.model)) throw new ApiError("invalid_response");
      this.result.model = payload.model;
    }
    const report = readCompletionUsage(payload);
    if (report.kind === "partial") {
      if (!streaming) throw new ApiError("invalid_response");
      this.pendingUsage = true;
    }
    if (report.kind === "complete") {
      this.usageWarning = report.warning;
      checkAbort(this.signal);
      this.pendingUsage = false;
      this.result.usage = { ...report.usage };
      try {
        this.request.onUsage?.({ ...report.usage });
      } catch {
        throw new ApiError("callback_error");
      }
      checkAbort(this.signal);
    }
    // some gateways deliver accounting as a separate event without choices.
    if (streaming && payload.choices === undefined && report.kind !== "absent") return;
    if (!Array.isArray(payload.choices)) throw new ApiError("invalid_response");
    if (streaming && payload.choices.length === 0 && (report.kind !== "absent" || payload.usage === null)) return;
    if (payload.choices.length !== 1) throw new ApiError("invalid_response");
    const choice = record(payload.choices[0]);
    if (this.protocol.tools.length === 0) checkTools(choice, streaming);
    rejectDeprecatedTools(choice, streaming);
    if (this.protocol.tools.length > 0 && choice.tool_calls != null) throw new ApiError("invalid_tool_call");
    if (choice.index !== undefined && choice.index !== 0) throw new ApiError("invalid_response");
    const message = record(streaming ? choice.delta : choice.message);
    if (this.protocol.tools.length === 0) checkTools(message, streaming);
    rejectDeprecatedTools(message, streaming);
    if (message.role !== undefined && message.role !== "assistant") throw new ApiError("invalid_response");
    let finishReason = choice.finish_reason;
    if (finishReason != null && (typeof finishReason !== "string" || !finishReason)) {
      throw new ApiError("invalid_response");
    }
    const texts = [message.content, message.refusal];
    if (texts.some((text) => text != null && typeof text !== "string")) throw new ApiError("invalid_response");
    if (this.result.finishReason !== null && ((finishReason != null && finishReason !== this.result.finishReason)
        || texts.some((text) => typeof text === "string" && text.length > 0)
        || (message.tool_calls != null && !(Array.isArray(message.tool_calls) && message.tool_calls.length === 0)))) {
      throw new ApiError(this.protocol.tools.length > 0 ? "invalid_tool_call" : "invalid_response");
    }
    if (this.protocol.tools.length > 0) {
      this.calls.accept(message.tool_calls, streaming);
      if (finishReason === "stop" && this.calls.size > 0) {
        finishReason = "tool_calls";
        this.providerFinishReason = "stop_with_tool_calls";
      }
      if ((this.calls.size > 0 && (this.protocol.toolChoice === "none" || (finishReason != null && finishReason !== "tool_calls" && finishReason !== "length")))
        || (finishReason === "tool_calls" && this.calls.size === 0)) throw new ApiError("invalid_tool_call");
    }
    for (const text of texts) {
      if (typeof text !== "string") continue;
      if (text.trim()) this.hasVisibleOutput = true;
      checkAbort(this.signal);
      this.outputBytes += this.encoder.encode(text).byteLength;
      if (this.outputBytes > API_LIMITS.outputBytes) throw new ApiError("response_too_large");
      try {
        this.request.onDelta(text);
      } catch {
        throw new ApiError("callback_error");
      }
      checkAbort(this.signal);
    }
    this.seenChoice = true;
    if (typeof finishReason === "string") this.result.finishReason = finishReason;
  }

  finish(): ChatResult {
    if (!this.seenChoice) throw new ApiError("invalid_response");
    // a later partial report cannot confirm the earlier complete snapshot.
    if (this.pendingUsage) throw new ApiError("invalid_response");
    checkAbort(this.signal);
    if (this.result.finishReason === "length") {
      if (this.protocol.tools.length) throw new ToolBatchValidationError([{
        tool: "response", callId: "unavailable", stage: "contract", path: "$.tool_calls", code: "constraint",
        expected: "a complete response and complete tool calls within the output token limit; split large files into smaller edits, request fewer tools per batch and keep chat text brief",
        receivedType: "truncated", retryable: true,
      }]);
      throw new ApiError("output_truncated");
    }
    const toolCalls = this.calls.finish(this.protocol.tools, this.protocol.toolChoice, this.result.finishReason);
    if (toolCalls) this.result.toolCalls = toolCalls;
    if (!toolCalls?.length && !this.hasVisibleOutput) throw new ApiError("empty_response");
    return this.result;
  }
}

export class GatewayClient implements Gateway {
  private lastRequest: {finishReason?:string|null;usageWarning?:string;providerFinishReason?:string;requestId?:string;code?:string;status?:number;retryAfter?:number;networkCode?:string} = {};
  private requestTiming?: { startedAt: string; stage: "waiting_for_headers" | "reading_response"; elapsedMs?: number; responseMode: "buffered_json" | "stream"; firstResponseLimitMs: number | null };
  private connectAttempts = 0;
  diagnostics() { return {...this.lastRequest, connectAttempts: this.connectAttempts, ...(this.requestTiming ? { ...this.requestTiming,
    elapsedMs: this.requestTiming.elapsedMs ?? Math.max(0, Date.now() - Date.parse(this.requestTiming.startedAt)) } : {})}; }
  private readonly metadata = new Map<string, ModelMetadata>();
  private readonly contexts = new Map<string, ModelContext>();
  modelContext(model: string): ModelContext | undefined {
    const value = this.contexts.get(canonicalModel(model)); return value ? { ...value } : undefined;
  }
  modelMetadata(model: string): ModelMetadata | undefined {
    const value = this.metadata.get(canonicalModel(model)); return value ? { ...value } : undefined;
  }
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl: string, apiKey: string, private readonly effortCatalog?: EffortCatalog, private readonly imageStore?: ImageStore,
    private readonly protocol: "chat-completions" | "messages" = "chat-completions") {
    this.#baseUrl = normalizeBaseUrl(baseUrl);
    const target = new URL(this.#baseUrl);
    const local = target.hostname === "localhost" || target.hostname === "localhost." || target.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(target.hostname);
    if (this.#baseUrl !== "https://api.edgey.shop/v1" && !local) throw new ApiError("invalid_base_url");
    if (typeof apiKey !== "string" || !apiKey.trim() || /[^\x21-\x7e]/.test(apiKey.trim())) {
      throw new ApiError("invalid_key");
    }
    this.#apiKey = apiKey.trim();
  }

  private async fetch(path: string, signal: AbortSignal, body?: string): Promise<Response> {
    const response = await fetchConnected(this.#baseUrl + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        accept: body === undefined ? "application/json" : "text/event-stream, application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(path === '/messages' ? { 'anthropic-version': '2023-06-01' } : {}),
      },
      ...(body === undefined ? {} : { body }),
      signal,
      redirect: "error",
      // long agent turns must not reuse a socket closed by an idle proxy.
      keepalive: false,
      // withRequest owns idle/max deadlines; Bun's independent 5-minute timer
      // otherwise aborts valid long reasoning before our generation limit.
      timeout: false,
    }, count => { this.connectAttempts = count; });
    const id=response.headers.get('x-request-id');
    this.lastRequest={status:response.status,...(id&&/^[a-f0-9]{24}$/.test(id)?{requestId:id}:{})};
    if (!response.ok) {
      let code:unknown;
      try { const payload=record(await readJson(response,signal));code=isRecord(payload.error)?payload.error.code:undefined; }
      catch { /* older or malformed errors retain the HTTP fallback */ }
      const error=codedHttpError(response.status,code,id,response.headers.get('retry-after'));
      this.lastRequest={...this.lastRequest,code:error.code,...(error.retryAfter!==undefined?{retryAfter:error.retryAfter}:{})};
      throw error;
    }
    return response;
  }

  async listModels(signal?: AbortSignal): Promise<Model[]> {
    return withRequest(signal, async (requestSignal) => {
      const response = await this.fetch("/models", requestSignal);
      const payload = record(await readJson(response, requestSignal));
      checkResponseError(payload);
      if (!Array.isArray(payload.data)) throw new ApiError("invalid_response");
      const models = new Map<string, Model>();
      for (const value of payload.data) {
        const model = record(value);
        if (!validId(model.id) || (model.owned_by !== undefined && typeof model.owned_by !== "string")) {
          throw new ApiError("invalid_response");
        }
        if (!models.has(model.id)) {
          const levels = parseEfforts(model.reasoning_efforts)
            ?? (this.effortCatalog?.baseUrl === this.#baseUrl ? this.effortCatalog.models.find((item) => item.id === model.id)?.levels : undefined)
            ?? (this.#baseUrl === "https://api.edgey.shop/v1" ? edgeyEfforts(model.id) : undefined);
          models.set(model.id, {
            id: model.id,
            ...(parseModelMetadata(model.edgey_capabilities) ? { capabilities: parseModelMetadata(model.edgey_capabilities) } : {}),
            ...(parseModelContext(model.edgey_context) ? { context: parseModelContext(model.edgey_context) } : {}),
            ...(levels ? { reasoningEfforts: [...levels] } : {}),
            ...(typeof model.owned_by === "string" ? { owned_by: model.owned_by } : {}),
          });
        }
      }
      this.metadata.clear();
      this.contexts.clear();
      for (const model of models.values()) if (model.capabilities) this.metadata.set(model.id, model.capabilities);
      for (const model of models.values()) if (model.context) this.contexts.set(model.id, model.context);
      return [...models.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  async privateCapabilities(signal?:AbortSignal):Promise<import("../types").PrivateMode[]> {
    return withRequest(signal,async s=>{const response=await this.fetch("/cli-capabilities",s);const payload=record(await readJson(response,s));
      if(!Array.isArray(payload.privateModes)||payload.privateModes.length>8)throw new ApiError("invalid_response");
      return payload.privateModes.map((item:unknown)=>{const v=record(item);if(!Array.isArray(v.models)||v.models.length!==1||privateModeId(v.models[0])!==v.id)throw new ApiError("invalid_response");return readPrivateMode({id:v.id,revision:v.revision,overheadTokens:v.overheadTokens});});});
  }

  async account(signal?:AbortSignal):Promise<import('../types').AccountSnapshot> {
    return withRequest(signal,async s=>{
      const value=record(await readJson(await this.fetch('/account',s),s));
      const date=(v:unknown)=>typeof v==='string'&&v.length<=32&&Number.isFinite(Date.parse(v));
      const amount=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
      if(value.version!==1||value.unit!=='weighted_provider_units'||!date(value.updatedAt)
        ||!['active','paused','expired','exhausted'].includes(String(value.status))
        ||!(value.plan===null||typeof value.plan==='string'&&value.plan.length<=80)
        ||!(value.expiresAt===null||date(value.expiresAt))
        ||!(value.limit===null||amount(value.limit))||!(value.available===null||amount(value.available))
        ||!['used','reserved','estimatedRequests'].every(k=>amount(value[k])))throw new ApiError('invalid_response');
      let quota:import('../types').AccountSnapshot['quota'];
      if(value.quota!==undefined){
        const q=record(value.quota);
        const parseQuota=(raw:unknown):import('../types').AccountQuota=>{const v=record(raw);
          if(!(v.limit===null||amount(v.limit))||!(v.available===null||amount(v.available))||!amount(v.used)||!amount(v.reserved))throw new ApiError('invalid_response');
          return {limit:v.limit as number|null,used:v.used as number,reserved:v.reserved as number,available:v.available as number|null};};
        if(!Array.isArray(q.blockedBy)||q.blockedBy.length>2||q.blockedBy.some(v=>v!=='wallet'&&v!=='key')||new Set(q.blockedBy).size!==q.blockedBy.length)throw new ApiError('invalid_response');
        quota={wallet:parseQuota(q.wallet),key:q.key===null?null:parseQuota(q.key),blockedBy:q.blockedBy as ('wallet'|'key')[]};
      }
      return {version:1,unit:'weighted_provider_units',updatedAt:value.updatedAt as string,status:value.status as import('../types').AccountSnapshot['status'],
        plan:value.plan as string|null,expiresAt:value.expiresAt as string|null,limit:value.limit as number|null,
        used:value.used as number,reserved:value.reserved as number,available:value.available as number|null,estimatedRequests:value.estimatedRequests as number,...(quota?{quota}:{})};
    });
  }

  async streamChat(request: ChatRequest): Promise<ChatResult> {
    request = {...request, model: canonicalModel(request.model)};
    const protocol = prepareChatRequest(request, { materializeImages: true, imageStore:this.imageStore });
    const nativeMessages = this.protocol === "messages";
    const path = nativeMessages ? '/messages' : '/chat/completions';
    const body = nativeMessages ? prepareMessagesRequest(protocol) : protocol.body;
    const firstResponseMs = API_LIMITS.generationFirstResponseMs;
    if(Buffer.byteLength(body)>API_LIMITS.requestBytes)throw new ApiError("invalid_request");
    let metadata: {requestId?:string;status?:number} = {};
    this.lastRequest = {};
    this.requestTiming = { startedAt: new Date().toISOString(), stage: "waiting_for_headers", responseMode: "stream", firstResponseLimitMs: firstResponseMs };
    try { return await withRequest(request.signal, async (signal) => {
      const response = await this.fetch(path, signal, body);
      this.requestTiming!.stage = "reading_response";
      const id=response.headers.get('x-request-id');
      metadata={status:response.status,...(id&&/^[a-f0-9]{24}$/.test(id)?{requestId:id}:{})};
      if(request.privateMode){if(response.headers.get("x-edgey-mode")!==request.privateMode.id||response.headers.get("x-edgey-mode-revision")!==request.privateMode.revision){await response.body?.cancel();throw new ApiError("invalid_response");}request.onPrivateModeApplied?.(request.privateMode);}
      const completion = new Completion(request, signal, protocol);
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (nativeMessages && contentType !== 'application/json' && contentType !== 'text/event-stream') throw new ApiError('invalid_response');
      if (nativeMessages && contentType === 'text/event-stream') {
        const stream = new MessagesStream();
        await readSse(response, signal, ({event,data}) => stream.accept(event, parseJson(data)), {drainAfterTerminal:true});
        completion.accept(stream.completion(), false);
      } else if (contentType === "text/event-stream") {
        await readSse(response, signal, ({ event, data }) => {
          if (event === "error" || event === "response.error" || event === "response.failed") {
            // Error events can carry an actionable code even under HTTP 200.
            // Never expose the provider message or guess from its free text.
            let payload: unknown;
            try { payload = parseJson(data); } catch { throw new ApiError("api_error"); }
            if (isRecord(payload)) checkResponseError({ ...payload, type: event });
            throw new ApiError("api_error");
          }
          if (data.trim() === "[DONE]") return true;
          completion.accept(parseJson(data), true);
          return false;
        });
      } else {
        const payload = await readJson(response, signal);
        completion.accept(nativeMessages ? messagesCompletion(payload) : payload, false);
      }
      const result = completion.finish();
      this.lastRequest.finishReason = result.finishReason;
      if (completion.usageWarning) this.lastRequest.usageWarning = completion.usageWarning;
      if (completion.providerFinishReason) this.lastRequest.providerFinishReason = completion.providerFinishReason;
      return result;
    }, { firstResponseMs, idleMs: API_LIMITS.generationIdleMs, maxMs: API_LIMITS.generationMaxMs });
    } catch(error) {
      if(error instanceof ApiError){
        error.requestId ??= metadata.requestId;
        this.lastRequest={...metadata,code:error.code,...(error.status?{status:error.status}:{}),
          ...(error.requestId?{requestId:error.requestId}:{}),...(error.retryAfter!==undefined?{retryAfter:error.retryAfter}:{}),
          ...(error.networkCode?{networkCode:error.networkCode}:{})};
      }
      throw error;
    } finally {
      this.requestTiming.elapsedMs = Math.max(0, Date.now() - Date.parse(this.requestTiming.startedAt));
    }
  }
}
