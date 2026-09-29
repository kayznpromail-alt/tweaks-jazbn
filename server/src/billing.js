import { readFileSync } from 'node:fs';

const catalogUrl = new URL('../../shared/catalog.json', import.meta.url);
export const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8'));

const rates = new Map();
for (const p of catalog.providers) for (const m of p.models) rates.set(m.id, { rate: m.rate, provider: p.name });

/** Multiplier for a model, or null when the model is not offered. */
export const modelInfo = (id) => rates.get(id) ?? null;
export const allModels = () => [...rates.entries()].map(([id, v]) => ({ id, ...v }));

/** Tokens taken from the wallet: every token (input, output, cached) times the model multiplier. */
export const costOf = (totalTokens, rate) => (totalTokens > 0 ? Math.ceil(totalTokens * rate) : 0);

const n = (v) => (Number.isFinite(v) ? v : 0);

/** Usage from a non-streamed JSON body, for either API family. */
export function usageFromJson(kind, body) {
  const u = body?.usage;
  if (!u) return null;
  if (kind === 'openai') {
    const input = n(u.prompt_tokens);
    const output = n(u.completion_tokens);
    return { input, output, total: n(u.total_tokens) || input + output };
  }
  const input = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
  const output = n(u.output_tokens);
  return { input, output, total: input + output };
}

/**
 * Reads usage out of a server-sent event stream as it passes through.
 * OpenAI: the last chunk carries `usage` (requested with stream_options.include_usage).
 * Anthropic: message_start carries input usage, message_delta carries the running output count.
 */
export function createUsageTracker(kind) {
  let buffer = '';
  let input = 0;
  let output = 0;
  let seen = false;

  const onEvent = (data) => {
    if (!data || data === '[DONE]') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (kind === 'openai') {
      if (msg.usage) {
        const u = usageFromJson('openai', msg);
        input = u.input;
        output = u.output;
        seen = true;
      }
      return;
    }
    if (msg.type === 'message_start' && msg.message?.usage) {
      const u = usageFromJson('anthropic', msg.message);
      input = u.input;
      output = Math.max(output, u.output);
      seen = true;
    } else if (msg.type === 'message_delta' && msg.usage) {
      if (Number.isFinite(msg.usage.output_tokens)) output = msg.usage.output_tokens;
      const extra = n(msg.usage.input_tokens) + n(msg.usage.cache_creation_input_tokens) + n(msg.usage.cache_read_input_tokens);
      if (extra > input) input = extra;
      seen = true;
    }
  };

  return {
    feed(text) {
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) onEvent(line.slice(5).trim());
      }
    },
    result() {
      if (buffer.startsWith('data:')) onEvent(buffer.slice(5).trim());
      buffer = '';
      return seen ? { input, output, total: input + output } : null;
    },
  };
}
