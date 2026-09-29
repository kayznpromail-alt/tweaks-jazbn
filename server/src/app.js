import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { allModels, catalog, costOf, modelInfo } from './billing.js';
import { creditPayment, now, tx } from './db.js';
import { createInvoice, verifyIpn } from './nowpayments.js';
import { createLimiter } from './ratelimit.js';
import { adminRoutes } from './admin-routes.js';
import { errorBody, relay } from './relay.js';
import {
  hashSecret,
  isAccessNumber,
  isApiKey,
  maskKey,
  newAccessNumber,
  newApiKey,
  newSessionToken,
  normalizeNumber,
} from './security.js';

const DAY = 86_400_000;
const RANGES = {
  '24h': { span: DAY, buckets: 24 },
  '7d': { span: 7 * DAY, buckets: 7 },
  '30d': { span: 30 * DAY, buckets: 30 },
};

export function createApp({ cfg, db, clock = now }) {
  const app = new Hono();
  const hash = (v) => hashSecret(cfg.pepper, v);
  const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';

  const loginLimit = createLimiter({ windowMs: 60_000, max: 10, clock });
  const registerLimit = createLimiter({ windowMs: 3_600_000, max: 5, clock });

  const q = {
    accountByNumber: db.prepare('SELECT * FROM accounts WHERE number_hash = ?'),
    account: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertAccount: db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)'),
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
      'INSERT INTO api_keys (account_id, name, key_hash, masked, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    touchKey: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
    insertUsage: db.prepare(
      `INSERT INTO usage (account_id, key_id, key_masked, model, route, status, input_tokens, output_tokens,
        total_tokens, rate, charged, stream, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    charge: db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?'),
    usageSince: db.prepare('SELECT created_at, total_tokens, status FROM usage WHERE account_id = ? AND created_at >= ?'),
    countSince: db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS ok
       FROM usage WHERE account_id = ? AND created_at >= ?`,
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

  site.post('/auth/register', (c) => {
    if (!registerLimit(ip(c))) return c.json({ error: 'too_many_requests' }, 429);
    let number;
    let id;
    for (let tries = 0; tries < 5 && !id; tries++) {
      number = newAccessNumber();
      try {
        id = Number(q.insertAccount.run(hash(number), clock()).lastInsertRowid);
      } catch {}
    }
    if (!id) return c.json({ error: 'try_again' }, 500);
    return c.json({ number, token: newSession(id) }, 201);
  });

  site.post('/auth/login', async (c) => {
    if (!loginLimit(ip(c))) return c.json({ error: 'too_many_requests' }, 429);
    const body = await c.req.json().catch(() => ({}));
    const digits = normalizeNumber(body.number);
    if (!isAccessNumber(digits)) return c.json({ error: 'invalid_number' }, 400);
    const account = q.accountByNumber.get(hash(digits));
    if (!account || account.disabled) return c.json({ error: 'unknown_number' }, 401);
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

  site.get('/me', (c) => {
    const a = c.get('account');
    const t = clock();
    const day = q.countSince.get(a.id, t - DAY);
    const quarter = q.countSince.get(a.id, t - 90 * DAY);
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
      requests90d: quarter.n,
    });
  });

  site.get('/keys', (c) => c.json({ keys: q.keys.all(c.get('account').id).map(publicKey) }));

  site.post('/keys', async (c) => {
    const a = c.get('account');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim().slice(0, 40) || 'API key';
    if (q.keyCount.get(a.id).n >= catalog.maxKeysPerAccount) return c.json({ error: 'key_limit' }, 409);
    const key = newApiKey();
    const id = Number(q.insertKey.run(a.id, name, hash(key), maskKey(key), clock()).lastInsertRowid);
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
        description: `edgeycli.com top-up: ${pack.tokens.toLocaleString('en-US')} tokens`,
      });
      return c.json({ invoiceUrl: invoice.invoice_url, paymentId: id });
    } catch (err) {
      console.error(err);
      q.setPaymentStatus.run('failed', clock(), id);
      return c.json({ error: 'payment_provider_error' }, 502);
    }
  });

  app.route('/', site);
  app.route('/admin', adminRoutes({ cfg, db, clock }));

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

  const apiAuth = (kind) => async (c, next) => {
    const key = keyFrom(c);
    const row = isApiKey(key) ? q.keyByHash.get(hash(key)) : null;
    if (!row || !row.enabled || row.disabled)
      return c.json(errorBody(kind, 401, 'authentication_error', 'Invalid or disabled API key.'), 401);
    c.set('key', row);
    await next();
  };

  app.get('/v1/models', apiAuth('openai'), (c) =>
    c.json({
      object: 'list',
      data: allModels().map((m) => ({ id: m.id, object: 'model', owned_by: m.provider, rate: m.rate })),
    }),
  );

  const proxied = (kind, path, { billed = true } = {}) => [
    apiAuth(kind),
    async (c) => {
      const key = c.get('key');
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body.model !== 'string')
        return c.json(errorBody(kind, 400, 'invalid_request_error', 'Request body must be JSON with a "model".'), 400);
      const info = modelInfo(body.model);
      if (!info)
        return c.json(errorBody(kind, 404, 'not_found_error', `Model "${body.model}" is not available.`), 404);
      if (billed && key.balance <= 0)
        return c.json(
          errorBody(kind, 402, 'insufficient_balance', 'Your wallet is empty. Top up at edgeycli.com.'),
          402,
        );

      const started = clock();
      q.touchKey.run(started, key.key_id);
      return relay({
        cfg,
        kind,
        path,
        body,
        incoming: c.req.raw,
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
