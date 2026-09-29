import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Secrets (access numbers, API keys, session tokens) are only ever stored as peppered hashes. */
export const hashSecret = (pepper, value) => createHmac('sha256', pepper).update(value).digest('hex');

/** 16-digit access number, never starting with 0. */
export function newAccessNumber() {
  let out = String(randomInt(1, 10));
  for (let i = 1; i < 16; i++) out += randomInt(0, 10);
  return out;
}

export const normalizeNumber = (input) => String(input ?? '').replace(/\D/g, '');
export const isAccessNumber = (digits) => /^[1-9]\d{15}$/.test(digits);

export function newApiKey() {
  let body = '';
  for (let i = 0; i < 32; i++) body += BASE62[randomInt(0, 62)];
  return `sk_edgey_${body}`;
}
export const isApiKey = (value) => /^sk_edgey_[0-9A-Za-z]{32}$/.test(value ?? '');
export const maskKey = (key) => `${key.slice(0, 13)}…${key.slice(-4)}`;

export const newSessionToken = () => `ses_${randomBytes(32).toString('base64url')}`;

// Customer CLI keys must be sent upstream to read usage, so they are encrypted (AES-256-GCM), not hashed.
const sealingKey = (pepper) => Buffer.from(hkdfSync('sha256', pepper, 'edgey', 'cli-key-encryption', 32));

export function sealSecret(pepper, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(pepper), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function openSecret(pepper, sealed) {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', sealingKey(pepper), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const maskSecret = (key) => (key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : '••••');
