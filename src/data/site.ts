// Shared with the API server (server/), so prices and rates never drift apart.
import catalog from '../../shared/catalog.json';

export const API_ROOT = 'https://api.edgey.shop';
export const API_BASE = `${API_ROOT}/v1`;
export const DISCORD_URL = 'https://discord.gg/edgey';

// Flip to true once the API server (server/) is online at API_ROOT.
// While false, the site runs as a preview: any 16-digit number opens the dashboard, which shows zeros.
export const API_ENABLED = false;

export type ApiKey = { name: string; masked: string; budget: string; models: string; enabled: boolean };
export type Provider = { name: string; badge: string; models: { id: string; rate: number }[] };

// Placeholders rendered before the API answers (or in preview mode).
export const wallet = { balance: 0 };
export const keys: ApiKey[] = [];

export const PRICE_PER_UNIT = catalog.pricePerUnitUsd;
export const providers: Provider[] = catalog.providers;
// Top-up packs (euros) and coins offered once NOWPayments is connected.
export const PACKS = catalog.packs;
export const COINS = catalog.coins;
export const MAX_KEYS = catalog.maxKeysPerAccount;

export const compactTokens = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n.toLocaleString('en-US');
export const formatRate = (r: number) => `×${r}`;
export const formatPrice = (r: number) => `$${(r * PRICE_PER_UNIT).toFixed(4)}`;
