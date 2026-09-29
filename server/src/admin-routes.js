import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { catalog } from './billing.js';
import { creditPayment, now } from './db.js';
import { createLimiter } from './ratelimit.js';
import { hashSecret, isAccessNumber, maskSecret, newAccessNumber, normalizeNumber, openSecret, sealSecret } from './security.js';

const DAY = 86_400_000;

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** /admin/*: stats, accounts, manual credits. Protected by ADMIN_TOKEN (Bearer). */
export function adminRoutes({ cfg, db, clock = now, cli }) {
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
    cli: cli.cached(a.id),
    providerId: a.provider_id_masked ?? null,
    discord: a.discord ?? null,
    note: a.note ?? null,
  });

  const providerHash = (v) => hashSecret(cfg.pepper, 'provider:' + String(v).trim().toLowerCase());

  /** Sets the admin-only profile fields that are present in `body`; returns an error code or null. */
  function setProfile(id, body) {
    if (body.providerUserId !== undefined) {
      const v = body.providerUserId === null ? '' : String(body.providerUserId).trim();
      if (v.length > 80) return 'invalid_provider_id';
      if (v) {
        const other = db.prepare('SELECT id FROM accounts WHERE provider_id_hash = ? AND id != ?').get(providerHash(v), id);
        if (other) return 'provider_id_in_use';
        db.prepare('UPDATE accounts SET provider_id_sealed = ?, provider_id_hash = ?, provider_id_masked = ? WHERE id = ?').run(
          sealSecret(cfg.pepper, v),
          providerHash(v),
          maskSecret(v),
          id,
        );
      } else {
        db.prepare('UPDATE accounts SET provider_id_sealed = NULL, provider_id_hash = NULL, provider_id_masked = NULL WHERE id = ?').run(id);
      }
    }
    for (const field of ['discord', 'note']) {
      if (body[field] === undefined) continue;
      const v = body[field] === null ? '' : String(body[field]).trim().slice(0, field === 'note' ? 200 : 80);
      db.prepare(`UPDATE accounts SET ${field} = ? WHERE id = ?`).run(v || null, id);
    }
    return null;
  }

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
    const toFulfil = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE credited = 1 AND fulfilled = 0 AND provider = 'nowpayments'").get().n;
    const linked = db.prepare('SELECT COUNT(*) AS n FROM cli_keys').get().n;
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
      cliKeys: linked,
      paymentsToFulfil: toFulfil,
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

  admin.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { cliKey } = body;
    const number = newAccessNumber();
    const id = Number(
      db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)').run(hashSecret(cfg.pepper, number), clock())
        .lastInsertRowid,
    );
    const profileError = setProfile(id, body);
    if (profileError) {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      return c.json({ error: profileError }, profileError === 'provider_id_in_use' ? 409 : 400);
    }
    if (cliKey) {
      const out = await cli.link(id, cliKey);
      if (out.error) {
        db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
        return c.json({ error: out.error }, out.error === 'provider_unavailable' ? 502 : 400);
      }
    }
    return c.json({ number, account: summary(account(id)) }, 201);
  });

  // Admin notes about an account: provider user id, Discord, free note.
  admin.post('/accounts/:id/profile', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const err = setProfile(a.id, await c.req.json().catch(() => ({})));
    if (err) return c.json({ error: err }, err === 'provider_id_in_use' ? 409 : 400);
    return c.json(summary(account(a.id)));
  });

  // One search box: edgey ID, provider user id, Discord, note or #account.
  admin.get('/search', (c) => {
    const q = String(c.req.query('q') ?? '').trim();
    if (!q) return c.json({ accounts: [] });
    const found = new Map();
    const add = (rows) => rows.forEach((r) => found.set(r.id, r));
    const digits = normalizeNumber(q);
    if (isAccessNumber(digits)) add(db.prepare('SELECT * FROM accounts WHERE number_hash = ?').all(hashSecret(cfg.pepper, digits)));
    add(db.prepare('SELECT * FROM accounts WHERE provider_id_hash = ?').all(providerHash(q)));
    if (/^#?\d{1,9}$/.test(q)) add(db.prepare('SELECT * FROM accounts WHERE id = ?').all(Number(q.replace('#', ''))));
    const like = `%${q.replace(/[%_]/g, '')}%`;
    add(db.prepare('SELECT * FROM accounts WHERE discord LIKE ? OR note LIKE ? ORDER BY id DESC LIMIT 20').all(like, like));
    return c.json({ accounts: [...found.values()].slice(0, 20).map(summary) });
  });

  // Link (or replace) the CLI key an account uses; { key: null } removes it.
  admin.post('/accounts/:id/cli', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const { key } = await c.req.json().catch(() => ({}));
    if (key === null) {
      cli.unlink(a.id);
      return c.json(summary(account(a.id)));
    }
    const out = await cli.link(a.id, key);
    if (out.error) return c.json({ error: out.error }, out.error === 'provider_unavailable' ? 502 : 400);
    return c.json(summary(account(a.id)));
  });

  admin.get('/accounts/:id', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    return c.json({
      ...summary(a),
      // Full provider user id, only here, for logging into the provider's site.
      providerIdFull: a.provider_id_sealed ? openSecret(cfg.pepper, a.provider_id_sealed) : null,
      cli: await cli.status(a.id),
      apiKeys: db
        .prepare('SELECT id, name, masked, enabled, created_at, last_used_at FROM api_keys WHERE account_id = ? ORDER BY id')
        .all(a.id),
      payments: db
        .prepare('SELECT id, provider, amount_eur, tokens, status, note, credited, fulfilled, created_at FROM payments WHERE account_id = ? ORDER BY id DESC LIMIT 50')
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
          'SELECT id, account_id, provider, amount_eur, tokens, status, note, credited, fulfilled, created_at FROM payments ORDER BY id DESC LIMIT ?',
        )
        .all(limit),
    });
  });

  // Paid top-up loaded at the provider (tokens added to the customer's CLI key).
  admin.post('/payments/:id/fulfilled', async (c) => {
    const p = db.prepare('SELECT id FROM payments WHERE id = ?').get(Number(c.req.param('id')));
    if (!p) return c.json({ error: 'not_found' }, 404);
    const { fulfilled } = await c.req.json().catch(() => ({}));
    if (typeof fulfilled !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
    db.prepare('UPDATE payments SET fulfilled = ?, updated_at = ? WHERE id = ?').run(fulfilled ? 1 : 0, clock(), p.id);
    return c.json({ ok: true });
  });

  return admin;
}
