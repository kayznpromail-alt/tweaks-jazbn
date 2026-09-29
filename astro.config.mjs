import { defineConfig } from 'astro/config';

export default defineConfig({
  // /api is served as api.html: no trailing-slash redirect between pages.
  build: { format: 'file' },
});
