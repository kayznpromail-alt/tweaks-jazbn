export const API_ROOT = 'https://api.edgeycli.com';
export const API_BASE = `${API_ROOT}/v1`;
export const DISCORD_URL = '#';

export type ApiKey = { name: string; masked: string; budget: string; models: string; enabled: boolean };
export type Provider = { name: string; badge: string; models: { id: string; rate: number }[] };

// Vide pour l'instant : à remplir avec les vraies données.
export const wallet = { tokens: '0' };
export const keys: ApiKey[] = [];
// Price per 1M standard tokens for a ×1 rate (cached tokens cost the same).
export const PRICE_PER_UNIT = 0.05;

const m = (entries: [string, number][]) => entries.map(([id, rate]) => ({ id, rate }));

export const providers: Provider[] = [
  {
    name: 'GPT',
    badge: 'GP',
    models: m([['gpt-6-astra', 10], ['gpt-5.6-sol', 4], ['gpt-5.6-terra', 1.5], ['gpt-5.6-luna', 0.5], ['gpt-5.5', 4], ['gpt-5.4-mini', 0.9]]),
  },
  {
    name: 'Claude',
    badge: 'C',
    models: m([
      ['claude-opus-5', 5], ['claude-fable-5', 8], ['claude-opus-4-8', 4], ['claude-opus-4-7', 4],
      ['claude-sonnet-5', 2], ['claude-sonnet-4-6', 2], ['claude-opus-4-6', 4], ['claude-haiku-4-5', 0.9],
    ]),
  },
  {
    name: 'Google',
    badge: 'G',
    models: m([['gemini-3.7-flash', 2], ['gemini-3.8-flash', 2], ['gemini-3.5-flash', 2], ['gemini-3.6-flash', 2]]),
  },
  { name: 'xAI', badge: 'X', models: m([['grok-4.6', 0.5], ['grok-4.5', 0.5]]) },
  {
    name: 'Chinese',
    badge: '中',
    models: m([
      ['qwen3.8-max', 2.5], ['kimi-k3', 2.5], ['hy4-preview', 1], ['glm-5.3', 1.5], ['qwen3.8-flash', 0.7],
      ['glm-5.3-flash', 0.3], ['deepseek-v4-pro', 0.5], ['deepseek-v4-flash', 0.1], ['glm-5.2', 1.5],
      ['minimax-m3', 0.3], ['kimi-k2.7-code', 0.9], ['mimo-v2.5-pro', 0.3], ['mimo-v2.5', 0.05],
    ]),
  },
  {
    name: 'Other',
    badge: '··',
    models: m([['gpt-6-sol', 3], ['gpt-6-luna', 0.38], ['claude-fable-5-1', 8], ['grok-4.7', 0.5], ['deepseek-v4.1-flash', 0.1]]),
  },
];

export const formatRate = (r: number) => `×${r}`;
export const formatPrice = (r: number) => `$${(r * PRICE_PER_UNIT).toFixed(4)}`;
