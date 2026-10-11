import { readFileSync } from 'node:fs';

import { Hono } from 'hono';

const html = readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8');

export function panelRoutes() {
  const panel = new Hono();
  panel.get('/', (c) => c.html(html));
  return panel;
}
