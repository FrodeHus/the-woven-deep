# Identity and Server-Authoritative Persistence

**Status:** In progress — 6A (identity and persistence foundation) shipped; 6B
(server-authoritative runs) and 6C (verified Hall) are next

**Package:** `apps/server`, `apps/web` (account module)

Milestone 6 is the first server-authoritative milestone: it moves progression from purely
guest-local (`sessionStorage`, discarded on browser close — see `guest-client.md`) toward
signed-in profiles with server-persisted state. Per the master design, one verified email
maps to exactly one progression profile; there is no password auth, no leaderboard, and
guest progress is never importable into a persistent profile. Milestone 6 was sliced into
three sub-milestones during brainstorming: **6A** (this doc's main content — identity, the
persistence foundation, and roaming settings), **6B** (server-authoritative runs over
WebSocket), and **6C** (the verified Hall, server unlock evaluation, lifetime stats,
export, profile deletion).

## 6A: identity and persistence foundation (shipped)

A real vertical slice: a player can sign in with an email magic link and have their
**settings** roam across devices, while play itself stays guest-local until 6B lands.

### Server layers

- **`db/`** — a migration runner plus per-table repositories, over `better-sqlite3` (kept
  rather than replaced — the server already had a working `content_packs` STRICT table,
  WAL mode, and a prepared-statement repository before this milestone; extending it meant
  zero new database dependencies).
- **`services/`** — pure-ish auth/mail/settings logic taking injected clock, randomness,
  and mail transport, mirroring the engine's injected-dependency purity so token expiry,
  rate-limit windows, and session lifetime are testable without wall-clock flakiness.
- **Fastify routes** — wire HTTP semantics (cookies, CSRF, origin checks) onto the
  services layer.

The migration runner replaced a one-off `content_packs` reshape with an ordered,
idempotent runner keyed on SQLite's `user_version` pragma: migration 1
establishes/preserves `content_packs` (folding in legacy-rename logic so already-deployed
databases migrate forward without data loss), migration 2 adds the 6A auth tables. Every
pending migration runs inside a transaction before the server accepts traffic; re-running
against a current database is a no-op. Later slices (6B active-run tables, 6C hall/
telemetry tables) only append migrations — earlier ones are never touched again, matching
the engine's frozen-schema-plus-ordered-migration discipline in
`deterministic-engine.md`.

### Tables (STRICT, beside `content_packs`)

- **`profiles`** — UUID, normalized email (unique), opaque progression JSON (empty in 6A;
  unlocks arrive in 6C), an opaque settings blob + version, timestamps.
- **`login_tokens`** — SHA-256 token hash (never plaintext), normalized email, 15-minute
  expiry, single-use (`consumed_at`).
- **`sessions`** — SHA-256 token hash, profile ID, 30-day inactivity expiry, revocable.

Rate-limit state is deliberately **in-memory** (a sliding-window limiter keyed by
normalized email and source address, injected clock) rather than a table — for a single-
container deployment, cross-restart persistence was judged low-value against the abuse it
prevents. The limitation is documented and the limiter is a seam a future slice can back
with a table if needed.

### Auth flow

`requestLogin` normalizes the email, checks the rate limiter, generates a 256-bit token,
stores only its SHA-256 hash with a 15-minute expiry, and sends a verify link through a
`MailTransport` (a Mailgun implementation for production, and a dev-echo implementation
that logs the link server-side and exposes it through a dev-only endpoint — active only
when no Mailgun credentials are configured, which is what lets e2e and local dev complete
the real magic-link loop with no external service). The response is **uniform** whether
or not a profile exists for that email, always — including under rate limiting — so
nothing about the response leaks account existence.

`verifyToken` hashes the presented token, looks up an unconsumed unexpired row (timing-
safe comparison), marks it consumed, finds-or-creates the profile for the bound email,
mints a session (another 256-bit token, SHA-256-hashed, 30-day expiry), and returns the
plaintext session token for the cookie. `GET /api/auth/verify` is the one deliberate
exception to "state-changing requests require CSRF": it's a GET specifically because the
single-use, high-entropy, email-bound token *is* the credential, and login-CSRF is
mitigated by the flow being email-initiated and email-bound — this exception is
documented as such, not accidental.

Every other security property in the master design is implemented verbatim: 256-bit
tokens stored only as SHA-256 hashes, 15-minute single-use magic links, hashed revocable
sessions in `HttpOnly`/`Secure`/`SameSite=Lax` cookies (`Secure` derived from the
`PUBLIC_URL` scheme, so local HTTP dev works while production HTTPS enforces it), origin
+ CSRF validation on state-changing requests (first-party `@fastify/csrf-protection`, not
hand-rolled), per-email/per-source rate limiting, and no secrets ever entering the
browser bundle. `readConfig` fails fast at startup if a production-shaped `PUBLIC_URL`
(non-localhost) is missing `COOKIE_SECRET` or Mailgun credentials.

### Settings roaming

The 6A user-visible payoff: sign in/out from the title screen, the signed-in email shown
in the title and settings, and the client's `Settings` blob (font scale, motion, theme,
lighting, key bindings, onboarding preference) roaming to the profile. On a confirmed
session, the client fetches server settings; if the server holds settings, they win and
overwrite the local cache; if the server is empty, the local settings seed it. Thereafter
every settings change writes `localStorage` *and* debounce-pushes to the server. Signing
out reverts to `localStorage`-only guest behavior; the cache persists locally.
Onboarding-mastery progress deliberately stays device-local in 6A — it reads as guidance
progress, closer to per-device than per-profile, and roaming it is left for a later
slice. The settings blob itself is stored server-side **opaquely**: validated only as a
JSON object under a size cap with a version tag, never deep-validated against the
client's presentation schema — a malformed blob only ever affects that profile's own
client, which re-validates through its existing forward-tolerant loader.

Guest mode is entirely untouched by 6A: the whole 5A–5D guest experience works identically
whether or not a profile exists.

## 6B: server-authoritative runs (next)

Not yet designed in detail here. Per the master design and the roadmap, this slice
implements Mailgun-authenticated WebSocket play: compact sequenced command batches,
observable state patches, client-side prediction reconciliation, immediate saves after
consequential changes, periodic checkpointing for pure movement, reconnection, and
idempotent command replay under stale-revision rejection — the server running the exact
same `packages/engine` a signed-in profile's browser never runs locally.

## 6C: verified Hall and lifetime state (next)

Not yet designed in detail here. Per the roadmap, this slice moves the `RunRecordRepository`
interface (`run-records.md`) to a server-backed, verified implementation; wires up server-
side unlock evaluation (going live for locked classes, per the master design's
metaprogression rules); adds lifetime statistics aggregation, JSON export of a profile's
records/discoveries/unlocks, and profile deletion (requiring recent authentication and
email confirmation, per the master design).
