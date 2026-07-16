import { defineConfig } from '@playwright/test';

/**
 * The 5A exit demonstration harness: boots the real built server (which compiles the bundled
 * content pack and serves the built web dist) and drives the guest game in a real chromium.
 *
 * The viewport is pinned at 1440x900 because the cell window is responsive: this size lands the
 * map pane in the `full` layout tier, and the pinned scripted walk's camera positions depend on
 * it. One spec deliberately resizes down to the `compact` tier mid-run to assert the responsive
 * composition (threat drawer + hover popover).
 *
 * The webServer runs against dist — always `npm run build` first (the root `guest:e2e` script
 * does); workspace vitest does NOT rebuild dist.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    // Env names from apps/server/src/config.ts: PORT, HOST, DATABASE_PATH, CONTENT_DIR,
    // WEB_DIST_DIR. CONTENT_DIR and WEB_DIST_DIR keep their repo-root defaults (`content/`,
    // `apps/web/dist/`); the database gets its own file so e2e runs never touch a dev database.
    command: 'node ../server/dist/main.js',
    env: {
      PORT: '4173',
      HOST: '127.0.0.1',
      DATABASE_PATH: '../../data/e2e-guest.sqlite',
    },
    url: 'http://localhost:4173/api/content/guest',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
