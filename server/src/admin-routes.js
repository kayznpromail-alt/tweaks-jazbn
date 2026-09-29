import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { catalog } from './billing.js';
import { creditPayment, now } from './db.js';
import { createLimiter } from './ratelimit.js';
import { hashSecret, isAccessNumber, newAccessNumber, normalizeNumber } from './security.js';

const DAY = 86_400_000;

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** /admin/*: stats, accounts, manual credits. Protected by ADMIN_TOKEN (Bearer). */
export function adminRoutes({ cfg, db, clock = now }) {
  const admin = new Hono();
  const failures = createLimiter({ windowMs: 15 * 60_000, max: 20, clock });
  const ip = (c) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';

  admin.use(
    '*',
    cors({
      origin: (origin) => (cfg.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  admin.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    if (!cfg.adminToken) return c.json({ error: 'admin_disabled' }, 404);
    const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!sameSecret(given, cfg.adminToken)) {
      if (!failures(ip(c))) return c.json({ error: 'too_many_requests' }, 429);
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  const account = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const summary = (a) => ({
    id: a.id,
    balance: a.balance,
    paidEur: a.paid_eur,
    disabled: !!a.disabled,
    createdAt: a.created_at,
    keys: db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?').get(a.id).n,
    lastRequestAt: db.prepare('SELECT MAX(created_at) AS t FROM usage WHERE account_id = ?').get(a.id).t,
  });

  admin.get('/stats', (c) => {
    const t = clock();
    const a = db
      .prepare('SELECT COUNT(*) AS n, IFNULL(SUM(balance), 0) AS owed, IFNULL(SUM(paid_eur), 0) AS paid FROM accounts')
      .get();
    const u = db
      .prepare('SELECT COUNT(*) AS n, IFNULL(SUM(total_tokens), 0) AS tokens, IFNULL(SUM(charged), 0) AS charged FROM usage WHERE created_at >= ?')
      .get(t - DAY);
    const p = db
      .prepare("SELECT COUNT(*) AS n, IFNULL(SUM(amount_eur), 0) AS eur FROM payments WHERE credited = 1 AND updated_at >= ?")
      .get(t - 30 * DAY);
    const active = db.prepare('SELECT COUNT(DISTINCT account_id) AS n FROM usage WHERE created_at >= ?').get(t - DAY).n;
    return c.json({
      accounts: a.n,
      activeAccounts24h: active,
      tokensOwed: a.owed,
      revenueEur: a.paid,
      revenue30dEur: p.eur,
      payments30d: p.n,
      requests24h: u.n,
      tokens24h: u.tokens,
      charged24h: u.charged,
    });
  });

  admin.get('/accounts', (c) => {
    const limit = Math.min(200, Number(c.req.query('limit') ?? 50) || 50);
    const rows = db.prepare('SELECT * FROM accounts ORDER BY id DESC LIMIT ?').all(limit);
    return c.json({ accounts: rows.map(summary) });
  });

  // Access numbers are stored hashed: find an account from the number a customer gives on Discord.
  admin.post('/lookup', async (c) => {
    const { number } = await c.req.json().catch(() => ({}));
    const digits = normalizeNumber(number);
    if (!isAccessNumber(digits)) return c.json({ error: 'invalid_number' }, 400);
    const a = db.prepare('SELECT * FROM accounts WHERE number_hash = ?').get(hashSecret(cfg.pepper, digits));
    return a ? c.json(summary(a)) : c.json({ error: 'not_found' }, 404);
  });

  admin.post('/accounts', (c) => {
    const number = newAccessNumber();
    const id = Number(
      db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)').run(hashSecret(cfg.pepper, number), clock())
        .lastInsertRowid,
    );
    return c.json({ number, account: summary(account(id)) }, 201);
  });

  admin.get('/accounts/:id', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    return c.json({
      ...summary(a),
      apiKeys: db
        .prepare('SELECT id, name, masked, enabled, created_at, last_used_at FROM api_keys WHERE account_id = ? ORDER BY id')
        .all(a.id),
      payments: db
        .prepare('SELECT id, provider, amount_eur, tokens, status, note, created_at FROM payments WHERE account_id = ? ORDER BY id DESC LIMIT 50')
        .all(a.id),
      usage: db
        .prepare('SELECT model, status, total_tokens, charged, created_at FROM usage WHERE account_id = ? ORDER BY id DESC LIMIT 50')
        .all(a.id),
    });
  });

  admin.post('/accounts/:id/credit', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const pack = body.packEur != null ? catalog.packs.find((p) => p.eur === Number(body.packEur)) : null;
    if (body.packEur != null && !pack) return c.json({ error: 'unknown_pack' }, 400);
    const tokens = pack ? pack.tokens : Math.round(Number(body.tokens));
    const eur = pack ? pack.eur : Number(body.eur ?? 0);
    // Negative amounts are allowed as corrections, but never below zero balance.
    if (!Number.isFinite(tokens) || tokens === 0 || !Number.isFinite(eur)) return c.json({ error: 'invalid_amount' }, 400);
    if (a.balance + tokens < 0) return c.json({ error: 'balance_would_go_negative' }, 400);
    const t = clock();
    const note = String(body.note ?? (pack ? 'pack' : 'manual credit')).slice(0, 120);
    const id = Number(
      db
        .prepare(
          `INSERT INTO payments (account_id, provider, amount_eur, tokens, status, note, created_at, updated_at)
           VALUES (?, 'manual', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(a.id, eur, tokens, note, t, t).lastInsertRowid,
    );
    creditPayment(db, id);
    return c.json(summary(account(a.id)));
  });

  admin.post('/accounts/:id/status', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const { disabled } = await c.req.json().catch(() => ({}));
    if (typeof disabled !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
    db.prepare('UPDATE accounts SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, a.id);
    if (disabled) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
    return c.json(summary(account(a.id)));
  });

  admin.get('/payments', (c) => {
    const limit = Math.min(200, Number(c.req.query('limit') ?? 50) || 50);
    return c.json({
      payments: db
        .prepare(
          'SELECT id, account_id, provider, amount_eur, tokens, status, note, credited, created_at FROM payments ORDER BY id DESC LIMIT ?',
        )
        .all(limit),
    });
  });

  return admin;
}
