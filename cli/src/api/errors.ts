const messages = {
  image_unavailable:"image artifact is missing or damaged; attach the image again.",
  image_unsupported:"this model does not support images; select a vision model with /models.",
  maintenance_mode: "the api is temporarily disabled for maintenance. check edgey.shop for updates.",
  jailbreak_not_allowed: "jailbreak access for this model is no longer available. type /jailbreak to disable it and continue.",
  jailbreak_model_mismatch: "jailbreak is not available for this model. type /jailbreak to disable it and continue.",
  jailbreak_revision_changed: "jailbreak instructions changed. type /jailbreak to disable it; enable it again for a new request.",
  invalid_base_url: "the cli uses https://api.edgey.shop/v1. other public api addresses are disabled.",
  invalid_key: "enter a valid api key.",
  invalid_request: "invalid chat request data.",
  unauthorized: "the api key is invalid or expired.",
  forbidden: "the api key cannot access this resource or model.",
  quota_exceeded: "the api key quota is exhausted.",
  rate_limited: "api request rate limit exceeded. try again later.",
  concurrency_limited: "too many requests are running. wait for the current work to finish.",
  key_expired: "the api key has expired. contact the key owner to renew access.",
  key_paused: "the api key is paused. contact the key owner.",
  model_forbidden: "this model is not allowed for the api key. select another model.",
  timeout: "the api request timed out.",
  first_response_timeout: "the api did not return a response within the allowed waiting time. saved work is retained; use /retry to try again explicitly.",
  aborted: "the request was interrupted.",
  model_pricing_unavailable: "model pricing is unavailable; no generation was sent. contact support with the request reference.",
  unavailable: "the api is temporarily unavailable. try again later.",
  network: "could not connect to the api. check the connection and address.",
  http_error: "the api rejected the request.",
  request_too_large: "this conversation exceeds the request size limit. older completed work must be summarized before continuing.",
  context_length_exceeded: "the provider reported that this request exceeds the model token window. use /new for the next task in this project.",
  api_error: "the api reported an error while processing the request.",
  invalid_response: "the api returned an invalid response.",
  empty_response: "the model returned no answer or tool calls. work is not marked complete; use /retry to continue saved work.",
  invalid_tool_call: "the api returned an invalid or inconsistent tool call.",
  unknown_tool: "the api requested an undeclared tool.",
  invalid_tool_arguments: "tool arguments do not match the declared schema.",
  truncated_stream: "the response stream ended before completion was confirmed.",
  output_truncated: "the model reached its output token limit. partial output is saved; incomplete tools were not executed. split large file changes into smaller edits.",
  unsupported_tools: "the model requested tools that are not supported yet.",
  response_too_large: "the api response exceeded the size limit.",
  callback_error: "could not deliver response data to the application.",
  unknown: "an unexpected error occurred.",
} as const;

export type ApiErrorCode = keyof typeof messages;
const networkCodes = new Set(["ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ConnectionClosed", "TimeoutError", "ERR_PROXY_TUNNEL", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED"]);

export function apiDiagnosticHint(value:{code?:string;requestId?:string;status?:number;networkCode?:string}|undefined):string {
  const code=value?.code&&Object.hasOwn(messages,value.code)?value.code:undefined;
  const id=value?.requestId&&/^[a-f0-9]{24}$/.test(value.requestId)?value.requestId:undefined;
  const status=Number.isInteger(value?.status)&&value!.status!>=400&&value!.status!<=599?`http ${value!.status}`:undefined;
  const networkCode = value?.networkCode && networkCodes.has(value.networkCode) ? value.networkCode : undefined;
  return [status??code,networkCode,id?`reference ${id}`:undefined,code||id||networkCode?'details: /diagnostics':undefined].filter(Boolean).join(' · ');
}

/** Recover only whitelisted display metadata, never provider text or operation output. */
export function apiErrorHint(message:string):string|undefined {
  const code=(Object.keys(messages) as ApiErrorCode[]).find(code=>messages[code]===message);
  if(!code)return undefined;
  const action:Partial<Record<ApiErrorCode,string>>={
    unauthorized:"use /key to reconnect",invalid_key:"use /key to reconnect",forbidden:"check model access with the key owner",
    quota_exceeded:"contact the key owner about quota",rate_limited:"wait before starting a new request",
    timeout:"inspect /tools before continuing",network:"check connection; inspect /tools before continuing",
    truncated_stream:"inspect /tools; use /recover only if requested",aborted:"inspect the recorded outcome in /tools",
    jailbreak_not_allowed:"use /jailbreak to disable",jailbreak_model_mismatch:"use /jailbreak to disable",
  };
  return `${code} · ${action[code]??"open /diagnostics for a local support report"}`;
}

// komunikaty pochodzą wyłącznie z tej listy, nigdy z odpowiedzi lub fetch.
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  requestId?: string;
  retryAfter?: number;
  networkCode?: string;

  constructor(code: ApiErrorCode, status?: number) {
    const safeCode = Object.hasOwn(messages, code) ? code : "unknown";
    super(messages[safeCode]);
    this.name = "ApiError";
    this.code = safeCode;
    if (Number.isInteger(status) && status! >= 100 && status! <= 599) {
      this.status = status;
    }
  }
}

/** retain only an allowlisted socket code, never hostnames, messages or stacks. */
export function networkFailure(code: "network" | "truncated_stream", cause: unknown): ApiError {
  const error = new ApiError(code);
  for (let depth = 0; depth < 3 && cause && typeof cause === "object"; depth++) {
    const value = cause as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof value.code === "string" && networkCodes.has(value.code)) {
      error.networkCode = value.code;
      break;
    }
    if (value.name === "TimeoutError") { error.networkCode = "TimeoutError"; break; }
    cause = value.cause;
  }
  return error;
}

export function codedHttpError(status:number, code:unknown, requestId:unknown, retryAfter:unknown):ApiError {
  const allowed:ReadonlySet<string>=new Set(['maintenance_mode','quota_exceeded','rate_limited','concurrency_limited','key_expired','key_paused',
    'model_pricing_unavailable','model_forbidden','unauthorized','forbidden','timeout','unavailable','http_error','jailbreak_not_allowed','jailbreak_model_mismatch','jailbreak_revision_changed']);
  const error=(status===400||status===413)&&code==='context_length_exceeded'?new ApiError('context_length_exceeded',status):status===413?httpError(status):typeof code==='string'&&allowed.has(code)?new ApiError(code as ApiErrorCode,status):httpError(status);
  if(typeof requestId==='string'&&/^[a-f0-9]{24}$/.test(requestId))error.requestId=requestId;
  if(typeof retryAfter==='string'&&/^\d{1,5}$/.test(retryAfter))error.retryAfter=Number(retryAfter);
  return error;
}

export function userFacingError(error: unknown): string {
  if (error instanceof ApiError) return Object.hasOwn(messages, error.code) ? messages[error.code] : messages.unknown;
  if (error instanceof Error) {
    if (error.name === "AbortError") return messages.aborted;
    if (error.name === "TimeoutError") return messages.timeout;
  }
  return messages.unknown;
}

export function httpError(status: number): ApiError {
  if (status === 413) return new ApiError("request_too_large", status);
  if (status === 401) return new ApiError("unauthorized", status);
  if (status === 403) return new ApiError("forbidden", status);
  if (status === 402) return new ApiError("quota_exceeded", status);
  if (status === 429) return new ApiError("rate_limited", status);
  if (status === 408 || status === 504) return new ApiError("timeout", status);
  if (status >= 500) return new ApiError("unavailable", status);
  return new ApiError("http_error", status);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkResponseError(payload: Record<string, unknown>): void {
  const error = payload.error ?? (isRecord(payload.response) ? payload.response.error : undefined);
  if (error == null && payload.type !== "error" && payload.type !== "response.error" && payload.type !== "response.failed") return;
  const codes = isRecord(error) ? [error.code, error.type] : [payload.code];
  if (codes.some(code => code === "context_length_exceeded" || code === "context_window_exceeded")) throw new ApiError("context_length_exceeded");
  if (codes.some((code) => code === "invalid_api_key" || code === "authentication_error")) {
    throw new ApiError("unauthorized");
  }
  if (codes.some((code) => code === "insufficient_quota" || code === "quota_exceeded")) {
    throw new ApiError("quota_exceeded");
  }
  if (codes.some((code) => code === "rate_limit_exceeded" || code === "rate_limit_error")) {
    throw new ApiError("rate_limited");
  }
  if (codes.some(code => typeof code === "string" && ["overloaded_error", "server_error", "internal_server_error", "service_unavailable"].includes(code))) {
    throw new ApiError("unavailable");
  }
  if (codes.some(code => typeof code === "string" && ["timeout", "timeout_error", "request_timeout"].includes(code))) {
    throw new ApiError("timeout");
  }
  throw new ApiError("api_error");
}
