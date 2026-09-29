import { createHmac, randomBytes, randomInt } from 'node:crypto';

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
