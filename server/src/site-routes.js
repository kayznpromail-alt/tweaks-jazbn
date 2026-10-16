import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

const siteDir = fileURLToPath(new URL('../site/', import.meta.url));

function loadPages() {
  const pages = {};
  for (const file of readdirSync(siteDir)) {
    if (file.endsWith('.html')) {
      pages[file.replace('.html', '')] = readFileSync(join(siteDir, file), 'utf8');
    }
  }
  return pages;
}

export function siteRoutes() {
  const app = new Hono();
  const pages = loadPages();

  // Hashed assets — immutable cache
  app.use(
    '/_astro/*',
    serveStatic({
      root: 'site',
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, immutable, max-age=31536000');
      },
    }),
  );

  // Static files
  for (const path of ['/favicon.svg', '/install.cmd', '/setup.ps1']) {
    app.use(path, serveStatic({ root: 'site' }));
  }
  app.use('/icons/*', serveStatic({ root: 'site' }));

  // HTML pages — clean URLs
  if (pages.index) app.get('/', (c) => c.html(pages.index));
  for (const [name, html] of Object.entries(pages)) {
    if (name === 'index' || name === '404') continue;
    app.get(`/${name}`, (c) => c.html(html));
  }

  return { app, notFoundHtml: pages['404'] ?? null };
}
