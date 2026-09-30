import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { createUsageTracker } from '../src/billing.js';
import { creditPayment, openDb } from '../src/db.js';
import { earningsFor, parseSplit } from '../src/earnings.js';
import { signIpn } from '../src/nowpayments.js';
import { isAccessNumber, isApiKey, newAccessNumber, newApiKey } from '../src/security.js';

const UPSTREAM_KEY = 'upstream-secret';
const seen = [];
let upstream;
let base;

// Fake upstream provider speaking both API dialects.
function fakeUpstream(req, res) {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push({ url: req.url, headers: req.headers, body });
    if (req.url === '/v1/account') {
      if (req.headers.authorization !== 'Bearer cli-good-key-123456') return res.writeHead(401).end('{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        version: 1, unit: 'weighted_provider_units', updatedAt: new Date().toISOString(), status: 'active',
        plan: 'Custom', expiresAt: '2026-12-31T00:00:00Z', limit: 200000000, used: 50000000, reserved: 0,
        available: 150000000, estimatedRequests: 900, secretProviderField: 'acmeprov internal',
      }));
    }
    if (body.model === 'glm-5.2') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'acmeprov key revoked, see acmeprov.com/billing' } }));
    }
    if (body.model === 'glm-5.3') {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `Prompt too long for Acmeprov (limit on ${req.headers.host})` } }));
    }
    const sse = (events) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Split mid-line on purpose to exercise the tracker's buffering.
      const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
      const cut = Math.floor(text.length / 2);
      res.write(text.slice(0, cut));
      setTimeout(() => res.end(text.slice(cut)), 5);
    };

    if (req.url === '/v1/chat/completions') {
      if (req.headers.authorization !== `Bearer ${UPSTREAM_KEY}`) return res.writeHead(401).end('{}');
      if (body.stream) {
        const events = [{ choices: [{ delta: { content: 'Hi' } }] }];
        if (body.stream_options?.include_usage)
          events.push({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } });
        events.push('[DONE]');
        return sse(events);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    }
    if (req.url === '/v1/messages') {
      if (req.headers['x-api-key'] !== UPSTREAM_KEY) return res.writeHead(401).end('{}');
      if (body.stream)
        return sse([
          { type: 'message_start', message: { usage: { input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 1 } } },
          { type: 'content_block_delta', delta: { text: 'Hello' } },
          { type: 'message_delta', usage: { output_tokens: 80 } },
          { type: 'message_stop' },
        ]);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ content: [], usage: { input_tokens: 30, output_tokens: 20 } }));
    }
    if (req.url === '/v1/messages/count_tokens') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ input_tokens: 12 }));
    }
    res.writeHead(404).end('{}');
  });
}

before(async () => {
  upstream = createServer(fakeUpstream);
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${upstream.address().port}`;
});
after(() => upstream.close());

function setup(overrides = {}) {
  const db = openDb(':memory:');
  const cfg = {
    upstreamBase: base,
    upstreamKey: UPSTREAM_KEY,
    pepper: 'test-pepper',
    upstreamNames: ['acmeprov'],
    openRegistration: true,
    allowedOrigins: ['https://cli.edgey.shop'],
    publicApiUrl: 'https://api.edgey.shop',
    siteUrl: 'https://cli.edgey.shop',
    sessionDays: 30,
    nowpayments: { apiKey: null, ipnSecret: 'ipn-secret', base: 'http://127.0.0.1:1' },
    earnings: { costUsdPerMillion: 0.05, usdPerEur: 1.15, split: [{ name: 'edgey', percent: 60 }, { name: 'kayzn', percent: 40 }] },
    ...overrides,
  };
  const app = createApp({ cfg, db });
  const call = (path, { method = 'GET', token, key, body, headers = {} } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { db, app, call };
}

async function account(ctx, balance = 0) {
  const reg = await ctx.call('/auth/register', { method: 'POST' });
  const { number, token } = await reg.json();
  if (balance) ctx.db.prepare('UPDATE accounts SET balance = ?').run(balance);
  const created = await (await ctx.call('/keys', { method: 'POST', token, body: { name: 'laptop' } })).json();
  return { number, token, key: created.key, keyId: created.id };
}
const balanceOf = (db) => db.prepare('SELECT balance FROM accounts').get().balance;

describe('secrets', () => {
  test('access numbers and API keys have the right shape', () => {
    for (let i = 0; i < 200; i++) {
      assert.ok(isAccessNumber(newAccessNumber()));
      assert.ok(isApiKey(newApiKey()));
    }
  });
});

describe('usage tracker', () => {
  test('reads OpenAI usage from a split stream', () => {
    const t = createUsageTracker('openai');
    const text = 'data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\ndata: [DONE]\n\n';
    for (const ch of text) t.feed(ch);
    assert.deepEqual(t.result(), { input: 7, output: 3, total: 10 });
  });
  test('reads Anthropic usage including cache tokens', () => {
    const t = createUsageTracker('anthropic');
    t.feed('data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"output_tokens":1}}}\n');
    t.feed('data: {"type":"message_delta","usage":{"output_tokens":42}}\n');
    assert.deepEqual(t.result(), { input: 15, output: 42, total: 57 });
  });
});

describe('accounts and keys', () => {
  test('register, log in with the number, log out', async () => {
    const ctx = setup();
    const reg = await ctx.call('/auth/register', { method: 'POST' });
    assert.equal(reg.status, 201);
    const { number } = await reg.json();
    const spaced = number.replace(/(\d{4})(?=\d)/g, '$1 ');
    const login = await ctx.call('/auth/login', { method: 'POST', body: { number: spaced } });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const me = await (await ctx.call('/me', { token })).json();
    assert.equal(me.balance, 0);
    assert.equal(me.maxKeys, 6);
    assert.equal((await ctx.call('/auth/logout', { method: 'POST', token })).status, 200);
    assert.equal((await ctx.call('/me', { token })).status, 401);
    assert.equal((await ctx.call('/auth/login', { method: 'POST', body: { number: '1234123412341234' } })).status, 401);
  });

  test('the access number is never stored in clear', async () => {
    const ctx = setup();
    const { number } = await (await ctx.call('/auth/register', { method: 'POST' })).json();
    const dump = JSON.stringify(ctx.db.prepare('SELECT * FROM accounts').all());
    assert.ok(!dump.includes(number));
  });

  test('keys: shown once, masked after, limited to 6, can be disabled', async () => {
    const ctx = setup();
    const a = await account(ctx);
    assert.ok(isApiKey(a.key));
    const list = (await (await ctx.call('/keys', { token: a.token })).json()).keys;
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes(a.key));
    for (let i = 0; i < 5; i++) assert.equal((await ctx.call('/keys', { method: 'POST', token: a.token, body: {} })).status, 201);
    assert.equal((await ctx.call('/keys', { method: 'POST', token: a.token, body: {} })).status, 409);

    await ctx.call(`/keys/${a.keyId}`, { method: 'PATCH', token: a.token, body: { enabled: false } });
    const res = await ctx.call('/v1/models', { key: a.key });
    assert.equal(res.status, 401);
  });

  test('CORS only for the site origin', async () => {
    const ctx = setup();
    const ok = await ctx.call('/me', { method: 'OPTIONS', headers: { origin: 'https://cli.edgey.shop', 'access-control-request-method': 'GET' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://cli.edgey.shop');
    const bad = await ctx.call('/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});

describe('relay and billing', () => {
  test('OpenAI chat, non-streamed: tokens x multiplier are charged', async () => {
    const ctx = setup();
    const a = await account(ctx, 10_000);
    const res = await ctx.call('/v1/chat/completions', { method: 'POST', key: a.key, body: { model: 'claude-opus-5', messages: [] } });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(balanceOf(ctx.db), 10_000 - 150 * 5);
    const last = seen.at(-1);
    assert.equal(last.headers.authorization, `Bearer ${UPSTREAM_KEY}`);
    assert.ok(!JSON.stringify(last.headers).includes(a.key), 'customer key must not reach upstream');
  });

  test('OpenAI chat, streamed: usage is requested and charged', async () => {
    const ctx = setup();
    const a = await account(ctx, 10_000);
    const res = await ctx.call('/v1/chat/completions', {
      method: 'POST',
      key: a.key,
      body: { model: 'gpt-5.6-luna', stream: true, messages: [] },
    });
    const text = await res.text();
    assert.ok(text.includes('[DONE]'));
    assert.equal(seen.at(-1).body.stream_options.include_usage, true);
    assert.equal(balanceOf(ctx.db), 10_000 - Math.ceil(50 * 0.5));
  });

  test('Anthropic messages, streamed with x-api-key: cache tokens count', async () => {
    const ctx = setup();
    const a = await account(ctx, 10_000);
    const res = await ctx.call('/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': a.key, 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet-5', stream: true, max_tokens: 10, messages: [] },
    });
    await res.text();
    assert.equal(seen.at(-1).headers['x-api-key'], UPSTREAM_KEY);
    assert.equal(balanceOf(ctx.db), 10_000 - (200 + 50 + 80) * 2);
    const log = await (await ctx.call('/requests', { token: a.token })).json();
    assert.equal(log.requests[0].charged, 660);
    assert.equal(log.requests[0].model, 'claude-sonnet-5');
  });

  test('count_tokens is relayed but not billed', async () => {
    const ctx = setup();
    const a = await account(ctx, 100);
    const res = await ctx.call('/v1/messages/count_tokens', { method: 'POST', headers: { 'x-api-key': a.key }, body: { model: 'claude-opus-5', messages: [] } });
    assert.deepEqual(await res.json(), { input_tokens: 12 });
    assert.equal(balanceOf(ctx.db), 100);
  });

  test('empty wallet, unknown model and bad key are refused before reaching upstream', async () => {
    const ctx = setup();
    const a = await account(ctx, 0);
    const before = seen.length;
    const empty = await ctx.call('/v1/chat/completions', { method: 'POST', key: a.key, body: { model: 'gpt-5.5', messages: [] } });
    assert.equal(empty.status, 402);
    ctx.db.prepare('UPDATE accounts SET balance = 1000').run();
    const unknown = await ctx.call('/v1/messages', { method: 'POST', headers: { 'x-api-key': a.key }, body: { model: 'nope', messages: [] } });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).type, 'error');
    const bad = await ctx.call('/v1/chat/completions', { method: 'POST', key: 'sk_edgey_' + 'x'.repeat(32), body: { model: 'gpt-5.5' } });
    assert.equal(bad.status, 401);
    assert.equal(seen.length, before);
  });

  test('usage stats reflect requests', async () => {
    const ctx = setup();
    const a = await account(ctx, 10_000);
    await (await ctx.call('/v1/chat/completions', { method: 'POST', key: a.key, body: { model: 'gpt-5.5', messages: [] } })).text();
    const u = await (await ctx.call('/usage?range=24h', { token: a.token })).json();
    assert.equal(u.requests, 1);
    assert.equal(u.tokens, 150);
    assert.equal(u.buckets.length, 24);
    const me = await (await ctx.call('/me', { token: a.token })).json();
    assert.equal(me.requests24h, 1);
    assert.equal(me.successful24h, 1);
  });
});

describe('payments', () => {
  test('crypto top-up is refused until NOWPayments is configured', async () => {
    const ctx = setup();
    const a = await account(ctx);
    const res = await ctx.call('/topup', { method: 'POST', token: a.token, body: { pack: 0, coin: 'ltc' } });
    assert.equal(res.status, 503);
  });

  test('signed IPN credits once, bad signature and partial payments do not', async () => {
    const ctx = setup();
    const a = await account(ctx);
    const t = Date.now();
    const id = Number(
      ctx.db
        .prepare(
          `INSERT INTO payments (account_id, provider, reference, amount_eur, tokens, status, created_at, updated_at)
           VALUES (1, 'nowpayments', 'edgey_1', 25, 200000000, 'pending', ?, ?)`,
        )
        .run(t, t).lastInsertRowid,
    );
    const send = (event, sig = signIpn('ipn-secret', event)) =>
      ctx.app.request('/webhooks/nowpayments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nowpayments-sig': sig },
        body: JSON.stringify(event),
      });

    const partial = { order_id: 'edgey_1', payment_status: 'partially_paid', price_amount: 25, price_currency: 'eur' };
    assert.equal((await send(partial)).status, 200);
    assert.equal(balanceOf(ctx.db), 0);

    const done = { order_id: 'edgey_1', payment_status: 'finished', price_amount: 25, price_currency: 'eur' };
    assert.equal((await send(done, 'deadbeef')).status, 401);
    assert.equal(balanceOf(ctx.db), 0);

    await send(done);
    await send(done); // duplicate callback
    assert.equal(balanceOf(ctx.db), 200_000_000);
    assert.equal(creditPayment(ctx.db, id), false);
    const pays = await (await ctx.call('/payments', { token: a.token })).json();
    assert.equal(pays.payments[0].status, 'finished');
  });
});

describe('admin panel API', () => {
  const ADMIN = 'admin-secret-token';
  const asAdmin = (ctx, path, opts = {}) => ctx.call(path, { ...opts, token: ADMIN });

  test('closed without ADMIN_TOKEN, and with a wrong token', async () => {
    const off = setup();
    assert.equal((await off.call('/admin/stats', { token: 'x' })).status, 404);
    const ctx = setup({ adminToken: ADMIN });
    assert.equal((await ctx.call('/admin/stats')).status, 401);
    assert.equal((await ctx.call('/admin/stats', { token: 'nope' })).status, 401);
    assert.equal((await asAdmin(ctx, '/admin/stats')).status, 200);
  });

  test('create account, look it up by number, credit a pack, disable it', async () => {
    const ctx = setup({ adminToken: ADMIN });
    const created = await (await asAdmin(ctx, '/admin/accounts', { method: 'POST' })).json();
    assert.ok(isAccessNumber(created.number));

    const found = await (await asAdmin(ctx, '/admin/lookup', { method: 'POST', body: { number: created.number } })).json();
    assert.equal(found.id, created.account.id);

    const credited = await (
      await asAdmin(ctx, `/admin/accounts/${found.id}/credit`, { method: 'POST', body: { packEur: 64.99, note: 'paypal' } })
    ).json();
    assert.equal(credited.balance, 500_000_000);
    assert.equal(credited.paidEur, 64.99);
    assert.equal((await asAdmin(ctx, `/admin/accounts/${found.id}/credit`, { method: 'POST', body: { tokens: -600_000_000 } })).status, 400);

    const stats = await (await asAdmin(ctx, '/admin/stats')).json();
    assert.equal(stats.tokensOwed, 500_000_000);
    assert.equal(stats.revenueEur, 64.99);

    const login = await (await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).json();
    await asAdmin(ctx, `/admin/accounts/${found.id}/status`, { method: 'POST', body: { disabled: true } });
    assert.equal((await ctx.call('/me', { token: login.token })).status, 401, 'sessions are revoked');
    assert.equal((await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).status, 401);

    const detail = await (await asAdmin(ctx, `/admin/accounts/${found.id}`)).json();
    assert.equal(detail.disabled, true);
    assert.equal(detail.payments[0].note, 'paypal');
  });
});

describe('provider stays hidden', () => {
  test('account errors become neutral, request errors are scrubbed', async () => {
    const ctx = setup();
    const a = await account(ctx, 10_000);
    const auth = await ctx.call('/v1/chat/completions', { method: 'POST', key: a.key, body: { model: 'glm-5.2', messages: [] } });
    const authText = await auth.text();
    assert.equal(auth.status, 502);
    assert.ok(!/acmeprov/i.test(authText), authText);

    const bad = await ctx.call('/v1/messages', { method: 'POST', headers: { 'x-api-key': a.key }, body: { model: 'glm-5.3', messages: [] } });
    const badBody = await bad.json();
    assert.equal(bad.status, 400);
    assert.equal(badBody.type, 'error');
    assert.ok(badBody.error.message.includes('Prompt too long'));
    assert.ok(!/acmeprov|127\.0\.0\.1/i.test(JSON.stringify(badBody)), JSON.stringify(badBody));
    assert.equal(balanceOf(ctx.db), 10_000, 'errors are not billed');
  });
});

describe('CLI keys (usage read from the provider)', () => {
  const ADMIN = 'admin-secret-token';
  const asAdmin = (ctx, path, opts = {}) => ctx.call(path, { ...opts, token: ADMIN });

  test('sign-up is closed unless OPEN_REGISTRATION is on', async () => {
    const ctx = setup({ openRegistration: false });
    assert.equal((await ctx.call('/auth/register', { method: 'POST' })).status, 403);
  });

  test('admin creates an account with a CLI key; the customer sees usage, never the key', async () => {
    const ctx = setup({ adminToken: ADMIN });
    const bad = await asAdmin(ctx, '/admin/accounts', { method: 'POST', body: { cliKey: 'wrong-key-000000' } });
    assert.equal(bad.status, 400);
    assert.equal((await (await asAdmin(ctx, '/admin/stats')).json()).accounts, 0, 'no half-created account');

    const created = await (await asAdmin(ctx, '/admin/accounts', { method: 'POST', body: { cliKey: 'cli-good-key-123456' } })).json();
    assert.equal(created.account.cli.masked, 'cli-go…3456');
    assert.ok(!JSON.stringify(ctx.db.prepare('SELECT * FROM cli_keys').all()).includes('cli-good-key-123456'), 'stored encrypted');

    const { token } = await (await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).json();
    const me = await (await ctx.call('/me', { token })).json();
    assert.equal(me.cli.account.status, 'active');
    assert.equal(me.cli.account.available, 150_000_000);
    assert.equal(me.cli.account.plan, 'Custom');
    const text = JSON.stringify(me);
    assert.ok(!text.includes('cli-good-key-123456') && !/acmeprov/i.test(text), text);

    await asAdmin(ctx, `/admin/accounts/${created.account.id}/cli`, { method: 'POST', body: { key: null } });
    assert.equal((await (await ctx.call('/me', { token })).json()).cli, null);
  });

  test('paid top-ups can be marked as loaded at the provider', async () => {
    const ctx = setup({ adminToken: ADMIN });
    const a = await account(ctx);
    const t = Date.now();
    const id = Number(ctx.db.prepare(
      `INSERT INTO payments (account_id, provider, reference, amount_eur, tokens, status, credited, created_at, updated_at)
       VALUES (1, 'nowpayments', 'edgey_9', 25, 200000000, 'finished', 1, ?, ?)`).run(t, t).lastInsertRowid);
    assert.equal((await (await asAdmin(ctx, '/admin/stats')).json()).paymentsToFulfil, 1);
    await asAdmin(ctx, `/admin/payments/${id}/fulfilled`, { method: 'POST', body: { fulfilled: true } });
    assert.equal((await (await asAdmin(ctx, '/admin/stats')).json()).paymentsToFulfil, 0);
    assert.ok(a.token);
  });
});

describe('admin profile: provider user id and Discord', () => {
  const ADMIN = 'admin-secret-token';
  const asAdmin = (ctx, path, opts = {}) => ctx.call(path, { ...opts, token: ADMIN });

  test('stored encrypted, searchable, never shown to the customer', async () => {
    const ctx = setup({ adminToken: ADMIN });
    const created = await (
      await asAdmin(ctx, '/admin/accounts', {
        method: 'POST',
        body: { providerUserId: '4108 2903 0745 8542', discord: 'rakiuss', note: 'pack 65' },
      })
    ).json();
    assert.equal(created.account.discord, 'rakiuss');
    assert.equal(created.account.providerId, '4108 2…8542');
    assert.ok(!JSON.stringify(ctx.db.prepare('SELECT * FROM accounts').all()).includes('4108 2903 0745 8542'), 'encrypted at rest');

    const detail = await (await asAdmin(ctx, `/admin/accounts/${created.account.id}`)).json();
    assert.equal(detail.providerIdFull, '4108 2903 0745 8542');

    for (const q of ['rakiuss', '4108 2903 0745 8542', created.number, `#${created.account.id}`, 'pack 65']) {
      const r = await (await asAdmin(ctx, '/admin/search?q=' + encodeURIComponent(q))).json();
      assert.equal(r.accounts.length, 1, q);
      assert.equal(r.accounts[0].id, created.account.id);
    }

    const dup = await asAdmin(ctx, '/admin/accounts', { method: 'POST', body: { providerUserId: '4108 2903 0745 8542' } });
    assert.equal(dup.status, 409);

    await asAdmin(ctx, `/admin/accounts/${created.account.id}/profile`, { method: 'POST', body: { discord: '123456789012345678' } });
    const edited = await (await asAdmin(ctx, '/admin/search?q=1234567890123')).json();
    assert.equal(edited.accounts[0].discord, '123456789012345678');

    const { token } = await (await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).json();
    const me = JSON.stringify(await (await ctx.call('/me', { token })).json());
    assert.ok(!me.includes('4108') && !me.includes('discord') && !me.includes('rakiuss'), me);
  });

  test('a lost edgey ID can be replaced', async () => {
    const ctx = setup({ adminToken: ADMIN });
    const created = await (await asAdmin(ctx, '/admin/accounts', { method: 'POST', body: {} })).json();
    const { token } = await (await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).json();
    const renewed = await (await asAdmin(ctx, `/admin/accounts/${created.account.id}/number`, { method: 'POST' })).json();
    assert.notEqual(renewed.number, created.number);
    assert.equal(renewed.account.id, created.account.id);
    assert.equal((await ctx.call('/auth/login', { method: 'POST', body: { number: created.number } })).status, 401);
    assert.equal((await ctx.call('/auth/login', { method: 'POST', body: { number: renewed.number } })).status, 200);
    assert.equal((await ctx.call('/me', { token })).status, 401, 'old session signed out');
  });
});

describe('earnings', () => {
  const e = { costUsdPerMillion: 0.05, usdPerEur: 1.15, split: parseSplit('edgey:60,kayzn:40') };

  test('price paid - retail cost, split 60/40 rounded up to the cent', () => {
    // 200M tokens = 10 $ = 8.6956… € -> 8.70 €; profit 24.99 - 8.70 = 16.29
    const one = earningsFor({ eur: 24.99, tokens: 200_000_000 }, e);
    assert.equal(one.costEur, 8.7);
    assert.equal(one.profitEur, 16.29);
    assert.deepEqual(one.split.map((s) => [s.name, s.eur]), [['edgey', 9.78], ['kayzn', 6.52]]);
  });

  test('admin earnings count paid payments only', async () => {
    const ADMIN = 'admin-secret-token';
    const ctx = setup({ adminToken: ADMIN });
    const created = await (await ctx.call('/admin/accounts', { method: 'POST', token: ADMIN, body: {} })).json();
    const credit = (body) => ctx.call(`/admin/accounts/${created.account.id}/credit`, { method: 'POST', token: ADMIN, body });
    await credit({ packEur: 24.99, note: 'paypal' });
    await credit({ tokens: 50_000_000, eur: 0, note: 'gift' });
    const out = await (await ctx.call('/admin/earnings', { token: ADMIN })).json();
    assert.equal(out.allTime.payments, 1);
    assert.equal(out.allTime.revenueEur, 24.99);
    assert.equal(out.allTime.profitEur, 16.29);
    assert.equal(out.month.split[1].eur, 6.52);
    const { payments } = await (await ctx.call('/admin/payments', { token: ADMIN })).json();
    assert.equal(payments.find((p) => p.note === 'gift').earnings, null);
    assert.equal(payments.find((p) => p.note === 'paypal').earnings.split[0].eur, 9.78);
  });

  test('CLI-key accounts: a paid sale is recorded, no gateway balance is added', async () => {
    const ADMIN = 'admin-secret-token';
    const ctx = setup({ adminToken: ADMIN });
    const created = await (await ctx.call('/admin/accounts', { method: 'POST', token: ADMIN, body: { cliKey: 'cli-good-key-123456' } })).json();
    const out = await (
      await ctx.call(`/admin/accounts/${created.account.id}/credit`, { method: 'POST', token: ADMIN, body: { packEur: 24.99 } })
    ).json();
    assert.equal(out.balance, 0);
    assert.equal(out.paidEur, 24.99);
    const earned = await (await ctx.call('/admin/earnings', { token: ADMIN })).json();
    assert.equal(earned.allTime.payments, 1);
  });

  test('edgey ID shown again to admins; deleted accounts are gone but their payments stay', async () => {
    const ADMIN = 'admin-secret-token';
    const ctx = setup({ adminToken: ADMIN });
    const asAdmin = (path, opts = {}) => ctx.call(path, { ...opts, token: ADMIN });
    const created = await (await asAdmin('/admin/accounts', { method: 'POST', body: { providerUserId: 'prov-1', cliKey: 'cli-good-key-123456' } })).json();
    const id = created.account.id;
    assert.equal((await (await asAdmin(`/admin/accounts/${id}`)).json()).numberFull, created.number);
    assert.ok(!JSON.stringify(ctx.db.prepare('SELECT * FROM accounts').all()).includes(created.number), 'encrypted at rest');
    const renewed = await (await asAdmin(`/admin/accounts/${id}/number`, { method: 'POST' })).json();
    assert.equal((await (await asAdmin(`/admin/accounts/${id}`)).json()).numberFull, renewed.number);

    await asAdmin(`/admin/accounts/${id}/credit`, { method: 'POST', body: { packEur: 24.99 } });
    assert.equal((await asAdmin(`/admin/accounts/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await asAdmin(`/admin/accounts/${id}`)).status, 404);
    assert.equal((await ctx.call('/auth/login', { method: 'POST', body: { number: renewed.number } })).status, 401);
    assert.equal((await (await asAdmin('/admin/accounts')).json()).accounts.length, 0);
    assert.equal((await (await asAdmin('/admin/search?q=prov-1')).json()).accounts.length, 0);
    assert.equal((await (await asAdmin('/admin/stats')).json()).accounts, 0);
    assert.equal((await (await asAdmin('/admin/earnings')).json()).allTime.payments, 1, 'payments kept');
    const again = await asAdmin('/admin/accounts', { method: 'POST', body: { providerUserId: 'prov-1' } });
    assert.equal(again.status, 201, 'provider user id can be reused');
  });
});
