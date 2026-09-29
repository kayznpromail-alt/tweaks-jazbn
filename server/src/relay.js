import { createUsageTracker, usageFromJson } from './billing.js';

/** Error body in the format each client family expects. */
export function errorBody(kind, status, type, message) {
  return kind === 'anthropic'
    ? { type: 'error', error: { type, message } }
    : { error: { message, type, code: type, status } };
}

const PASS_HEADERS = ['anthropic-version', 'anthropic-beta', 'accept'];

/**
 * Forwards a request to the upstream provider with the server's own key, streams the answer back
 * and reports the token usage once it is known (end of body, client disconnect, or error).
 */
export async function relay({ cfg, kind, path, body, incoming, onDone }) {
  const headers = { 'content-type': 'application/json' };
  for (const h of PASS_HEADERS) {
    const v = incoming.headers.get(h);
    if (v) headers[h] = v;
  }
  if (kind === 'anthropic') {
    headers['x-api-key'] = cfg.upstreamKey;
    headers['anthropic-version'] ??= '2023-06-01';
  } else {
    headers.authorization = `Bearer ${cfg.upstreamKey}`;
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
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  settle(res.ok ? usageFromJson(kind, json) : null, res.status);
  return new Response(text, { status: res.status, headers: { 'content-type': ctype } });
}
