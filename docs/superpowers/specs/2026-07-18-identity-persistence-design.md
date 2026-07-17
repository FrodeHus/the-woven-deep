# Identity and Persistence Foundation (Milestone 6A) Design

Approved design for the first sub-milestone of milestone 6 (the first server-authoritative milestone). Milestone 6 was sliced during brainstorming into **6A** (this spec — identity, the persistence foundation, and roaming settings), **6B** (server-authoritative runs over WebSocket), and **6C** (the verified Hall, server unlock evaluation, lifetime stats, export, profile deletion). 6A delivers a real vertical slice: a player can sign in with an email magic link and have their settings roam across devices, while play itself stays guest-local until 6B.

## Decisions

- **Keep `better-sqlite3`.** The server already uses it (a working `content_packs` STRICT table, WAL mode, ad-hoc migration, a prepared-statement repository, all green under `content:startup-gate`). 6A extends this rather than replacing it; the brainstorm's initial `node:sqlite` lean was reversed once the existing infrastructure was found. Zero new database dependencies.
- **Layered server**: a `db/` layer (migration runner + per-table repositories), a `services/` layer (pure-ish auth/mail/settings logic taking injected clock, randomness, and mail transport), and Fastify routes wiring HTTP semantics (cookies, CSRF, origin checks) onto services. This mirrors the engine's injected-dependency purity so token expiry, rate-limit windows, and session lifetime are testable without wall-clock flakes.
- **Mail transport seam.** A `MailTransport` interface with a Mailgun implementation (production, env-configured) and a dev-echo implementation (logs the link server-side and exposes it through a dev-only endpoint, active only when no Mailgun credentials are configured). E2e and local dev complete the real magic-link loop with no external service; the Mailgun implementation gets a contract test against its recorded request shape, no network.
- **6A user-visible payoff**: sign in / sign out from the title screen, the signed-in email shown in the title and settings, and the client `Settings` blob (font scale, motion, theme, lighting, key bindings, onboarding preference) roaming to the profile so it follows the player across devices. Play, the active run, and the Hall stay guest-local until later slices.
- **First-party Fastify plugins only**: `@fastify/cookie` and `@fastify/csrf-protection` join `@fastify/static`. Security-sensitive cookie signing and CSRF handling are not hand-rolled; both are first-party and consistent with the existing `@fastify/static` dependency.
- Everything follows the master design's security requirements verbatim: uniform login responses, 256-bit tokens stored only as SHA-256 hashes, 15-minute single-use magic links, hashed revocable sessions in `HttpOnly`/`Secure`/`SameSite=Lax` cookies, origin + CSRF validation on state-changing requests, rate limiting by normalized email and source address, and no secrets in the browser bundle.

## The migration runner

The current `migrateDatabase` is a one-off `content_packs` reshape. 6A replaces it with an ordered, idempotent runner keyed on SQLite's `user_version` pragma:

- Migration 1 establishes/preserves `content_packs` (folding in the existing legacy-rename logic so already-deployed databases at `user_version = 0` migrate forward without data loss), then sets `user_version = 1`.
- Migration 2 creates the 6A auth tables and sets `user_version = 2`.
- The runner runs every pending migration in order inside transactions before the server accepts traffic (the existing startup already blocks listen on migration); re-running against a current database is a no-op. Each migration is a pure `(db) => void` registered in an ordered list, tested individually and as a full fresh-database sequence.

Later slices append migrations (active-run tables in 6B, hall/telemetry in 6C) without touching earlier ones.

## Schema (6A tables)

STRICT tables beside `content_packs`:

- `profiles`: `id` (text uuid pk), `normalized_email` (text unique), `progression_json` (text — default/empty in 6A; unlocks arrive in 6C), `settings_json` (text nullable), `settings_version` (integer), `created_at`, `updated_at`.
- `login_tokens`: `token_hash` (text pk — SHA-256 hex), `normalized_email` (text), `expires_at` (text iso), `created_at`, `consumed_at` (text nullable — single-use). Plaintext tokens are never stored.
- `sessions`: `token_hash` (text pk — SHA-256 hex), `profile_id` (text fk → profiles.id), `created_at`, `last_seen_at`, `expires_at` (text iso — 30-day inactivity), `revoked_at` (text nullable).

Rate-limit state is in-memory (a sliding-window `RateLimiter` keyed by normalized email and source address, injected clock) rather than a table — a single-container deploy makes cross-restart persistence low-value against the abuse it prevents; the limitation is documented, and the limiter is a seam a future slice can back with a table if needed.

## Auth services (`apps/server/src/auth/`)

Pure-ish modules taking injected `clock`, `randomBytes`, `MailTransport`, and the repositories:

- **`normalizeEmail(raw)`** — trim, lowercase, NFC; the single normalization used everywhere (storage, rate-limit keys, token binding).
- **`requestLogin({ email, sourceAddress })`** — normalizes, checks the rate limiter (by email and by source), generates a 256-bit token, stores its SHA-256 hash with a 15-minute expiry bound to the email, and sends `${PUBLIC_URL}/auth/verify?token=<plaintext>` through the transport. Returns a **uniform** result regardless of whether a profile exists (the response the route sends is identical either way; profile creation is deferred to verification). Rate-limited requests return the same uniform shape.
- **`verifyToken({ token })`** — hashes the presented token, looks up an unconsumed, unexpired row (timing-safe), marks it consumed (single-use), finds-or-creates the profile for the bound email, mints a session (256-bit token, SHA-256-hashed, 30-day expiry), and returns the plaintext session token for the cookie plus the profile. Invalid/expired/consumed tokens return a uniform failure.
- **`sessionFromToken(token)`** / **`touchSession`** — validates a presented session token by hash, checks not-revoked and not-expired, slides `last_seen_at` (bounded write — only when it has meaningfully advanced, to avoid a write per request). Returns the profile or null.
- **`revokeSession(token)`** — marks `revoked_at`; idempotent.
- **`readProfileSettings` / `writeProfileSettings`** — the settings blob is stored opaquely (validated only as a JSON object under a size cap with a `settings_version` tag; the server does not deep-validate client presentation schema — a malformed blob only affects that profile's own client, which re-validates through the existing forward-tolerant `loadSettings`).

## Routes (`apps/server/src/routes/auth.ts`)

Registered on the existing Fastify app beside `/api/health` and `/api/content/guest`:

- `POST /api/auth/login` — body `{ email }`; origin-checked; rate-limited; always 200 with the uniform "if that email exists, a link is on its way" shape. No CSRF token required (pre-session, email-initiated).
- `GET /api/auth/verify?token` — the magic-link target the email client follows. Validates and consumes the token, mints the session, sets the `HttpOnly`/`Secure`/`SameSite=Lax` session cookie, and 303-redirects to the app. GET verification is safe here because the single-use, high-entropy, email-bound token *is* the credential (login-CSRF is mitigated by the email-initiated, email-bound flow); it is the one deliberate exception to "state-changing requests require CSRF," documented as such.
- `GET /api/auth/session` — returns `{ email }` for the current session (or 401), plus issues/refreshes the CSRF token used by authenticated mutations.
- `POST /api/auth/logout` — session + CSRF required; revokes the session, clears the cookie.
- `GET /api/profile/settings` — session required; returns `{ settings, settingsVersion }` or an empty marker.
- `PUT /api/profile/settings` — session + CSRF required; stores the opaque settings blob (size-capped).
- `GET /api/dev/last-login-link?email` — **dev transport only** (returns 404 when Mailgun is configured); returns the most recent link for an email so e2e and local dev can complete the loop without mail.

State-changing routes validate the request origin against `PUBLIC_URL` and the CSRF token (double-submit via `@fastify/csrf-protection`). The session cookie is signed with `COOKIE_SECRET`; `Secure` is derived from the `PUBLIC_URL` scheme so local http dev works while production https sets it.

## Config additions (`config.ts`)

New env-driven fields, none entering the browser bundle: `publicUrl` (`PUBLIC_URL`, drives link generation, origin checks, and the cookie `Secure` flag), `cookieSecret` (`COOKIE_SECRET`), `mailgun` (`MAILGUN_API_KEY` + `MAILGUN_DOMAIN` + sender — absence selects the dev-echo transport), and rate-limit tuning with sane defaults. `readConfig` validates presence/shape and fails fast at startup (mirroring the existing `PORT` validation), with a clear error when production-shaped config (a non-localhost `PUBLIC_URL`) is missing `COOKIE_SECRET` or Mailgun credentials.

## Client (`apps/web`)

- **Title screen** gains "Sign in with email" beside the existing guest/continue/Hall actions: an email form → submit → a uniform "Check your email for a sign-in link." confirmation (no email-existence leak). The verify link redirects back into the app already signed in.
- **Signed-in identity**: the title and the settings Display/Account section show the email and a "Sign out" action (POST logout, then back to guest presentation). A framework-free `account` session module holds `{ email } | null` from `GET /api/auth/session` at boot, using the established session-layer conventions.
- **Settings roaming**: on a confirmed session, the client fetches `GET /api/profile/settings`. If the server holds settings, they win (adopted into the live `Settings` and written to the localStorage cache); if the server is empty, the local settings seed it via `PUT`. Thereafter every settings change writes localStorage **and** debounce-pushes to the server. On sign-out the client reverts to localStorage-only (guest) behavior; the cache persists. Onboarding mastery stays device-local in 6A (it is guidance progress, closer to per-device than per-profile; roaming it is noted for a later slice). CSRF tokens for the authenticated `PUT`/`POST` come from `GET /api/auth/session`.
- Guest mode is entirely untouched — the whole guest experience (5A–5D) works exactly as before whether or not a profile exists.

## Error handling

- Mailgun send failure surfaces as a generic "couldn't send the link, try again" to the client (never leaking whether the email exists) and is logged server-side; the token row is still created (harmless — it simply expires unused).
- A malformed or oversized settings `PUT` is rejected with a 400 and does not overwrite the stored blob; the client keeps its local copy.
- Session cookie present but invalid/expired/revoked → treated as signed-out (401 on protected routes; the client silently falls back to guest).
- Database write failures inside a request roll back the transaction and return a 500; startup migration failure aborts before listen (the existing startup already blocks on this).
- Rate-limited login returns the uniform success shape (no signal that the limit was hit), while the limiter's own counters are logged server-side.

## Testing and exit demonstration

- **DB**: migration-runner tests — fresh database reaches the current `user_version`; an existing `content_packs`-only database migrates forward preserving rows; re-running is a no-op; each migration in isolation. Repository round-trips for all three tables.
- **Services** (injected clock/randomness/transport): email normalization; uniform login response with and without an existing profile; token single-use, expiry, and email binding; session mint/validate/slide/expire/revoke; rate-limit windows by email and by source; timing-safe token comparison; the "hashes only, never plaintext" invariant asserted directly against stored rows.
- **Routes** (Fastify `inject`): login uniformity; verify sets the cookie and redirects and is single-use; authenticated settings GET/PUT gated by session + CSRF; logout revokes; unauthenticated protected routes 401; missing/invalid CSRF 403; cross-origin rejected; the dev link endpoint present in dev mode and absent when Mailgun is configured.
- **Mailgun transport**: a contract test asserting the constructed request shape (endpoint, auth header, form fields) without network.
- **Client**: title sign-in flow and uniform confirmation; settings-roam-on-sign-in (server-wins and local-seed branches); sign-out reverting to guest; CSRF token threading.
- **E2e**: the full magic-link loop through the dev endpoint — request a link, fetch it from `/api/dev/last-login-link`, follow it, land signed in, change a setting, reload in a fresh context with the session cookie, confirm the setting came from the server; sign out and confirm guest fallback. The five existing guest specs stay green untouched.
- **Exit demonstration**: `npm run guest:e2e` green including the new auth spec, `content:startup-gate` and `smoke` green against the extended schema, and every existing gate green.

## Out of scope for 6A

Server-authoritative runs, the WebSocket protocol, and checkpointing (6B); the verified Hall, server unlock evaluation, class unlocks going live, lifetime statistics, JSON export, and profile deletion (6C); the admin balance dashboard and `ADMIN_EMAILS` gating (milestone 8); telemetry and `telemetry_runs` (milestone 8); onboarding-mastery roaming; and any change to guest-mode behavior.
