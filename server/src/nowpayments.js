import { createHmac, timingSafeEqual } from 'node:crypto';

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

/** NOWPayments signs IPN callbacks with HMAC-SHA512 over the key-sorted JSON body. */
export function verifyIpn(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const expected = createHmac('sha512', secret).update(JSON.stringify(sortDeep(parsed))).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export const signIpn = (secret, body) =>
  createHmac('sha512', secret).update(JSON.stringify(sortDeep(body))).digest('hex');

/** Hosted invoice: NOWPayments shows the address, amount and QR code, then calls the IPN URL. */
export async function createInvoice(cfg, { orderId, eur, coin, description }) {
  const res = await fetch(`${cfg.nowpayments.base}/invoice`, {
    method: 'POST',
    headers: { 'x-api-key': cfg.nowpayments.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      price_amount: eur,
      price_currency: 'eur',
      pay_currency: coin,
      order_id: orderId,
      order_description: description,
      ipn_callback_url: `${cfg.publicApiUrl}/webhooks/nowpayments`,
      success_url: `${cfg.siteUrl}/overview?topup=success`,
      cancel_url: `${cfg.siteUrl}/overview?topup=cancelled`,
    }),
  });
  if (!res.ok) throw new Error(`NOWPayments invoice failed (${res.status}): ${await res.text()}`);
  return res.json();
}
