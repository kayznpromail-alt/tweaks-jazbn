export const API_BASE = 'https://api.edgeycli.com/v1';
export const DISCORD_URL = '#';

export const wallet = { tokens: '220M' };

export const keys = [
  { name: 'Primary API key', masked: 'sk_5aQ6abw…gIYo', budget: 'Uses shared wallet', models: 'All offered models', enabled: true },
];
export const MAX_KEYS = 6;

export const providers = [
  {
    name: 'GPT',
    badge: 'G',
    models: [
      { id: 'gpt-5', rate: 1.0 },
      { id: 'gpt-5-mini', rate: 0.3 },
      { id: 'gpt-5-nano', rate: 0.1 },
      { id: 'gpt-4.1', rate: 0.8 },
      { id: 'gpt-4o', rate: 0.6 },
      { id: 'o4-mini', rate: 0.5 },
    ],
  },
  {
    name: 'Claude',
    badge: 'C',
    models: [
      { id: 'claude-opus-5-5', rate: 2.0 },
      { id: 'claude-sonnet-5-5', rate: 1.0 },
      { id: 'claude-haiku-4-5', rate: 0.3 },
      { id: 'claude-opus-4-1', rate: 1.8 },
      { id: 'claude-sonnet-4-5', rate: 0.9 },
      { id: 'claude-sonnet-4', rate: 0.8 },
      { id: 'claude-3-7-sonnet', rate: 0.7 },
      { id: 'claude-3-5-haiku', rate: 0.2 },
    ],
  },
  {
    name: 'Google',
    badge: 'G',
    models: [
      { id: 'gemini-2.5-pro', rate: 0.9 },
      { id: 'gemini-2.5-flash', rate: 0.3 },
      { id: 'gemini-2.5-flash-lite', rate: 0.1 },
      { id: 'gemini-2.0-flash', rate: 0.1 },
    ],
  },
  {
    name: 'xAI',
    badge: 'X',
    models: [
      { id: 'grok-4', rate: 1.0 },
      { id: 'grok-3-mini', rate: 0.2 },
    ],
  },
];
