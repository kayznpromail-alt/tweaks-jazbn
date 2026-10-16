import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { allModels, catalog, costOf, isRestricted, modelInfo } from './billing.js';
import { creditPayment, now, tx } from './db.js';
import { createInvoice, verifyIpn } from './nowpayments.js';
import { createLimiter } from './ratelimit.js';
import { adminRoutes } from './admin-routes.js';
import { cliAccounts } from './cli-account.js';
import { cliReleaseRoutes } from './cli-release.js';
import { dashboardRoutes } from './dashboard-routes.js';
import { panelRoutes } from './panel-routes.js';
import { errorBody, relay, upstreamModel } from './relay.js';
import {
  hashSecret,
  hashPassword,
  isAccessNumber,
  isApiKey,
  isUsername,
  maskKey,
  newAccessNumber,
  newApiKey,
  newSessionToken,
  normalizeNumber,
  openSecret,
  sealSecret,
  verifyPassword,
} from './security.js';

const DAY = 86_400_000;
const RANGES = {
  '24h': { span: DAY, buckets: 24 },
  '7d': { span: 7 * DAY, buckets: 7 },
  '30d': { span: 30 * DAY, buckets: 30 },
};

// Cached dawvq cli-capabilities (revision for opus-private JB mode).
let _capabilitiesCache = { data: null, fetchedAt: 0 };
async function getDawvqCapabilities(cfg) {
  const now = Date.now();
  if (_capabilitiesCache.data && now - _capabilitiesCache.fetchedAt < 3_600_000) {
    console.log('[caps] using cached capabilities (age %ds)', Math.round((now - _capabilitiesCache.fetchedAt) / 1000));
    return _capabilitiesCache.data;
  }
  try {
    console.log('[caps] fetching upstream capabilities from %s', cfg.upstreamBase);
    const res = await fetch(`${cfg.upstreamBase}/v1/cli-capabilities`, {
      headers: { authorization: `Bearer ${cfg.upstreamKey}` },
    });
    if (!res.ok) {
      console.error('[caps] upstream returned %d %s', res.status, res.statusText);
      return _capabilitiesCache.data;
    }
    const data = await res.json();
    console.log('[caps] upstream response: %s', JSON.stringify(data));
    _capabilitiesCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    console.error('[caps] upstream fetch failed:', err.message);
    return _capabilitiesCache.data;
  }
}

export function createApp({ cfg, db, clock = now }) {
  const app = new Hono();
  const hash = (v) => hashSecret(cfg.pepper, v);
  const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';

  const cli = cliAccounts({ cfg, db, clock });
  const loginLimit = createLimiter({ windowMs: 60_000, max: 10, clock });
  const registerLimit = createLimiter({ windowMs: 3_600_000, max: 5, clock });

  const q = {
    accountByNumber: db.prepare('SELECT * FROM accounts WHERE number_hash = ?'),
    accountByUsername: db.prepare('SELECT * FROM accounts WHERE username = ?'),
    account: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertAccount: db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)'),
    insertAccountWithCreds: db.prepare('INSERT INTO accounts (number_hash, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    keys: db.prepare('SELECT * FROM api_keys WHERE account_id = ? ORDER BY id'),
    keyCount: db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?'),
    keyById: db.prepare('SELECT * FROM api_keys WHERE id = ? AND account_id = ?'),
    keyByHash: db.prepare(
      `SELECT k.id AS key_id, k.enabled, k.masked, a.id AS account_id, a.balance, a.disabled
       FROM api_keys k JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ?`,
    ),
    insertKey: db.prepare(
      'INSERT INTO api_keys (account_id, name, key_hash, masked, created_at, key_sealed) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    touchKey: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
    insertUsage: db.prepare(
      `INSERT INTO usage (account_id, key_id, key_masked, model, route, status, input_tokens, output_tokens,
        total_tokens, rate, charged, stream, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    charge: db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?'),
    modelAccess: db.prepare('SELECT quota, used, upstream_key_sealed FROM model_access WHERE account_id = ? AND model = ?'),
    modelAccessAll: db.prepare('SELECT model, quota, used, granted_at FROM model_access WHERE account_id = ?'),
    chargeModelUsage: db.prepare('UPDATE model_access SET used = used + ? WHERE account_id = ? AND model = ?'),
    usageSince: db.prepare('SELECT created_at, total_tokens, status FROM usage WHERE account_id = ? AND created_at >= ?'),
    countSince: db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS ok
       FROM usage WHERE account_id = ? AND created_at >= ?`,
    ),
    countBetween: db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS ok
       FROM usage WHERE account_id = ? AND created_at >= ? AND created_at < ?`,
    ),
    durationsSince: db.prepare(
      'SELECT duration_ms FROM usage WHERE account_id = ? AND created_at >= ? AND duration_ms IS NOT NULL ORDER BY duration_ms',
    ),
    durationsBetween: db.prepare(
      'SELECT duration_ms FROM usage WHERE account_id = ? AND created_at >= ? AND created_at < ? AND duration_ms IS NOT NULL ORDER BY duration_ms',
    ),
    payments: db.prepare(
      'SELECT id, provider, amount_eur, tokens, status, note, created_at FROM payments WHERE account_id = ? ORDER BY id DESC LIMIT 100',
    ),
    insertPayment: db.prepare(
      `INSERT INTO payments (account_id, provider, reference, amount_eur, tokens, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    paymentByRef: db.prepare('SELECT * FROM payments WHERE reference = ?'),
    setPaymentRef: db.prepare('UPDATE payments SET reference = ?, updated_at = ? WHERE id = ?'),
    setPaymentStatus: db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?'),
  };

  const newSession = (accountId) => {
    const token = newSessionToken();
    const t = clock();
    q.insertSession.run(hash(token), accountId, t, t + cfg.sessionDays * DAY);
    return token;
  };
  const publicKey = (k) => ({
    id: k.id,
    name: k.name,
    masked: k.masked,
    enabled: !!k.enabled,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // ---------------------------------------------------------------- dashboard (session token)
  const site = new Hono();
  site.use(
    '*',
    cors({
      origin: (origin) => (cfg.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  site.post('/auth/register', async (c) => {
    if (!cfg.openRegistration) return c.json({ error: 'registration_closed' }, 403);
    if (!registerLimit(ip(c))) return c.json({ error: 'too_many_requests' }, 429);
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!isUsername(username)) return c.json({ error: 'invalid_username' }, 400);
    if (password.length < 6) return c.json({ error: 'password_too_short' }, 400);
    if (q.accountByUsername.get(username)) return c.json({ error: 'username_taken' }, 409);
    const number = newAccessNumber();
    let id;
    try {
      id = Number(q.insertAccountWithCreds.run(hash(number), username, hashPassword(password), clock()).lastInsertRowid);
    } catch {
      return c.json({ error: 'username_taken' }, 409);
    }
    return c.json({ token: newSession(id) }, 201);
  });

  site.post('/auth/login', async (c) => {
    if (!loginLimit(ip(c))) return c.json({ error: 'too_many_requests' }, 429);
    const body = await c.req.json().catch(() => ({}));
    // Legacy: login with 16-digit edgey ID
    if (body.number) {
      const digits = normalizeNumber(body.number);
      if (!isAccessNumber(digits)) return c.json({ error: 'invalid_number' }, 400);
      const account = q.accountByNumber.get(hash(digits));
      if (!account || account.disabled) return c.json({ error: 'unknown_number' }, 401);
      return c.json({ token: newSession(account.id) });
    }
    // Username + password login
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!username || !password) return c.json({ error: 'missing_credentials' }, 400);
    const account = q.accountByUsername.get(username);
    if (!account || account.disabled || !account.password_hash) return c.json({ error: 'invalid_credentials' }, 401);
    if (!verifyPassword(password, account.password_hash)) return c.json({ error: 'invalid_credentials' }, 401);
    return c.json({ token: newSession(account.id) });
  });

  site.use('/me/*', auth);
  site.use('/me', auth);
  site.use('/keys/*', auth);
  site.use('/keys', auth);
  site.use('/usage', auth);
  site.use('/requests', auth);
  site.use('/payments', auth);
  site.use('/topup', auth);
  site.use('/auth/logout', auth);

  async function auth(c, next) {
    if (c.req.method === 'OPTIONS') return next();
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const account = token ? q.session.get(hash(token), clock()) : null;
    if (!account || account.disabled) return c.json({ error: 'unauthorized' }, 401);
    c.set('account', account);
    c.set('token', token);
    await next();
  }

  site.post('/auth/logout', (c) => {
    q.deleteSession.run(hash(c.get('token')));
    return c.json({ ok: true });
  });

  site.get('/me', async (c) => {
    const a = c.get('account');
    const t = clock();
    const day = q.countSince.get(a.id, t - DAY);
    const quarter = q.countSince.get(a.id, t - 90 * DAY);
    const prevDay = q.countBetween.get(a.id, t - 2 * DAY, t - DAY);
    const durations = q.durationsSince.all(a.id, t - DAY);
    const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)].duration_ms : null;
    const prevDurations = q.durationsBetween.all(a.id, t - 2 * DAY, t - DAY);
    const prevP95 = prevDurations.length > 0 ? prevDurations[Math.floor(prevDurations.length * 0.95)].duration_ms : null;
    const keys = q.keys.all(a.id);
    return c.json({
      balance: a.balance,
      paidEur: a.paid_eur,
      createdAt: a.created_at,
      keyCount: keys.length,
      maxKeys: catalog.maxKeysPerAccount,
      firstKey: keys[0]?.masked ?? null,
      requests24h: day.n,
      successful24h: day.ok ?? 0,
      prevRequests24h: prevDay.n,
      prevSuccessful24h: prevDay.ok ?? 0,
      p95_24h: p95,
      prevP95_24h: prevP95,
      requests90d: quarter.n,
      // CLI key linked by the admin: plan, status and usage read from the provider.
      cli: await cli.status(a.id),
      modelAccess: q.modelAccessAll.all(a.id).map(({ model, quota, used, granted_at }) => ({
        model, quota, used, remaining: Math.max(0, quota - used), grantedAt: granted_at,
      })),
    });
  });

  site.get('/keys', (c) => c.json({ keys: q.keys.all(c.get('account').id).map(publicKey) }));

  site.post('/keys', async (c) => {
    if (!cfg.customerKeys) return c.json({ error: 'key_creation_disabled' }, 403);
    const a = c.get('account');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim().slice(0, 40) || 'API key';
    if (q.keyCount.get(a.id).n >= catalog.maxKeysPerAccount) return c.json({ error: 'key_limit' }, 409);
    const key = newApiKey();
    const id = Number(q.insertKey.run(a.id, name, hash(key), maskKey(key), clock(), sealSecret(cfg.pepper, key)).lastInsertRowid);
    // The full key is only ever returned here.
    return c.json({ key, ...publicKey(q.keyById.get(id, a.id)) }, 201);
  });

  site.patch('/keys/:id', async (c) => {
    const a = c.get('account');
    const k = q.keyById.get(Number(c.req.param('id')), a.id);
    if (!k) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.name === 'string' && body.name.trim())
      db.prepare('UPDATE api_keys SET name = ? WHERE id = ?').run(body.name.trim().slice(0, 40), k.id);
    if (typeof body.enabled === 'boolean')
      db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, k.id);
    return c.json(publicKey(q.keyById.get(k.id, a.id)));
  });

  site.delete('/keys/:id', (c) => {
    const a = c.get('account');
    const k = q.keyById.get(Number(c.req.param('id')), a.id);
    if (!k) return c.json({ error: 'not_found' }, 404);
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(k.id);
    return c.json({ ok: true });
  });

  site.get('/usage', (c) => {
    const range = RANGES[c.req.query('range') ?? '24h'] ? (c.req.query('range') ?? '24h') : '24h';
    const { span, buckets } = RANGES[range];
    const end = clock();
    const start = end - span;
    const size = span / buckets;
    const series = Array.from({ length: buckets }, (_, i) => ({ start: start + i * size, tokens: 0 }));
    let tokens = 0;
    let requests = 0;
    let successful = 0;
    for (const r of q.usageSince.all(c.get('account').id, start)) {
      const i = Math.min(buckets - 1, Math.floor((r.created_at - start) / size));
      series[i].tokens += r.total_tokens;
      tokens += r.total_tokens;
      requests++;
      if (r.status >= 200 && r.status < 300) successful++;
    }
    return c.json({ range, tokens, requests, successful, peak: Math.max(0, ...series.map((s) => s.tokens)), buckets: series });
  });

  site.get('/requests', (c) => {
    const a = c.get('account');
    const search = `%${(c.req.query('q') ?? '').trim()}%`;
    const status = c.req.query('status') ?? 'all';
    const cond =
      status === 'ok' ? 'AND status BETWEEN 200 AND 299' : status === 'error' ? 'AND status NOT BETWEEN 200 AND 299' : '';
    const rows = db
      .prepare(
        `SELECT id, model, route, status, input_tokens, output_tokens, total_tokens, rate, charged, stream,
                duration_ms, key_masked, created_at
         FROM usage WHERE account_id = ? AND (model LIKE ? OR IFNULL(key_masked, '') LIKE ?) ${cond}
         ORDER BY id DESC LIMIT 50`,
      )
      .all(a.id, search, search);
    return c.json({ requests: rows });
  });

  site.get('/payments', (c) => c.json({ payments: q.payments.all(c.get('account').id) }));

  site.post('/topup', async (c) => {
    const a = c.get('account');
    const body = await c.req.json().catch(() => ({}));
    const pack = catalog.packs[Number(body.pack)];
    const coin = catalog.coins.find((x) => x.id === body.coin);
    if (!pack || !coin) return c.json({ error: 'invalid_pack_or_coin' }, 400);
    if (!cfg.nowpayments.apiKey) return c.json({ error: 'crypto_unavailable' }, 503);

    const t = clock();
    const id = Number(
      q.insertPayment.run(a.id, 'nowpayments', null, pack.eur, pack.tokens, 'pending', coin.id, t, t).lastInsertRowid,
    );
    const orderId = `edgey_${id}`;
    q.setPaymentRef.run(orderId, t, id);
    try {
      const invoice = await createInvoice(cfg, {
        orderId,
        eur: pack.eur,
        coin: coin.id,
        description: `cli.eminencehw.com top-up: ${pack.tokens.toLocaleString('en-US')} tokens`,
      });
      return c.json({ invoiceUrl: invoice.invoice_url, paymentId: id });
    } catch (err) {
      console.error(err);
      q.setPaymentStatus.run('failed', clock(), id);
      return c.json({ error: 'payment_provider_error' }, 502);
    }
  });

  app.route('/', site);
  app.route('/admin', adminRoutes({ cfg, db, clock, cli }));
  app.route('/dashboard', dashboardRoutes());
  app.route('/panel', panelRoutes());
  app.route('/', cliReleaseRoutes(cfg.releasesDir));

  // ---------------------------------------------------------------- NOWPayments callbacks
  app.post('/webhooks/nowpayments', async (c) => {
    const raw = await c.req.text();
    if (!verifyIpn(cfg.nowpayments.ipnSecret, raw, c.req.header('x-nowpayments-sig')))
      return c.json({ error: 'bad_signature' }, 401);
    const event = JSON.parse(raw);
    const p = q.paymentByRef.get(String(event.order_id ?? ''));
    if (!p || p.provider !== 'nowpayments') return c.json({ ignored: true });

    const status = String(event.payment_status ?? 'unknown');
    const paidInFull =
      status === 'finished' &&
      Number(event.price_amount) >= p.amount_eur &&
      String(event.price_currency ?? '').toLowerCase() === 'eur';
    if (paidInFull) creditPayment(db, p.id);
    else if (!p.credited) q.setPaymentStatus.run(status, clock(), p.id);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- public API (API keys)
  const keyFrom = (c) => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    return c.req.header('x-api-key') ?? bearer ?? '';
  };

  // Cache validated partner keys for 60s to avoid hitting the partner endpoint on every request.
  const _partnerKeyCache = new Map();
  const PARTNER_KEY_TTL = 60_000;

  async function validatePartnerKey(key) {
    if (!cfg.partnerBase) return null;
    try {
      const res = await fetch(`${cfg.partnerBase}/v1/account`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }

  const apiAuth = (kind) => async (c, next) => {
    const key = keyFrom(c);
    // Try local key first.
    const row = isApiKey(key) ? q.keyByHash.get(hash(key)) : null;
    if (row && row.enabled && !row.disabled) {
      c.set('key', row);
      return next();
    }
    // Try partner endpoint validation for non-local keys.
    if (!isApiKey(key) && key.length >= 8 && key.length <= 4096 && !/\s/.test(key)) {
      const cacheKey = hash(key);
      const cached = _partnerKeyCache.get(cacheKey);
      if (cached && clock() - cached.at < PARTNER_KEY_TTL) {
        c.set('key', { ...cached.row, _partnerKey: key });
        return next();
      }
      const account = await validatePartnerKey(key);
      if (account) {
        const tokens = account.remaining_tokens ?? 0;
        const virtual = {
          key_id: null, account_id: null, enabled: 1, disabled: 0,
          masked: key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : '••••',
          balance: Infinity,
          _partnerAccount: account,
        };
        _partnerKeyCache.set(cacheKey, { row: virtual, at: clock() });
        c.set('key', { ...virtual, _partnerKey: key });
        return next();
      }
    }
    return c.json(errorBody(kind, 401, 'authentication_error', 'Invalid or disabled API key.'), 401);
  };

  app.get('/v1/models', apiAuth('openai'), async (c) => {
    const key = c.get('key');
    if (key._partnerKey && cfg.partnerBase) {
      try {
        const res = await fetch(`${cfg.partnerBase}/v1/models`, {
          headers: { authorization: `Bearer ${key._partnerKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return c.json(await res.json());
      } catch {}
    }
    return c.json({
      object: 'list',
      data: allModels().map((m) => ({ id: m.id, object: 'model', owned_by: m.provider, rate: m.rate })),
    });
  });

  // CLI capabilities: tells the client which modes are available (e.g. opus-private for JB).
  app.get('/v1/cli-capabilities', apiAuth('openai'), async (c) => {
    const key = c.get('key');
    // Partner key: proxy capabilities from the partner endpoint.
    if (key._partnerKey) {
      try {
        const res = await fetch(`${cfg.partnerBase}/v1/cli-capabilities`, { headers: { authorization: `Bearer ${key._partnerKey}` }, signal: AbortSignal.timeout(10_000) });
        if (res.ok) return c.json(await res.json());
      } catch {}
      return c.json({ privateModes: [] });
    }
    const caps = await getDawvqCapabilities(cfg);
    const privateModes = [];
    const access = db.prepare('SELECT model FROM model_access WHERE account_id = ?').all(key.account_id);
    const hasOpusPrivate = access.some((r) => r.model === 'opus-private');
    if (hasOpusPrivate && caps) {
      const src = Array.isArray(caps.privateModes) ? caps.privateModes
        : Array.isArray(caps.modes) ? caps.modes : [];
      const opusEntry = src.find((m) => m.id === 'opus-private');
      if (opusEntry) {
        privateModes.push({
          id: opusEntry.id,
          revision: opusEntry.revision,
          overheadTokens: opusEntry.overheadTokens ?? 4096,
          models: opusEntry.models ?? ['claude-opus-5'],
        });
      } else if (caps['opus-private']) {
        privateModes.push({
          id: 'opus-private',
          revision: caps['opus-private'],
          overheadTokens: 4096,
          models: ['claude-opus-5'],
        });
      }
    }
    return c.json({ privateModes });
  });

  // Balance of the key's account, in the same shape as the upstream provider's /v1/account,
  // so CLIs that read it show the edgey balance.
  app.get('/v1/account', apiAuth('openai'), (c) => {
    const row = c.get('key');
    // Partner key: map the partner response to the CLI expected format.
    if (row._partnerAccount) {
      const tokens = row._partnerAccount.remaining_tokens ?? 0;
      return c.json({
        version: 1, unit: 'weighted_provider_units', updatedAt: new Date(clock()).toISOString(),
        status: tokens > 0 ? 'active' : 'exhausted', plan: 'edgey', expiresAt: null,
        limit: tokens, used: 0, reserved: 0, available: tokens, estimatedRequests: 0,
      });
    }
    const used = db.prepare('SELECT IFNULL(SUM(charged), 0) AS n FROM usage WHERE account_id = ?').get(row.account_id).n;
    const available = Math.max(0, row.balance);
    return c.json({
      version: 1,
      unit: 'weighted_provider_units',
      updatedAt: new Date(clock()).toISOString(),
      status: available > 0 ? 'active' : 'exhausted',
      plan: 'edgey',
      expiresAt: null,
      limit: available + used,
      used,
      reserved: 0,
      available,
      estimatedRequests: 0,
    });
  });

  const proxied = (kind, path, { billed = true } = {}) => [
    apiAuth(kind),
    async (c) => {
      const key = c.get('key');
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body.model !== 'string')
        return c.json(errorBody(kind, 400, 'invalid_request_error', 'Request body must be JSON with a "model".'), 400);

      // Partner passthrough: use the customer's own partner key, relay via partner endpoint, skip local billing.
      // Force non-streaming: the partner endpoint may not support stream_options and its SSE format
      // may differ from what the CLI expects. The CLI handles JSON responses transparently.
      if (key._partnerKey) {
        const upModel = upstreamModel(body.model);
        const { stream: _s, stream_options: _so, ...rest } = body;
        const upBody = { ...rest, model: upModel, stream: false };
        console.log('[partner] relaying %s (stream forced off, model %s → %s)', path, body.model, upModel);
        return relay({ cfg, kind, path, body: upBody, incoming: c.req.raw, upstreamKey: key._partnerKey, upstreamBase: cfg.partnerBase, onDone: (usage, status) => {
          console.log('[partner] relay done, status %d, usage %s', status, JSON.stringify(usage));
        } });
      }

      const info = modelInfo(body.model);
      if (!info)
        return c.json(errorBody(kind, 404, 'not_found_error', `Model "${body.model}" is not available.`), 404);
      let customerUpstreamKey;
      if (isRestricted(body.model)) {
        const access = q.modelAccess.get(key.account_id, body.model);
        if (!access)
          return c.json(errorBody(kind, 403, 'access_denied', `Model "${body.model}" requires a separate subscription. Contact us to get access.`), 403);
        if (access.quota > 0 && access.used >= access.quota)
          return c.json(errorBody(kind, 403, 'quota_exceeded', `Your ${body.model} subscription quota is used up (${(access.quota / 1e6).toFixed(0)}M tokens). Renew your subscription to continue.`), 403);
        if (access.upstream_key_sealed)
          customerUpstreamKey = openSecret(cfg.pepper, access.upstream_key_sealed);
      }
      if (billed && key.balance < 1000)
        return c.json(
          errorBody(kind, 402, 'insufficient_balance', 'Your wallet is empty. Top up at cli.eminencehw.com.'),
          402,
        );

      // Pass dawvq_mode to upstream if the user has the corresponding permission.
      let dawvqMode = null;
      if (body.dawvq_mode && typeof body.dawvq_mode === 'object' && body.dawvq_mode.id) {
        const modeAccess = db.prepare('SELECT 1 FROM model_access WHERE account_id = ? AND model = ?').get(key.account_id, body.dawvq_mode.id);
        if (!modeAccess)
          return c.json(errorBody(kind, 403, 'jailbreak_not_allowed', 'You do not have access to this mode.'), 403);
        dawvqMode = body.dawvq_mode;
      }

      const started = clock();
      q.touchKey.run(started, key.key_id);
      const upModel = upstreamModel(body.model);
      let upBody = upModel !== body.model ? { ...body, model: upModel } : body;
      if (dawvqMode) upBody = { ...upBody, dawvq_mode: dawvqMode };
      return relay({
        cfg,
        kind,
        path,
        body: upBody,
        incoming: c.req.raw,
        upstreamKey: customerUpstreamKey,
        onDone: (usage, status) => {
          if (!billed) return;
          const total = usage?.total ?? 0;
          const charged = costOf(total, info.rate);
          tx(db, () => {
            q.insertUsage.run(
              key.account_id,
              key.key_id,
              key.masked,
              body.model,
              path,
              status,
              usage?.input ?? 0,
              usage?.output ?? 0,
              total,
              info.rate,
              charged,
              body.stream === true ? 1 : 0,
              clock() - started,
              clock(),
            );
            if (charged > 0) q.charge.run(charged, key.account_id);
            if (total > 0 && isRestricted(body.model)) q.chargeModelUsage.run(total, key.account_id, body.model);
          });
        },
      });
    },
  ];

  app.post('/v1/chat/completions', ...proxied('openai', '/chat/completions'));
  app.post('/v1/messages', ...proxied('anthropic', '/messages'));
  app.post('/v1/messages/count_tokens', ...proxied('anthropic', '/messages/count_tokens', { billed: false }));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });
  return app;
}
