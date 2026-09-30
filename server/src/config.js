import { parseSplit } from './earnings.js';
const hostLabel = (url) => {
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.length > 1 ? parts.at(-2) : parts[0];
  } catch {
    return '';
  }
};

/** Reads settings from the environment (see deploy/.env.example). */
export function loadConfig(env = process.env) {
  const required = (name) => {
    const value = env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  };
  const list = (value) =>
    (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DATABASE_PATH ?? './data/edgey.db',
    upstreamBase: required('UPSTREAM_BASE').replace(/\/+$/, ''),
    // Words that must never reach customers in error messages (the provider's name, its domain…).
    // Defaults to the upstream host's name, e.g. "provider" for https://api.provider.com.
    upstreamNames: list(env.UPSTREAM_NAMES ?? hostLabel(env.UPSTREAM_BASE)),
    upstreamKey: required('UPSTREAM_API_KEY'),
    pepper: required('SECRET_PEPPER'),
    // Password for the /admin panel. Admin routes stay off while it is empty.
    adminToken: env.ADMIN_TOKEN || null,
    // Self-service sign-up. Off by default: accounts are created from the admin panel.
    openRegistration: env.OPEN_REGISTRATION === 'true',
    allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'https://cli.edgey.shop'),
    publicApiUrl: (env.PUBLIC_API_URL ?? 'https://api.edgey.shop').replace(/\/+$/, ''),
    siteUrl: (env.SITE_URL ?? 'https://cli.edgey.shop').replace(/\/+$/, ''),
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    // Profit split for the admin panel: retail cost at the provider and each partner's share.
    earnings: {
      costUsdPerMillion: Number(env.COST_USD_PER_MILLION ?? 0.05),
      usdPerEur: Number(env.USD_PER_EUR ?? 1.15),
      split: parseSplit(env.PROFIT_SPLIT ?? 'edgey:60,kayzn:40'),
    },
    nowpayments: {
      apiKey: env.NOWPAYMENTS_API_KEY || null,
      ipnSecret: env.NOWPAYMENTS_IPN_SECRET || null,
      base: (env.NOWPAYMENTS_BASE ?? 'https://api.nowpayments.io/v1').replace(/\/+$/, ''),
    },
  };
}
