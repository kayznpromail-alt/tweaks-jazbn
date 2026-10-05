import { ApiError, networkFailure, type ApiErrorCode } from "./errors";
import { API_LIMITS } from "./limits";

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new ApiError("aborted");
}

const activity = new WeakMap<AbortSignal, () => void>();

/** retry only failed DNS/TCP establishment: no request reached an HTTP peer. */
export async function fetchConnected(url: string, options: RequestInit & { signal: AbortSignal; timeout?: boolean | number }, onAttempt?: (count: number) => void): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    checkAbort(options.signal); onAttempt?.(attempt + 1);
    try { return await fetch(url, options); }
    catch (error) {
      const code = networkFailure("network", error).networkCode;
      if (attempt >= 2 || !["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code ?? "")) throw error;
      checkAbort(options.signal);
      await new Promise<void>((resolve, reject) => {
        const stopped = () => { clearTimeout(timer); options.signal.removeEventListener("abort", stopped); reject(new ApiError("aborted")); };
        const timer = setTimeout(() => { options.signal.removeEventListener("abort", stopped); resolve(); }, attempt ? 750 : 250);
        options.signal.addEventListener("abort", stopped, { once: true });
        if (options.signal.aborted) stopped();
      });
    }
  }
}

export async function withRequest<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timing: { idleMs?: number; maxMs?: number; firstResponseMs?: number | null } = {},
): Promise<T> {
  const controller = new AbortController();
  let abortCode: ApiErrorCode = "aborted";
  const abort = (code: ApiErrorCode) => {
    if (!controller.signal.aborted) {
      abortCode = code;
      // nie przenosimy reason od wywołującego: może zawierać sekret.
      controller.abort();
    }
  };
  const onAbort = () => abort("aborted");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const maxMs = timing.maxMs ?? API_LIMITS.requestTimeoutMs;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let firstResponseTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (firstResponseTimer) { clearTimeout(firstResponseTimer); firstResponseTimer = undefined; }
    if (controller.signal.aborted || timing.idleMs === undefined) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("timeout"), timing.idleMs);
  };
  activity.set(controller.signal, touch);
  if (typeof timing.firstResponseMs === 'number') firstResponseTimer = setTimeout(() => abort('first_response_timeout'), timing.firstResponseMs);
  else if (timing.firstResponseMs !== null) touch();
  const timeout = setTimeout(() => abort("timeout"), maxMs);
  let rejectAbort: (() => void) | undefined;
  try {
    checkAbort(controller.signal);
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new ApiError(abortCode));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const result = await Promise.race([Promise.resolve().then(() => {
      checkAbort(controller.signal);
      return run(controller.signal);
    }), stopped]);
    checkAbort(controller.signal);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(abortCode);
    if (error instanceof ApiError) throw error;
    throw networkFailure("network", error);
  } finally {
    clearTimeout(timeout);
    if (idleTimer) clearTimeout(idleTimer);
    if (firstResponseTimer) clearTimeout(firstResponseTimer);
    activity.delete(controller.signal);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

type ReadChunk = () => Promise<Uint8Array | null>;

export async function withBody<T>(
  response: Response,
  signal: AbortSignal,
  consume: (read: ReadChunk) => Promise<T>,
): Promise<T> {
  if (!response.body) throw new ApiError("invalid_response");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  try {
    checkAbort(signal);
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > API_LIMITS.bodyBytes) {
      throw new ApiError("response_too_large");
    }
    return await consume(async () => {
      checkAbort(signal);
      const chunk = await reader.read();
      checkAbort(signal);
      if (chunk.done) return null;
      if (chunk.value.byteLength) activity.get(signal)?.();
      bytes += chunk.value.byteLength;
      if (bytes > API_LIMITS.bodyBytes) throw new ApiError("response_too_large");
      return chunk.value;
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("invalid_response");
  }
}

export function decodeUtf8(decoder: TextDecoder, chunk?: Uint8Array): string {
  try {
    return decoder.decode(chunk, { stream: chunk !== undefined });
  } catch {
    throw new ApiError("invalid_response");
  }
}

export async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  return withBody(response, signal, async (read) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const parts: string[] = [];
    for (let chunk = await read(); chunk !== null; chunk = await read()) {
      parts.push(decodeUtf8(decoder, chunk));
    }
    parts.push(decodeUtf8(decoder));
    return parseJson(parts.join(""));
  });
}
