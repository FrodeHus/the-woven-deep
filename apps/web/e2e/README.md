Playwright end-to-end specs for the guest game — run `npm run guest:e2e` from the repo root (builds everything, boots the real server on port 4173, drives chromium).
One-time setup: `npx playwright install chromium`.
In CI, use `npx playwright install --with-deps chromium` instead.

Specs (all seeded on `[11,22,33,44]`, keyboard-driven):

- `guest-play.spec.ts` (5A) — kill, pick up, eat, rest, descend; reload-restore, keyboard reachability, responsive tier.
- `run-lifecycle.spec.ts` (5B) — the seven-step chargen wizard, play, death, conclusion, session Hall.
- `town-loop.spec.ts` (5C) — buy, store, descend, kill, return, sell, upgrade, retrieve, descend.
- `interface.spec.ts` (5D-1) — every registry overlay by key, key rebinding, font scale, codex discovery before/after a kill, identify via the inline picker, and clear-guest-session back to the title.
