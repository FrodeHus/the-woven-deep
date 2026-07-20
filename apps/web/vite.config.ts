import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Playwright specs live in e2e/ and run via `npm run e2e` (root: `guest:e2e`), never vitest.
    exclude: ['e2e/**', '**/node_modules/**'],
    // Heavy jsdom integration tests are timing-sensitive on shared CI runners; retry there only.
    retry: process.env.CI ? 2 : 0,
  },
});
