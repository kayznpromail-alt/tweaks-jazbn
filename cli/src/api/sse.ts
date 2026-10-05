import { ApiError, networkFailure } from "./errors";
import { API_LIMITS } from "./limits";
import { checkAbort, decodeUtf8, withBody } from "./transport";

interface SseEvent {
  event: string;
  data: string;
}

class SseParser {
  private line = "";
  private data: string[] = [];
  private event = "message";
  private eventBytes = 0;
  private skipLf = false;
  private readonly encoder = new TextEncoder();

  constructor(private readonly onEvent: (event: SseEvent) => boolean) {}

  private account(bytes: number): void {
    this.eventBytes += bytes;
    if (this.eventBytes > API_LIMITS.eventBytes) throw new ApiError("response_too_large");
  }

  private endLine(): boolean {
    const line = this.line;
    this.line = "";
    if (line === "") {
      const event = { event: this.event, data: this.data.join("\n") };
      const dispatch = this.data.length > 0 || this.event === "error"
        || this.event === "response.error" || this.event === "response.failed";
      this.data = [];
      this.event = "message";
      this.eventBytes = 0;
      return dispatch && this.onEvent(event);
    }
    if (line.startsWith(":")) return false;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    if (field === "event") this.event = value || "message";
    return false;
  }

  feed(text: string): boolean {
    const endings = /[\r\n]/g;
    let offset = 0;
    while (offset < text.length) {
      if (this.skipLf) {
        this.skipLf = false;
        if (text[offset] === "\n") {
          if (this.eventBytes > 0) this.account(1);
          offset++;
          continue;
        }
      }
      endings.lastIndex = offset;
      const ending = endings.exec(text);
      const end = ending?.index ?? text.length;
      const fragment = text.slice(offset, end);
      this.account(this.encoder.encode(fragment).byteLength);
      this.line += fragment;
      if (!ending) return false;
      this.account(1);
      this.skipLf = ending[0] === "\r";
      if (this.endLine()) return true;
      offset = end + 1;
    }
    return false;
  }
}

// eof nigdy nie zastępuje [DONE], nawet po finish_reason lub pełnej linii data.
export async function readSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => boolean,
  options: { drainAfterTerminal?: boolean } = {},
): Promise<void> {
  try {
    await withBody(response, signal, async (read) => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const parser = new SseParser((event) => {
        checkAbort(signal);
        return onEvent(event);
      });
      for (let chunk = await read(); chunk !== null; chunk = await read()) {
        if (parser.feed(decodeUtf8(decoder, chunk))) {
          // Native Messages has an explicit terminal frame before the gateway
          // closes its response. Drain that tail so cancellation does not race
          // the gateway's completion/accounting. Body/time/abort bounds remain.
          if (options.drainAfterTerminal) while (await read() !== null) { /* bounded by withBody */ }
          return;
        }
      }
      parser.feed(decodeUtf8(decoder));
      throw new ApiError("truncated_stream");
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw networkFailure("truncated_stream", error);
  }
}
