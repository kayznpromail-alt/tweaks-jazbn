// Usage of a customer's CLI key, read from the upstream provider's /v1/account and cached.
import { maskSecret, openSecret, sealSecret } from './security.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const quota = (q) =>
  q && typeof q === 'object'
    ? { limit: num(q.limit), used: num(q.used) ?? 0, reserved: num(q.reserved) ?? 0, available: num(q.available) }
    : null;

/** Only known fields are kept, so nothing provider-specific reaches customers. */
export function normalizeAccount(v) {
  const plan = typeof v?.plan === 'string' ? v.plan : typeof v?.plan?.name === 'string' ? v.plan.name : null;
  return {
    status: ['active', 'paused', 'expired', 'exhausted'].includes(v?.status) ? v.status : 'unknown',
    plan: plan ? plan.slice(0, 40) : null,
    expiresAt: typeof v?.expiresAt === 'string' ? v.expiresAt : null,
    limit: num(v?.limit),
    used: num(v?.used) ?? 0,
    reserved: num(v?.reserved) ?? 0,
    available: num(v?.available),
    estimatedRequests: num(v?.estimatedRequests),
    wallet: quota(v?.quota?.wallet),
    key: quota(v?.quota?.key),
  };
}

export async function fetchUpstreamAccount(cfg, key) {
  let res;
  try {
    res = await fetch(`${cfg.upstreamBase}/v1/account`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid_key' };
  if (!res.ok) return { ok: false, reason: 'unavailable' };
  const body = await res.json().catch(() => null);
  return body ? { ok: true, account: normalizeAccount(body) } : { ok: false, reason: 'unavailable' };
}

const FRESH_MS = 60_000;

export function cliAccounts({ cfg, db, clock }) {
  const q = {
    get: db.prepare('SELECT * FROM cli_keys WHERE account_id = ?'),
    upsert: db.prepare(
      `INSERT INTO cli_keys (account_id, key_sealed, masked, snapshot, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET key_sealed = excluded.key_sealed, masked = excluded.masked,
         snapshot = excluded.snapshot, checked_at = excluded.checked_at`,
    ),
    snapshot: db.prepare('UPDATE cli_keys SET snapshot = ?, checked_at = ? WHERE account_id = ?'),
    remove: db.prepare('DELETE FROM cli_keys WHERE account_id = ?'),
  };

  const view = (row, account, extra = {}) => ({
    masked: row.masked,
    account,
    checkedAt: row.checked_at,
    ...extra,
  });

  return {
    /** Cached summary for lists: never calls upstream. */
    cached(accountId) {
      const row = q.get.get(accountId);
      if (!row) return null;
      return view(row, row.snapshot ? JSON.parse(row.snapshot) : null);
    },

    /** Current usage, refreshed from upstream at most once a minute. */
    async status(accountId, { fresh = false } = {}) {
      const row = q.get.get(accountId);
      if (!row) return null;
      const cached = row.snapshot ? JSON.parse(row.snapshot) : null;
      if (!fresh && cached && clock() - row.checked_at < FRESH_MS) return view(row, cached);
      const out = await fetchUpstreamAccount(cfg, openSecret(cfg.pepper, row.key_sealed));
      if (!out.ok) return view(row, cached, { error: out.reason });
      const t = clock();
      q.snapshot.run(JSON.stringify(out.account), t, accountId);
      return view({ ...row, checked_at: t }, out.account);
    },

    /** Links a key after checking it upstream; returns null when the key is refused. */
    async link(accountId, key) {
      const clean = String(key ?? '').trim();
      if (clean.length < 8 || clean.length > 300 || /\s/.test(clean)) return { error: 'invalid_cli_key' };
      const out = await fetchUpstreamAccount(cfg, clean);
      if (!out.ok) return { error: out.reason === 'invalid_key' ? 'invalid_cli_key' : 'provider_unavailable' };
      const t = clock();
      q.upsert.run(accountId, sealSecret(cfg.pepper, clean), maskSecret(clean), JSON.stringify(out.account), t, t);
      return { cli: view({ masked: maskSecret(clean), checked_at: t }, out.account) };
    },

    unlink(accountId) {
      q.remove.run(accountId);
    },
  };
}
