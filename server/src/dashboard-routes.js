import { readFileSync } from 'node:fs';

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

const html = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');

export function dashboardRoutes() {
  const dashboard = new Hono();
  dashboard.use(
    '/assets/*',
    serveStatic({
      root: './dashboard',
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, immutable, max-age=31536000');
      },
    }),
  );
  dashboard.get('/', (c) => c.html(html));
  return dashboard;
}
