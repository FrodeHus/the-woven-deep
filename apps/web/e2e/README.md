Playwright end-to-end specs for the guest game — run `npm run guest:e2e` from the repo root (builds everything, boots the real server on port 4173, drives chromium).
One-time setup: `npx playwright install chromium`.
In CI, use `npx playwright install --with-deps chromium` instead.
