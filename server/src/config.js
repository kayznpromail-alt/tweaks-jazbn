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
    upstreamBase: (env.UPSTREAM_BASE ?? 'https://api.dawvq.com').replace(/\/+$/, ''),
    upstreamKey: required('UPSTREAM_API_KEY'),
    pepper: required('SECRET_PEPPER'),
    // Password for the /admin panel. Admin routes stay off while it is empty.
    adminToken: env.ADMIN_TOKEN || null,
    allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'https://edgeycli.com'),
    publicApiUrl: (env.PUBLIC_API_URL ?? 'https://api.edgeycli.com').replace(/\/+$/, ''),
    siteUrl: (env.SITE_URL ?? 'https://edgeycli.com').replace(/\/+$/, ''),
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    nowpayments: {
      apiKey: env.NOWPAYMENTS_API_KEY || null,
      ipnSecret: env.NOWPAYMENTS_IPN_SECRET || null,
      base: (env.NOWPAYMENTS_BASE ?? 'https://api.nowpayments.io/v1').replace(/\/+$/, ''),
    },
  };
}
