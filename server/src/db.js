import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  number_hash TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,      -- tokens
  paid_eur REAL NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  masked TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  key_masked TEXT,
  model TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  rate REAL NOT NULL,
  charged INTEGER NOT NULL DEFAULT 0,      -- tokens taken from the wallet
  stream INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_account_time ON usage(account_id, created_at);

CREATE TABLE IF NOT EXISTS cli_keys (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  key_sealed TEXT NOT NULL,                -- encrypted, see security.sealSecret
  masked TEXT NOT NULL,
  snapshot TEXT,                           -- last usage read from upstream (normalized JSON)
  checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- nowpayments | manual
  reference TEXT UNIQUE,
  amount_eur REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL,
  status TEXT NOT NULL,                    -- pending | finished | partially_paid | failed | expired ...
  note TEXT,
  credited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Added after the first release: whether a paid top-up was also loaded at the provider.
  if (!db.prepare('PRAGMA table_info(payments)').all().some((c) => c.name === 'fulfilled'))
    db.exec('ALTER TABLE payments ADD COLUMN fulfilled INTEGER NOT NULL DEFAULT 0');
  // Admin-only profile: the provider account behind this customer, and who the customer is.
  const accountCols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  for (const [col, type] of [
    ['provider_id_sealed', 'TEXT'], // encrypted, see security.sealSecret
    ['provider_id_hash', 'TEXT'], // for lookups
    ['provider_id_masked', 'TEXT'],
    ['discord', 'TEXT'],
    ['note', 'TEXT'],
    ['number_sealed', 'TEXT'], // the edgey ID, encrypted, so admins can show it again
    ['deleted_at', 'INTEGER'], // deleted from the panel; payments are kept for the earnings
  ])
    if (!accountCols.includes(col)) db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`);
  db.exec('CREATE INDEX IF NOT EXISTS accounts_provider_id ON accounts(provider_id_hash)');
  // API keys are also kept encrypted, so admins can show a key again to the customer.
  if (!db.prepare('PRAGMA table_info(api_keys)').all().some((c) => c.name === 'key_sealed'))
    db.exec('ALTER TABLE api_keys ADD COLUMN key_sealed TEXT');
  return db;
}

/** Runs fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Date.now();

/**
 * Records a payment as paid, once per payment id. Accounts that use a CLI key get their tokens at
 * the provider (loaded by us, then marked as loaded), so only API-key accounts get a gateway balance.
 */
export function creditPayment(db, paymentId) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!p || p.credited) return false;
    const usesCliKey = Boolean(db.prepare('SELECT 1 FROM cli_keys WHERE account_id = ?').get(p.account_id));
    db.prepare('UPDATE payments SET credited = 1, status = ?, updated_at = ? WHERE id = ?').run('finished', now(), p.id);
    db.prepare('UPDATE accounts SET balance = balance + ?, paid_eur = paid_eur + ? WHERE id = ?').run(
      usesCliKey ? 0 : p.tokens,
      p.amount_eur,
      p.account_id,
    );
    return true;
  });
}
