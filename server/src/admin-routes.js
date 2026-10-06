import { timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { catalog } from './billing.js';
import { creditPayment, now, tx } from './db.js';
import { createLimiter } from './ratelimit.js';
import { earningsFor, sumEarnings } from './earnings.js';
import {
  hashSecret,
  isAccessNumber,
  maskKey,
  maskSecret,
  newAccessNumber,
  newApiKey,
  normalizeNumber,
  openSecret,
  sealSecret,
} from './security.js';

const DAY = 86_400_000;

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** /admin/*: stats, accounts, manual credits. Protected by ADMIN_TOKEN (Bearer). */
// "200M", "1.5B", "500k" or a plain number of tokens.
const parseTokens = (input) => {
  const m = /^([\d.]+)\s*([kmb]?)$/i.exec(String(input).trim());
  return m ? Math.round(Number(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()]) : NaN;
};

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

  const account = (id) => db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(id);
  // Creates an edgey API key for the customer; the full key is also kept encrypted for admins.
  const issueKey = (accountId, name) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?').get(accountId).n;
    if (n >= catalog.maxKeysPerAccount) return null;
    const key = newApiKey();
    const id = Number(
      db
        .prepare('INSERT INTO api_keys (account_id, name, key_hash, masked, created_at, key_sealed) VALUES (?, ?, ?, ?, ?, ?)')
        .run(accountId, name, hashSecret(cfg.pepper, key), maskKey(key), clock(), sealSecret(cfg.pepper, key)).lastInsertRowid,
    );
    return { id, name, key, masked: maskKey(key) };
  };
  const saveNumber = (id, number) =>
    db.prepare('UPDATE accounts SET number_hash = ?, number_sealed = ? WHERE id = ?').run(hashSecret(cfg.pepper, number), sealSecret(cfg.pepper, number), id);
  const summary = (a) => ({
    id: a.id,
    balance: a.balance,
    paidEur: a.paid_eur,
    disabled: !!a.disabled,
    createdAt: a.created_at,
    keys: db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?').get(a.id).n,
    lastRequestAt: db.prepare('SELECT MAX(created_at) AS t FROM usage WHERE account_id = ?').get(a.id).t,
    modelAccess: db.prepare('SELECT model, quota, used FROM model_access WHERE account_id = ?').all(a.id),
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
      .prepare('SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS n, IFNULL(SUM(balance), 0) AS owed, IFNULL(SUM(paid_eur), 0) AS paid FROM accounts')
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
    const rows = db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(limit);
    return c.json({ accounts: rows.map(summary) });
  });

  // Access numbers are stored hashed: find an account from the number a customer gives on Discord.
  admin.post('/lookup', async (c) => {
    const { number } = await c.req.json().catch(() => ({}));
    const digits = normalizeNumber(number);
    if (!isAccessNumber(digits)) return c.json({ error: 'invalid_number' }, 400);
    const a = db.prepare('SELECT * FROM accounts WHERE number_hash = ? AND deleted_at IS NULL').get(hashSecret(cfg.pepper, digits));
    return a ? c.json(summary(a)) : c.json({ error: 'not_found' }, 404);
  });

  admin.post('/accounts', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { cliKey } = body;
    // Optional first sale, recorded with the account (its tokens become the customer's limit).
    const sale = body.sale ? parseSale(body.sale) : null;
    if (sale?.error) return c.json({ error: sale.error }, 400);
    if (sale && sale.tokens < 0) return c.json({ error: 'invalid_amount' }, 400);
    const number = newAccessNumber();
    const id = Number(
      db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)').run(hashSecret(cfg.pepper, number), clock())
        .lastInsertRowid,
    );
    saveNumber(id, number);
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
    const apiKey = body.apiKey ? issueKey(id, 'Main key') : null;
    if (sale) recordSale(id, sale);
    return c.json({ number, apiKey: apiKey?.key ?? null, account: summary(account(id)) }, 201);
  });

  // Replaces a lost edgey ID: the old one stops working and the customer is signed out.
  admin.post('/accounts/:id/number', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const number = newAccessNumber();
    saveNumber(a.id, number);
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(a.id);
    return c.json({ number, account: summary(account(a.id)) });
  });

  // Deletes an account: the customer can no longer log in, their keys stop working and the
  // provider user id can be used again. Payments stay, so the earnings history is unchanged.
  admin.delete('/accounts/:id', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    tx(db, () => {
      db.prepare(
        `UPDATE accounts SET deleted_at = ?, disabled = 1, number_hash = ?, number_sealed = NULL,
           provider_id_sealed = NULL, provider_id_hash = NULL, provider_id_masked = NULL WHERE id = ?`,
      ).run(clock(), `deleted:${a.id}:${clock()}`, a.id);
      for (const table of ['sessions', 'api_keys', 'cli_keys']) db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(a.id);
    });
    return c.json({ ok: true });
  });

  // edgey API keys created by us for the customer.
  admin.post('/accounts/:id/keys', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const out = issueKey(a.id, String(body.name ?? '').trim().slice(0, 40) || 'API key');
    return out ? c.json(out, 201) : c.json({ error: 'key_limit' }, 409);
  });

  admin.delete('/accounts/:id/keys/:keyId', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const r = db.prepare('DELETE FROM api_keys WHERE id = ? AND account_id = ?').run(Number(c.req.param('keyId')), a.id);
    return r.changes ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
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
    for (const [id, r] of found) if (r.deleted_at) found.delete(id);
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
      // The customer's edgey ID; null for accounts created before it was stored (use New edgey ID).
      numberFull: a.number_sealed ? openSecret(cfg.pepper, a.number_sealed) : null,
      cli: await cli.status(a.id),
      apiKeys: db
        .prepare('SELECT id, name, masked, enabled, created_at, last_used_at, key_sealed FROM api_keys WHERE account_id = ? ORDER BY id')
        .all(a.id)
        .map(({ key_sealed, ...k }) => ({ ...k, full: key_sealed ? openSecret(cfg.pepper, key_sealed) : null })),
      payments: db
        .prepare('SELECT id, provider, amount_eur, tokens, status, note, credited, fulfilled, created_at FROM payments WHERE account_id = ? ORDER BY id DESC LIMIT 50')
        .all(a.id),
      usage: db
        .prepare('SELECT model, status, total_tokens, charged, created_at FROM usage WHERE account_id = ? ORDER BY id DESC LIMIT 50')
        .all(a.id),
    });
  });

  // A sale: a catalog pack ({ packEur }) or any amount ({ tokens, eur }), with an optional note.
  const parseSale = (body) => {
    const pack = body.packEur != null ? catalog.packs.find((p) => p.eur === Number(body.packEur)) : null;
    if (body.packEur != null && !pack) return { error: 'unknown_pack' };
    const tokens = pack ? pack.tokens : typeof body.tokens === 'string' ? parseTokens(body.tokens) : Math.round(Number(body.tokens));
    const eur = pack ? pack.eur : Number(body.eur ?? 0);
    if (!Number.isFinite(tokens) || tokens === 0 || !Number.isFinite(eur)) return { error: 'invalid_amount' };
    return { tokens, eur, note: String(body.note ?? (pack ? 'pack' : 'manual credit')).slice(0, 120) };
  };
  const recordSale = (accountId, sale) => {
    const t = clock();
    const id = Number(
      db
        .prepare(
          `INSERT INTO payments (account_id, provider, amount_eur, tokens, status, note, created_at, updated_at)
           VALUES (?, 'manual', ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(accountId, sale.eur, sale.tokens, sale.note, t, t).lastInsertRowid,
    );
    creditPayment(db, id);
  };

  admin.post('/accounts/:id/credit', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const sale = parseSale(await c.req.json().catch(() => ({})));
    if (sale.error) return c.json({ error: sale.error }, 400);
    // Negative amounts are allowed as corrections, but never below zero balance.
    if (a.balance + sale.tokens < 0) return c.json({ error: 'balance_would_go_negative' }, 400);
    recordSale(a.id, sale);
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

  // Premium model access: grant or revoke per-account access to restricted models.
  admin.get('/accounts/:id/models', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const rows = db.prepare('SELECT model, quota, used, granted_at FROM model_access WHERE account_id = ? ORDER BY granted_at').all(a.id);
    return c.json({ models: rows });
  });

  admin.post('/accounts/:id/models', async (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const { model } = await c.req.json().catch(() => ({}));
    if (!model || typeof model !== 'string') return c.json({ error: 'invalid_model' }, 400);
    const existing = db.prepare('SELECT 1 FROM model_access WHERE account_id = ? AND model = ?').get(a.id, model);
    if (existing) {
      db.prepare('UPDATE model_access SET used = 0, granted_at = ? WHERE account_id = ? AND model = ?').run(clock(), a.id, model);
    } else {
      db.prepare('INSERT INTO model_access (account_id, model, granted_at) VALUES (?, ?, ?)').run(a.id, model, clock());
    }
    return c.json({ ok: true }, 201);
  });

  admin.delete('/accounts/:id/models/:model', (c) => {
    const a = account(Number(c.req.param('id')));
    if (!a) return c.json({ error: 'not_found' }, 404);
    db.prepare('DELETE FROM model_access WHERE account_id = ? AND model = ?').run(a.id, c.req.param('model'));
    return c.json({ ok: true });
  });

  // Paid customer payments count for earnings (free credits and corrections do not).
  const earned = (p) => (p.credited && p.amount_eur > 0 && p.tokens > 0 ? earningsFor({ eur: p.amount_eur, tokens: p.tokens }, cfg.earnings) : null);

  admin.get('/payments', (c) => {
    const limit = Math.min(200, Number(c.req.query('limit') ?? 50) || 50);
    const rows = db
      .prepare('SELECT id, account_id, provider, amount_eur, tokens, status, note, credited, fulfilled, created_at FROM payments ORDER BY id DESC LIMIT ?')
      .all(limit);
    return c.json({ payments: rows.map((p) => ({ ...p, earnings: earned(p) })) });
  });

  // Revenue, retail cost, profit and each partner's share: this month and all time.
  admin.get('/earnings', (c) => {
    const d = new Date(clock());
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const paid = db
      .prepare('SELECT provider, amount_eur AS eur, tokens, updated_at AS at FROM payments WHERE credited = 1 AND amount_eur > 0 AND tokens > 0')
      .all();
    const sales = db.prepare('SELECT amount_eur AS eur, cost_usd AS costUsd, cost_eur AS costEur, created_at AS at FROM sales').all();
    // Site refills (crypto, automatic), token sales recorded on an account, and other manual sales.
    const groups = {
      site: paid.filter((r) => r.provider !== 'manual'),
      accounts: paid.filter((r) => r.provider === 'manual'),
      manual: sales,
    };
    const period = (from) => {
      const pick = (rows) => rows.filter((r) => r.at >= from);
      const byGroup = Object.fromEntries(Object.entries(groups).map(([k, rows]) => [k, sumEarnings(pick(rows), cfg.earnings)]));
      return { ...sumEarnings([...pick(groups.site), ...pick(groups.accounts), ...pick(groups.manual)], cfg.earnings), groups: byGroup };
    };
    return c.json({
      costUsdPerMillion: cfg.earnings.costUsdPerMillion,
      usdPerEur: cfg.earnings.usdPerEur,
      specials: catalog.specials ?? [],
      month: period(monthStart),
      allTime: period(0),
    });
  });

  // Manual sales (tickets): price paid and retail cost, counted in the earnings.
  const saleEarnings = (r) => earningsFor({ eur: r.amount_eur, costUsd: r.cost_usd, costEur: r.cost_eur }, cfg.earnings);
  admin.get('/sales', (c) => {
    const rows = db.prepare('SELECT id, product, amount_eur, cost_usd, cost_eur, note, created_at FROM sales ORDER BY id DESC LIMIT 100').all();
    return c.json({ sales: rows.map((r) => ({ ...r, earnings: saleEarnings(r) })) });
  });

  admin.post('/sales', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const product = String(body.product ?? '').trim().slice(0, 80) || 'Sale';
    const eur = Number(body.eur);
    // Cost in euros (panel) or in dollars.
    const inEur = body.costEur != null;
    const cost = Number(inEur ? body.costEur : body.costUsd);
    if (!(eur > 0) || eur > 100000 || !(cost >= 0) || cost > 100000) return c.json({ error: 'invalid_amount' }, 400);
    const round = (n) => Math.round(n * 100) / 100;
    const id = Number(
      db
        .prepare('INSERT INTO sales (product, amount_eur, cost_usd, cost_eur, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(product, round(eur), inEur ? 0 : round(cost), inEur ? round(cost) : null, String(body.note ?? '').slice(0, 120) || null, clock())
        .lastInsertRowid,
    );
    const r = db.prepare('SELECT id, product, amount_eur, cost_usd, cost_eur, note, created_at FROM sales WHERE id = ?').get(id);
    return c.json({ ...r, earnings: saleEarnings(r) }, 201);
  });

  admin.delete('/sales/:id', (c) => {
    const r = db.prepare('DELETE FROM sales WHERE id = ?').run(Number(c.req.param('id')));
    return r.changes ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
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
