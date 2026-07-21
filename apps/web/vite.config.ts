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
    // One fork keeps a single reporter channel that always services Vitest's worker-RPC
    // heartbeat, so a busy 2-core runner stops surfacing "Timeout calling onTaskUpdate"
    // (a worker-crash flake that per-test `retry` cannot catch). The `test` script adds a
    // CI-only whole-suite retry as the backstop for any residual heartbeat starvation.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
