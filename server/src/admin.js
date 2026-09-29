// Account admin from the VPS shell, e.g. to credit a PayPal or card sale made on Discord.
//   npm run admin -- new-account
//   npm run admin -- pack <number> <euros>            credit a catalog pack (25, 65, 140, 180)
//   npm run admin -- credit <number> <tokens> [euros] credit any amount (200M, 1.5B, 1000000…)
//   npm run admin -- info <number>
//   npm run admin -- disable <number> | enable <number>
//   npm run admin -- stats                             total tokens owed to customers
import { catalog } from './billing.js';
import { creditPayment, now, openDb } from './db.js';
import { hashSecret, isAccessNumber, newAccessNumber, normalizeNumber } from './security.js';

const pepper = process.env.SECRET_PEPPER;
if (!pepper) {
  console.error('SECRET_PEPPER is not set (run this where the server .env is loaded).');
  process.exit(1);
}
const db = openDb(process.env.DATABASE_PATH ?? './data/edgey.db');
const [cmd, ...args] = process.argv.slice(2);
const fmt = (n) => Number(n).toLocaleString('en-US');

function parseTokens(input) {
  const m = /^([\d.]+)\s*([kmb]?)$/i.exec(String(input ?? '').trim());
  if (!m) return NaN;
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * mult);
}

function accountFor(input) {
  const digits = normalizeNumber(input);
  if (!isAccessNumber(digits)) throw new Error('Not a 16-digit access number.');
  const a = db.prepare('SELECT * FROM accounts WHERE number_hash = ?').get(hashSecret(pepper, digits));
  if (!a) throw new Error('No account with this number.');
  return a;
}

function credit(account, tokens, eur, note) {
  const t = now();
  const id = Number(
    db
      .prepare(
        `INSERT INTO payments (account_id, provider, amount_eur, tokens, status, note, created_at, updated_at)
         VALUES (?, 'manual', ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(account.id, eur, tokens, note, t, t).lastInsertRowid,
  );
  creditPayment(db, id);
  const after = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id).balance;
  console.log(`Credited ${fmt(tokens)} tokens (€${eur}). New balance: ${fmt(after)} tokens.`);
}

try {
  switch (cmd) {
    case 'new-account': {
      const number = newAccessNumber();
      db.prepare('INSERT INTO accounts (number_hash, created_at) VALUES (?, ?)').run(hashSecret(pepper, number), now());
      console.log(`New account: ${number.replace(/(\d{4})(?=\d)/g, '$1 ')}  (give it to the customer, it cannot be shown again)`);
      break;
    }
    case 'pack': {
      const a = accountFor(args[0]);
      const pack = catalog.packs.find((p) => p.eur === Number(args[1]));
      if (!pack) throw new Error(`No pack at €${args[1]}. Packs: ${catalog.packs.map((p) => p.eur).join(', ')}`);
      credit(a, pack.tokens, pack.eur, args.slice(2).join(' ') || 'manual pack');
      break;
    }
    case 'credit': {
      const a = accountFor(args[0]);
      const tokens = parseTokens(args[1]);
      if (!Number.isFinite(tokens) || tokens <= 0) throw new Error('Tokens must be a positive amount, e.g. 200M.');
      credit(a, tokens, Number(args[2] ?? 0), args.slice(3).join(' ') || 'manual credit');
      break;
    }
    case 'info': {
      const a = accountFor(args[0]);
      const keys = db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?').get(a.id).n;
      console.log(
        `Account #${a.id}  balance ${fmt(a.balance)} tokens  paid €${a.paid_eur}  keys ${keys}  ${a.disabled ? 'DISABLED' : 'active'}`,
      );
      break;
    }
    case 'disable':
    case 'enable': {
      const a = accountFor(args[0]);
      db.prepare('UPDATE accounts SET disabled = ? WHERE id = ?').run(cmd === 'disable' ? 1 : 0, a.id);
      console.log(`Account #${a.id} ${cmd}d.`);
      break;
    }
    case 'stats': {
      const s = db
        .prepare('SELECT COUNT(*) AS accounts, IFNULL(SUM(balance), 0) AS owed, IFNULL(SUM(paid_eur), 0) AS paid FROM accounts')
        .get();
      console.log(`${s.accounts} accounts, €${s.paid} paid in total.`);
      console.log(`Tokens owed to customers: ${fmt(s.owed)}. Keep at least this much in your upstream wallet.`);
      break;
    }
    default:
      console.log('Commands: new-account | pack <number> <eur> | credit <number> <tokens> [eur] [note] | info <number> | disable <number> | enable <number> | stats');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
