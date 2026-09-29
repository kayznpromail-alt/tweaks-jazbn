import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // /api is served as api.html: no trailing-slash redirect between pages.
  build: { format: 'file' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
