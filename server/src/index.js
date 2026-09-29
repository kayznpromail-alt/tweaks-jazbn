import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const app = createApp({ cfg, db });

// Expired sessions are cleaned up hourly.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3_600_000).unref();

serve({ fetch: app.fetch, port: cfg.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`edgey API listening on :${info.port}, relaying to ${cfg.upstreamBase}`);
});
