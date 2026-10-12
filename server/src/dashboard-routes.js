import { readFileSync } from 'node:fs';

import { Hono } from 'hono';

const html = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');

export function dashboardRoutes() {
  const dashboard = new Hono();
  dashboard.get('/', (c) => c.html(html));
  return dashboard;
}
