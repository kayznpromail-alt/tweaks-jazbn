import { createUsageTracker, usageFromJson } from './billing.js';

// Models whose public name differs from the upstream provider's model id.
const MODEL_ALIASES = new Map([
  ['edgeybeast', 'dawvqBEAST'],
]);

/** Resolve the upstream model id (applies alias if one exists). */
export const upstreamModel = (id) => MODEL_ALIASES.get(id) ?? id;

/** Error body in the format each client family expects. */
export function errorBody(kind, status, type, message) {
  return kind === 'anthropic'
    ? { type: 'error', error: { type, message } }
    : { error: { message, type, code: type, status } };
}

const PASS_HEADERS = ['anthropic-version', 'anthropic-beta', 'accept'];

// Errors about the request itself keep their (scrubbed) message; anything about our own upstream
// account, limits or outages becomes a neutral message, so customers never see the provider.
const REQUEST_ERRORS = new Set([400, 404, 409, 413, 422]);
const NEUTRAL = {
  429: [429, 'rate_limit_error', 'Too many requests right now. Slow down and try again.'],
  overloaded: [503, 'overloaded_error', 'The model is busy. Try again in a moment.'],
  default: [502, 'upstream_error', 'The model could not answer this request. Try again shortly.'],
};

function scrub(text, cfg) {
  let out = String(text ?? '');
  const host = (() => {
    try {
      return new URL(cfg.upstreamBase).host;
    } catch {
      return '';
    }
  })();
  if (host) out = out.split(host).join('api.edgey.shop');
  for (const name of cfg.upstreamNames ?? []) {
    if (name) out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'edgey');
  }
  return out.slice(0, 500);
}

/** What the customer sees when the upstream answers with an error. */
export function publicError(kind, status, text, cfg) {
  if (REQUEST_ERRORS.has(status)) {
    let message = 'The request was rejected. Check the model name and parameters.';
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? j?.message ?? message;
    } catch {}
    const type = status === 404 ? 'not_found_error' : 'invalid_request_error';
    return { status, body: errorBody(kind, status, type, scrub(message, cfg)) };
  }
  const [s, type, message] = status === 429 ? NEUTRAL[429] : status === 503 || status === 529 ? NEUTRAL.overloaded : NEUTRAL.default;
  return { status: s, body: errorBody(kind, s, type, message) };
}

/**
 * Forwards a request to the upstream provider with the server's own key, streams the answer back
 * and reports the token usage once it is known (end of body, client disconnect, or error).
 */
export async function relay({ cfg, kind, path, body, incoming, onDone, upstreamKey }) {
  const headers = { 'content-type': 'application/json' };
  for (const h of PASS_HEADERS) {
    const v = incoming.headers.get(h);
    if (v) headers[h] = v;
  }
  const apiKey = upstreamKey ?? cfg.upstreamKey;
  if (kind === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] ??= '2023-06-01';
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const stream = body?.stream === true;
  const payload =
    kind === 'openai' && stream ? { ...body, stream_options: { ...(body.stream_options ?? {}), include_usage: true } } : body;

  let settled = false;
  const settle = (usage, status) => {
    if (settled) return;
    settled = true;
    onDone(usage, status);
  };

  let res;
  try {
    res = await fetch(`${cfg.upstreamBase}/v1${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: incoming.signal,
    });
  } catch {
    settle(null, 502);
    return Response.json(errorBody(kind, 502, 'upstream_unavailable', 'The model provider did not respond. Try again.'), {
      status: 502,
    });
  }

  const ctype = res.headers.get('content-type') ?? 'application/json';
  if (res.ok && ctype.includes('text/event-stream') && res.body) {
    const tracker = createUsageTracker(kind);
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const out = new ReadableStream({
      async pull(ctl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            tracker.feed(decoder.decode());
            settle(tracker.result(), res.status);
            ctl.close();
            return;
          }
          tracker.feed(decoder.decode(value, { stream: true }));
          ctl.enqueue(value);
        } catch (err) {
          settle(tracker.result(), res.status);
          ctl.error(err);
        }
      },
      cancel(reason) {
        // Client went away: bill what was already reported.
        settle(tracker.result(), res.status);
        return reader.cancel(reason);
      },
    });
    return new Response(out, {
      status: res.status,
      headers: { 'content-type': ctype, 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
    });
  }

  const text = await res.text();
  if (!res.ok) {
    settle(null, res.status);
    if (res.status >= 500 || res.status === 401 || res.status === 403 || res.status === 402)
      console.error(`upstream ${res.status}: ${text.slice(0, 300)}`);
    const out = publicError(kind, res.status, text, cfg);
    return Response.json(out.body, { status: out.status });
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  settle(usageFromJson(kind, json), res.status);
  return new Response(text, { status: res.status, headers: { 'content-type': ctype } });
}
