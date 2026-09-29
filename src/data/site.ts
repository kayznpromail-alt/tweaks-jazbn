export const API_ROOT = 'https://api.edgeycli.com';
export const API_BASE = `${API_ROOT}/v1`;
export const DISCORD_URL = '#';

export type ApiKey = { name: string; masked: string; budget: string; models: string; enabled: boolean };
export type Provider = { name: string; badge: string; models: { id: string; rate: number }[] };

// Vide pour l'instant : à remplir avec les vraies données.
export const wallet = { tokens: '0' };
export const keys: ApiKey[] = [];
export const providers: Provider[] = [];
