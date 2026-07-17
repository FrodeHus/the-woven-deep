# Identity and Persistence Foundation (Milestone 6A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email magic-link sign-in with server-side profiles and roaming settings, per `docs/superpowers/specs/2026-07-18-identity-persistence-design.md`.

**Architecture:** A layered Fastify/`better-sqlite3` server — an ordered `user_version` migration runner + per-table repositories (`db/`), pure-ish auth services taking injected clock/randomness/mail transport (`auth/`), and routes wiring cookies/CSRF/origin onto services. The client gains a framework-free account module and settings roaming. Guest mode is untouched.

**Tech Stack:** Fastify 5 + `@fastify/cookie` + `@fastify/csrf-protection`, `better-sqlite3` 12, `node:crypto`, Vitest, React 19, Playwright.

## Global Constraints

- **Keep `better-sqlite3`** — extend the existing `database.ts`/migration pattern; zero new DB dependencies. `node:crypto` is available server-side and unused today.
- Node `>=22.12.0`; the server may use Node APIs freely (it is not the browser-safe engine). The engine and web packages stay untouched by this milestone.
- **Security requirements verbatim from the spec**: uniform login responses regardless of email existence; 256-bit tokens stored **only** as SHA-256 hashes; 15-minute single-use magic links; session tokens stored only as hashes, in `HttpOnly`/`Secure`/`SameSite=Lax` cookies, revocable, 30-day inactivity expiry; origin + CSRF validation on authenticated state-changing requests; rate limiting by normalized email and source address; timing-safe token comparison; no secrets in the browser bundle.
- **The two documented CSRF carve-outs** (spec): `POST /api/auth/login` has origin check + rate limit but no CSRF token (pre-session, email-initiated); `GET /api/auth/verify` is the magic-link target (the single-use high-entropy email-bound token is the credential). Every *authenticated* mutation requires session + CSRF.
- The server never accepts a complete run state, score, Hall entry, or unlock list from the browser (CLAUDE.md authority stance — preserved; 6A adds no run/score/record acceptance).
- New env vars (`PUBLIC_URL`, `COOKIE_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_SENDER`) never enter the browser bundle.
- RED-first TDD; conventional commits; existing gates stay green (`content:startup-gate`, `smoke`, the five guest e2e specs, all workspace suites).

## Key facts (verified at HEAD 9295adc)

- **Server layout** (`apps/server/src/`): `main.ts` composes (`readConfig` → `mkdir` → `openDatabase` → `new ContentPackRepository` → `runServerStartup`); `startup.ts` `runServerStartup({database, compilePack, persistPack, buildServer, listenOptions, signals, onShutdownError})` (compile→persist→buildServer→attach→listen); `app.ts` `buildApp({pack, webDistDir?}): FastifyInstance` (`Fastify({logger:false})`, inline `/api/health` + `/api/content/guest`, `@fastify/static` register + SPA `setNotFoundHandler` guarded by `isReservedApiUrl`); `lifecycle.ts` `ShutdownDatabase = {pragma(source): unknown; close(): void}` (better-sqlite3 satisfies it), shutdown does `server?.close()` → `pragma('wal_checkpoint(TRUNCATE)')` → `close()`.
- **DB** (`database.ts`): `openDatabase(path): Database.Database` → `new Database(path)` + `migrateDatabase(db)`; current `migrateDatabase` sets `pragma('journal_mode = WAL')`, does a legacy `content_packs` rename-if-missing-`content_json`, then `create table if not exists content_packs(...) strict`. `content-repository.ts` `ContentPackRepository(database)` with `.put()/.get()` prepared statements. Tests use `new Database(':memory:')` directly (`database.test.ts:38`); real-file tests use `mkdtempSync`.
- **Config** (`config.ts`): `ServerConfig {host, port, databasePath, contentDir, webDistDir}`; `readConfig(env=process.env)` validates `PORT` (1–65535) and resolves paths relative to repo root when unset. Fail-fast on bad `PORT` (mirror this for new vars).
- **Fastify** `^5.4.0`; `@fastify/static` `^9.1.1`; `better-sqlite3` `^12`. `@fastify/cookie`/`@fastify/csrf-protection` are **not present** — add them (`@fastify/csrf-protection` depends on `@fastify/cookie`; both first-party). Register pattern: `void app.register(plugin, options)`.
- **Server tests**: no vitest config (Node defaults); `buildApp({pack})` + `await app.inject({method, url, ...})` asserting `.json()/.body/.statusCode/.headers`, `await app.close()`. Minimal pack literal: `{schemaVersion: 3, hash: 'b'.repeat(64), entries: [], generationReport: {foundationalCategories: []}}`.
- **Client settings** (`apps/web/src/session/settings.ts`): `Settings {fontScale, reducedMotion, theme, lighting, onboarding, bindings}`; `SETTINGS_KEY='woven-deep.settings.v1'`; `loadSettings(storage): {settings, corrupted, droppedOverrides}` (forward-tolerant); `saveSettings(storage, settings): {ok:true} | {ok:false, reason?}`. `storage.ts` `SessionStorageLike {get, set, remove?}`, `browserLocalStorage()`. App.tsx: `loadSettings` once at boot (`:273`), `handleSettingsChange(next)` (`:296`) = `saveSettings` then `setSettings`.
- **Client boot/title**: `ScreenState` (App.tsx:45), boot `useEffect` calls `loadContentPack(fetcher)` (App.tsx:347); `api.ts` `loadContentPack(fetcher=fetch)` hits relative `/api/content/guest`; `AppProps.fetcher` is the test seam. `TitleScreen.tsx` `options` array (`:46-55`): Enter the Deep / Continue / Hall / (Codex/Settings/Help if `onOpenOverlay`). Vite proxies `/api` → `localhost:3000` (auto-covers `/api/auth/*`).
- **E2e**: `apps/web/playwright.config.ts` webServer runs the **real server** — `command: 'node ../server/dist/main.js'`, `env: {PORT:'4173', HOST:'127.0.0.1', DATABASE_PATH:'../../data/e2e-guest.sqlite'}`, readiness `GET /api/content/guest`, `reuseExistingServer:false`, `workers:1`. `/api/auth/*` will be reachable. Root `guest:e2e` = `npm run build && npm run e2e`.
- **Deploy**: root `Dockerfile` (multi-stage, `node:22-bookworm-slim`, runtime `ENV NODE_ENV/HOST/PORT/DATABASE_PATH=/data/rogue.sqlite/CONTENT_DIR/WEB_DIST_DIR`, `VOLUME ["/data"]`); root `compose.yaml` (`environment:` block, `rogue-data:/data`). Both are where new env vars slot. `docs/server-admin/` (README + content-configuration) + `docs/operations/` are the doc homes.

---

### Task 1: Ordered migration runner

**Files:**
- Modify: `apps/server/src/database.ts`, `apps/server/test/database.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3` `Database`.
- Produces:

```ts
export type Migration = Readonly<{ id: number; name: string; up: (db: Database.Database) => void }>;
export const MIGRATIONS: readonly Migration[];   // ordered by id, contiguous from 1
export function runMigrations(db: Database.Database): void; // pragma user_version-gated, transactional per migration
export function openDatabase(path: string): Database.Database; // unchanged signature: new Database(path) + WAL pragma + runMigrations
```

- `runMigrations` reads `db.pragma('user_version', {simple:true})` as a number, runs every `MIGRATIONS[i]` with `id > current` in ascending order, each inside `db.transaction(() => { m.up(db); db.pragma(\`user_version = ${m.id}\`); })()`. Contiguity + ascending order asserted at module load (a cheap invariant check throwing on gaps).
- **Migration 1 (`content_packs`)** folds in today's logic verbatim: the legacy rename-if-missing-`content_json` branch, then `create table if not exists content_packs(...) strict`. `journal_mode = WAL` stays a connection pragma set in `openDatabase` before `runMigrations` (WAL is not a migration). An already-deployed DB sits at `user_version = 0`, so migration 1 re-runs its idempotent create/rename once and advances to 1 — no data loss.

- [ ] RED: fresh `:memory:` DB → `runMigrations` → `user_version === MIGRATIONS.length` and `content_packs` exists with the strict columns; a hand-built pre-migration DB holding a populated legacy `content_packs` (old shape) migrates forward preserving rows and reaching `user_version 1+`; re-running `runMigrations` on a current DB is a no-op (user_version unchanged, no throw); the contiguity invariant throws if a gap is introduced (test a deliberately-gapped local array via the exported checker). Then implement → `npm run test --workspace @woven-deep/server` + typecheck → commit `feat: add an ordered migration runner`.

---

### Task 2: Auth schema and repositories

**Files:**
- Create: `apps/server/src/db/profile-repository.ts`, `apps/server/src/db/login-token-repository.ts`, `apps/server/src/db/session-repository.ts`, `apps/server/test/db/repositories.test.ts`
- Modify: `apps/server/src/database.ts` (append migration 2)

**Interfaces:**
- Consumes: Task 1's `MIGRATIONS` array (append migration 2), `Database.Database`.
- Produces:

```ts
// Migration 2 creates three STRICT tables:
//   profiles(id text pk, normalized_email text unique not null, progression_json text not null,
//            settings_json text, settings_version integer not null default 0,
//            created_at text not null, updated_at text not null)
//   login_tokens(token_hash text pk, normalized_email text not null,
//                expires_at text not null, created_at text not null, consumed_at text)
//   sessions(token_hash text pk, profile_id text not null references profiles(id),
//            created_at text not null, last_seen_at text not null, expires_at text not null, revoked_at text)

export interface ProfileRow { id: string; normalizedEmail: string; progressionJson: string;
  settingsJson: string | null; settingsVersion: number; createdAt: string; updatedAt: string }
export class ProfileRepository {
  constructor(db: Database.Database);
  findByEmail(normalizedEmail: string): ProfileRow | undefined;
  findById(id: string): ProfileRow | undefined;
  create(input: { id: string; normalizedEmail: string; nowIso: string }): ProfileRow; // progression_json='{}', settings null, version 0
  updateSettings(input: { id: string; settingsJson: string; settingsVersion: number; nowIso: string }): void;
}
export interface LoginTokenRow { tokenHash: string; normalizedEmail: string; expiresAt: string; createdAt: string; consumedAt: string | null }
export class LoginTokenRepository {
  constructor(db: Database.Database);
  insert(row: Omit<LoginTokenRow,'consumedAt'>): void;
  findUnconsumed(tokenHash: string): LoginTokenRow | undefined;   // consumed_at IS NULL only
  markConsumed(input: { tokenHash: string; nowIso: string }): boolean; // UPDATE ... WHERE consumed_at IS NULL; returns changes===1
  deleteExpired(nowIso: string): number;
}
export interface SessionRow { tokenHash: string; profileId: string; createdAt: string; lastSeenAt: string; expiresAt: string; revokedAt: string | null }
export class SessionRepository {
  constructor(db: Database.Database);
  insert(row: Omit<SessionRow,'revokedAt'>): void;
  find(tokenHash: string): SessionRow | undefined;
  touch(input: { tokenHash: string; lastSeenAt: string; expiresAt: string }): void;
  revoke(input: { tokenHash: string; nowIso: string }): void;    // idempotent: sets revoked_at only if null
  deleteExpired(nowIso: string): number;
}
```

- All methods use prepared statements. `markConsumed`'s single-use guarantee is the `WHERE consumed_at IS NULL` + `changes===1` check (two concurrent consumes → only one returns true).

- [ ] RED: migration 2 creates all three tables (query `sqlite_master`); profile create/find-by-email/find-by-id round-trip incl. the `normalized_email` UNIQUE constraint (duplicate insert throws); `updateSettings` persists blob+version+updated_at; login-token insert/findUnconsumed (a consumed row is not returned)/`markConsumed` returns true once then false on a second call (single-use); `deleteExpired` removes only past-expiry rows; session insert/find/touch (slides last_seen+expires)/`revoke` idempotent (second revoke leaves the original `revoked_at`)/`deleteExpired`. Then implement → server suite + typecheck → commit `feat: add auth schema and repositories`.

---

### Task 3: Config additions and crypto helpers

**Files:**
- Modify: `apps/server/src/config.ts`, `apps/server/test/config.test.ts`
- Create: `apps/server/src/auth/tokens.ts`, `apps/server/test/auth/tokens.test.ts`

**Interfaces:**
- Produces:

```ts
// config.ts — ServerConfig gains:
export interface AuthConfig {
  readonly publicUrl: string;              // PUBLIC_URL (default 'http://localhost:3000')
  readonly cookieSecret: string;           // COOKIE_SECRET
  readonly cookieSecure: boolean;          // derived: publicUrl scheme === 'https:'
  readonly mailgun: Readonly<{ apiKey: string; domain: string; sender: string }> | null; // null → dev-echo transport
  readonly loginRateLimit: Readonly<{ perEmailPerHour: number; perSourcePerHour: number }>; // defaults 5 / 20
}
// ServerConfig gains `readonly auth: AuthConfig`.
// readConfig validation: PUBLIC_URL must parse as an http(s) URL. If its host is NOT localhost/127.0.0.1
//   (i.e. production-shaped), COOKIE_SECRET is REQUIRED (>=32 chars) and MAILGUN_* all-or-nothing present.
//   For a localhost publicUrl, COOKIE_SECRET defaults to a fixed dev value and mailgun may be absent (dev-echo).
//   Mailgun is all-three-or-none: partial config throws.

// tokens.ts — node:crypto wrappers:
export function generateToken(): string;                 // 32 random bytes → base64url (256 bits)
export function hashToken(token: string): string;        // sha256 hex
export function timingSafeEqualHex(a: string, b: string): boolean; // length-guarded timingSafeEqual over hex buffers
```

- [ ] RED: config — a localhost `PUBLIC_URL` with no `COOKIE_SECRET`/mailgun yields `auth.mailgun===null`, a dev `cookieSecret`, `cookieSecure===false`; an `https://…` production `PUBLIC_URL` without `COOKIE_SECRET` throws; production with a short secret throws; partial mailgun (domain but no key) throws; full mailgun populates `auth.mailgun`; rate-limit defaults applied, overridable by env. tokens — `generateToken` returns distinct 43-char base64url strings across calls; `hashToken` is deterministic 64-hex and differs from its input; `timingSafeEqualHex` true for equal, false for unequal and for length-mismatch without throwing. Then implement → server suite + typecheck → commit `feat: add auth config and token crypto`.

---

### Task 4: Mail transport seam

**Files:**
- Create: `apps/server/src/auth/mail-transport.ts`, `apps/server/test/auth/mail-transport.test.ts`

**Interfaces:**
- Consumes: `AuthConfig` (Task 3).
- Produces:

```ts
export interface MailTransport {
  sendLoginLink(input: Readonly<{ email: string; link: string }>): Promise<void>;
  // dev transport only:
  lastLinkFor?(email: string): string | undefined;
}
export function createMailTransport(config: AuthConfig, fetchImpl?: typeof fetch): MailTransport;
// config.mailgun === null → dev transport (stores latest link per normalized email in a Map, resolves immediately);
// else → Mailgun transport: POST https://api.mailgun.net/v3/${domain}/messages, Authorization: Basic base64('api:'+apiKey),
//   application/x-www-form-urlencoded body { from: sender, to: email, subject, text (the link) }. Non-2xx → throw.
```

- [ ] RED: dev transport stores and returns the last link per email (`lastLinkFor`), and a second link overwrites the first; Mailgun transport (inject a `fetchImpl` double) issues one POST to the domain messages endpoint with the Basic auth header and the from/to/subject/text form fields, and throws on a non-2xx response; `createMailTransport` returns the dev transport when `mailgun===null` and the Mailgun transport otherwise. Then implement → server suite + typecheck → commit `feat: add the mail transport seam`.

---

### Task 5: Login request service and rate limiter

**Files:**
- Create: `apps/server/src/auth/rate-limiter.ts`, `apps/server/src/auth/email.ts`, `apps/server/src/auth/login-service.ts`, `apps/server/test/auth/login-service.test.ts`
- Test: `apps/server/test/auth/rate-limiter.test.ts`

**Interfaces:**
- Consumes: `LoginTokenRepository` (Task 2), `generateToken`/`hashToken` (Task 3), `MailTransport` (Task 4), `AuthConfig`.
- Produces:

```ts
export function normalizeEmail(raw: string): string; // trim, toLowerCase (locale-independent), NFC normalize
export interface Clock { now(): Date }
export class RateLimiter {
  constructor(input: { clock: Clock; windowMs: number });
  check(key: string, limit: number): boolean; // sliding window; true = allowed (records a hit), false = over limit
}
export interface LoginService { request(input: Readonly<{ email: string; sourceAddress: string }>): Promise<void> }
export function createLoginService(deps: Readonly<{
  clock: Clock; tokens: LoginTokenRepository; transport: MailTransport; config: AuthConfig;
  generateToken: () => string; hashToken: (t: string) => string;
}>): LoginService;
```

- `request`: `normalizeEmail`; if `!rateLimiter.check('email:'+email, perEmailPerHour)` OR `!check('src:'+source, perSourcePerHour)` → return silently (uniform — no throw, no signal); else generate a token, `tokens.insert({tokenHash: hashToken(token), normalizedEmail, expiresAt: now+15min, createdAt: now})`, and `await transport.sendLoginLink({email, link: config.publicUrl + '/api/auth/verify?token=' + encodeURIComponent(token)})`. `request` **always resolves the same way** whether or not a profile exists (profiles are created at verify time, so this service never touches ProfileRepository — that is what makes the response uniform). A transport failure is caught and swallowed to `void` (logged by the caller/route), so timing/response stay uniform.

- [ ] RED: rate limiter — allows `limit` hits in a window then blocks, and re-allows after the window elapses (advance the injected clock); distinct keys are independent. login-service — a successful request inserts exactly one token row whose stored `token_hash` equals `hashToken(<the token in the sent link>)` and is NOT the plaintext (parse the link the dev transport captured, hash it, compare); the stored `expires_at` is 15 minutes ahead of the injected clock; a request over the email rate limit inserts NO row and sends NO link but still resolves (uniform); `normalizeEmail` folds case/whitespace/`Ä`-composition. Then implement → server suite + typecheck → commit `feat: add login request and rate limiting`.

---

### Task 6: Verification and session services

**Files:**
- Create: `apps/server/src/auth/verify-service.ts`, `apps/server/src/auth/session-service.ts`, `apps/server/test/auth/verify-service.test.ts`, `apps/server/test/auth/session-service.test.ts`

**Interfaces:**
- Consumes: `LoginTokenRepository`, `ProfileRepository`, `SessionRepository` (Task 2), tokens (Task 3), `Clock` (Task 5).
- Produces:

```ts
export interface VerifyResult { sessionToken: string; profile: ProfileRow } // returned only on success
export interface VerifyService { verify(input: Readonly<{ token: string }>): VerifyResult | null }
export function createVerifyService(deps: Readonly<{
  clock: Clock; tokens: LoginTokenRepository; profiles: ProfileRepository; sessions: SessionRepository;
  generateToken: () => string; hashToken: (t: string) => string; newId: () => string; // newId = crypto.randomUUID
}>): VerifyService;

export interface AuthenticatedProfile { profileId: string; email: string }
export interface SessionService {
  authenticate(sessionToken: string): AuthenticatedProfile | null; // validates hash, not-revoked, not-expired; slides last_seen/expires (bounded: only if >60s since last touch)
  revoke(sessionToken: string): void;
}
export function createSessionService(deps: Readonly<{
  clock: Clock; sessions: SessionRepository; profiles: ProfileRepository; hashToken: (t: string) => string;
  sessionTtlMs: number; // 30 days
}>): SessionService;
```

- `verify`: `hashToken(token)`; `tokens.findUnconsumed(hash)`; null or `expiresAt <= now` → return null (uniform failure); then run the mutation **inside a single `db.transaction`** (so consume + profile-create + session-insert are atomic — a partial failure after consume never strands a consumed token with no session): `tokens.markConsumed({tokenHash, nowIso})` — if it returns false (already consumed by a race) → abort/return null; find-or-create the profile for `row.normalizedEmail` (`profiles.findByEmail` ?? `profiles.create({id: newId(), normalizedEmail, nowIso})`); generate a session token, `sessions.insert({tokenHash: hashToken(sessionToken), profileId, createdAt: now, lastSeenAt: now, expiresAt: now+30d})`; return `{sessionToken, profile}`. The transaction takes the `Database.Database` as a dep so the service can wrap these repo calls (`createVerifyService` gains a `db` dep, or a `transaction(fn)` runner injected from it).
- `authenticate`: `sessions.find(hashToken(token))`; null/revoked/`expiresAt<=now` → null; else optionally `touch` (bounded), return `{profileId, email}` (email via `profiles.findById`).

- [ ] RED: verify — a fresh valid token mints a session and creates a profile the first time / reuses it the second time (same email, two tokens → one profile); the consumed token cannot be reused (second `verify` of the same token → null, and no second session row); an expired token → null and stays unconsumed; a garbage token → null. session — a freshly minted token authenticates to its profile; a revoked session → null; an expired session → null; `touch` slides expiry but only after the 60s threshold (advance clock, assert bounded writes); `revoke` is idempotent. Assert stored session/token rows are hashes, never the plaintext returned to the caller. Then implement → server suite + typecheck → commit `feat: add verification and session services`.

---

### Task 7: Profile settings service

**Files:**
- Create: `apps/server/src/auth/settings-service.ts`, `apps/server/test/auth/settings-service.test.ts`

**Interfaces:**
- Consumes: `ProfileRepository` (Task 2), `Clock`.
- Produces:

```ts
export const SETTINGS_MAX_BYTES = 8192;
export interface ProfileSettings { settingsJson: string | null; settingsVersion: number }
export interface SettingsService {
  read(profileId: string): ProfileSettings;               // { settingsJson: null, settingsVersion: 0 } when unset
  write(input: Readonly<{ profileId: string; settingsJson: string; settingsVersion: number }>): { ok: true } | { ok: false; reason: 'too-large' | 'not-json-object' };
}
export function createSettingsService(deps: Readonly<{ clock: Clock; profiles: ProfileRepository }>): SettingsService;
```

- `write` validates: byte length ≤ `SETTINGS_MAX_BYTES` (else `too-large`); `JSON.parse` succeeds AND the result is a non-array object (else `not-json-object`) — the server does **not** deep-validate the presentation schema (client-owned). On success, `profiles.updateSettings`. `read` returns the stored blob or the empty marker.

- [ ] RED: `read` on an unset profile returns `{settingsJson:null, settingsVersion:0}`; `write` a valid `{"theme":"high-contrast"}` blob round-trips through `read`; a blob over `SETTINGS_MAX_BYTES` → `{ok:false, reason:'too-large'}` and does NOT overwrite an existing blob; a `"just a string"` or `[1,2]` payload → `{ok:false, reason:'not-json-object'}`; a syntactically-invalid JSON string → `not-json-object`. Then implement → server suite + typecheck → commit `feat: add the profile settings service`.

---

### Task 8: Cookie/CSRF plugins and auth routes

**Files:**
- Create: `apps/server/src/routes/auth.ts`, `apps/server/test/routes/auth.test.ts`
- Modify: `apps/server/src/app.ts` (accept an optional `auth` bundle; register cookie/CSRF + auth routes), `apps/server/package.json` (add `@fastify/cookie`, `@fastify/csrf-protection`)

**Interfaces:**
- Consumes: all services (Tasks 5–7), `SessionService`, `AuthConfig`.
- Produces:

```ts
// A dependency bundle assembled by the caller (tests build it in-memory; Task 9 builds it in main.ts):
export interface AuthBundle {
  config: AuthConfig;
  login: LoginService;
  verify: VerifyService;
  session: SessionService;
  settings: SettingsService;      // used by Task 9's routes
  transport: MailTransport;       // for the dev-link endpoint (Task 9)
}
// app.ts:
export function buildApp(input: { pack: CompiledContentPack; webDistDir?: string; auth?: AuthBundle }): FastifyInstance;
// When `auth` is provided, buildApp registers @fastify/cookie (secret: config.cookieSecret) and
// @fastify/csrf-protection configured with getToken: (req) => req.headers['x-csrf-token'] (cookie
// double-submit; the `x-csrf-token` header name MUST match the client in Task 10), then registers
// registerAuthRoutes(app, auth).
export function registerAuthRoutes(app: FastifyInstance, auth: AuthBundle): void;
```

- Routes in this task: `POST /api/auth/login`, `GET /api/auth/verify`, `GET /api/auth/session`, `POST /api/auth/logout`.
- **Origin check helper**: a shared `assertOrigin(request, config.publicUrl)` used on `POST` routes — compares the `Origin` header (or `Referer` origin) to `publicUrl`'s origin; mismatch → 403. `GET /verify` is exempt (cross-origin from the mail client by design).
- **`POST /api/auth/login`**: origin-checked, no CSRF; `await auth.login.request({email: body.email, sourceAddress: request.ip})`; always `200 {ok:true}` (uniform); a thrown transport error is caught → still 200 (uniform), logged.
- **`GET /api/auth/verify?token`**: `auth.verify.verify({token})`; on null → 303 redirect to `${publicUrl}/?auth=failed`; on success → set the session cookie (`HttpOnly`, `Secure: config.cookieSecure`, `SameSite:'Lax'`, `Path:'/'`, `Max-Age: 30d`, signed) and 303 redirect to `${publicUrl}/?auth=ok`.
- **`GET /api/auth/session`**: read the signed session cookie; `auth.session.authenticate(token)`; null → 401 `{authenticated:false}`; else 200 `{authenticated:true, email}` and issue a CSRF token via `reply.generateCsrf()` returned in the body as `csrfToken` (double-submit; the cookie half is set by the plugin).
- **`POST /api/auth/logout`**: origin + CSRF (`app.csrfProtection` preHandler); `auth.session.revoke(cookieToken)`; clear the session cookie; `200 {ok:true}`.

- [ ] RED (app.inject with an in-memory DB + real services bundle): login returns identical `200 {ok:true}` for an email with and without a pre-existing profile; login from a wrong `Origin` → 403; verify with a valid token sets a `Set-Cookie` session cookie and 303s to `?auth=ok`, and a second verify of the same token 303s to `?auth=failed` with no cookie; session with no cookie → 401; session with a valid cookie → `{authenticated:true, email}` + a `csrfToken`; logout without a CSRF token → 403; logout with cookie+CSRF revokes (a subsequent session call → 401) and clears the cookie. Then implement (adding the two deps) → server suite + typecheck → commit `feat: add auth cookie, csrf, and routes`.

---

### Task 9: Profile/dev routes and server composition

**Files:**
- Create: `apps/server/src/routes/profile.ts`, `apps/server/src/auth/bundle.ts`, `apps/server/test/routes/profile.test.ts`
- Modify: `apps/server/src/app.ts` (register profile + dev routes when `auth` present), `apps/server/src/main.ts` (build the bundle), `apps/server/test/app.test.ts`

**Interfaces:**
- Consumes: `AuthBundle` (Task 8), all repositories/services, `openDatabase`.
- Produces:

```ts
// bundle.ts — assembles the AuthBundle from a DB + config (the composition root helper, reused by main.ts and tests):
export function createAuthBundle(input: Readonly<{ db: Database.Database; config: AuthConfig; fetchImpl?: typeof fetch }>): AuthBundle;
// wires: repositories(db) → transport(config) → login/verify/session/settings services with a real Clock ({now:()=>new Date()}),
//   generateToken/hashToken, and crypto.randomUUID.
// routes/profile.ts:
export function registerProfileRoutes(app: FastifyInstance, auth: AuthBundle): void;
```

- **`GET /api/profile/settings`**: session required; `auth.settings.read(profileId)` → `200 {settings: settingsJson, settingsVersion}` (settings is the raw JSON string or null).
- **`PUT /api/profile/settings`**: session + CSRF + origin; body `{settingsJson: string, settingsVersion: number}`; `auth.settings.write(...)`; on `too-large`/`not-json-object` → 400 with the reason; success → `200 {ok:true}`.
- **`GET /api/dev/last-login-link?email`**: registered **only when `config.mailgun===null`** (dev mode); returns `200 {link}` from `transport.lastLinkFor(normalizeEmail(email))` or `404` if none; when Mailgun is configured this route is never registered (→ 404 by the SPA fallback/notFound handler for a `/api/` path).
- **main.ts**: after `openDatabase`, build `const auth = createAuthBundle({db: database, config: config.auth})`, and pass `auth` into `buildServer: (pack) => buildApp({pack, webDistDir: config.webDistDir, auth})`. `runServerStartup`/`ShutdownDatabase` are unchanged (the same `database` still flows to lifecycle; better-sqlite3 satisfies `{pragma, close}`).

- [ ] RED: profile settings GET/PUT require a session (401 without) and CSRF (403 without) and reject a cross-origin PUT (403); a PUT then GET round-trips the blob for the authenticated profile; an oversized PUT → 400 `too-large`; the dev-link endpoint returns the stored link in dev mode and is absent (404) when `config.mailgun` is set (build one app each way); `buildApp` with no `auth` bundle still serves `/api/health` + `/api/content/guest` unchanged (the existing app.test.ts stays green). Then implement → server suite + typecheck + `npm run smoke` (build server first) → commit `feat: wire profile routes and server composition`.

---

### Task 10: Client account module and API client

**Files:**
- Create: `apps/web/src/session/account.ts`, `apps/web/test/session/account.test.ts`
- Modify: `apps/web/src/api.ts`

**Interfaces:**
- Consumes: the auth routes (Tasks 8–9); relative-URL `fetch` seam (`api.ts` pattern).
- Produces (framework-free, injected `fetcher: typeof fetch = fetch`):

```ts
// api.ts additions:
export async function requestLogin(email: string, fetcher?: typeof fetch): Promise<void>; // POST /api/auth/login {email}; resolves on 200
export interface SessionInfo { authenticated: boolean; email?: string; csrfToken?: string }
export async function fetchSession(fetcher?: typeof fetch): Promise<SessionInfo>;          // GET /api/auth/session (401 → {authenticated:false})
export async function logout(csrfToken: string, fetcher?: typeof fetch): Promise<void>;    // POST /api/auth/logout, x-csrf-token header
export async function fetchProfileSettings(fetcher?: typeof fetch): Promise<{ settingsJson: string | null; settingsVersion: number }>;
export async function putProfileSettings(input: { settingsJson: string; settingsVersion: number; csrfToken: string }, fetcher?: typeof fetch): Promise<{ ok: boolean }>;
// account.ts — a tiny stateful helper the app owns:
export interface AccountState { status: 'guest' | 'signed-in'; email: string | null; csrfToken: string | null }
export const GUEST_ACCOUNT: AccountState;
export async function loadAccount(fetcher?: typeof fetch): Promise<AccountState>; // fetchSession → maps to AccountState
```

- All requests are same-origin relative URLs (`credentials:'same-origin'` so the session cookie rides along). The CSRF token from `fetchSession` is threaded into mutating calls via the `x-csrf-token` header (the `@fastify/csrf-protection` double-submit default header).

- [ ] RED (inject a `fetcher` double): `requestLogin` POSTs `{email}` to `/api/auth/login` and resolves on a 200; `fetchSession` maps a 401 to `{authenticated:false}` and a 200 to `{authenticated:true, email, csrfToken}`; `logout` sends the `x-csrf-token` header; `putProfileSettings` sends the header + body and maps non-200 to `{ok:false}`; `loadAccount` returns `GUEST_ACCOUNT` on a 401 and a signed-in state on a 200. Then implement → `npm run test --workspace @woven-deep/web` + typecheck → commit `feat: add the client account module`.

---

### Task 11: Title sign-in and signed-in identity

**Files:**
- Create: `apps/web/src/ui/screens/SignInScreen.tsx`, `apps/web/test/sign-in.test.tsx`
- Modify: `apps/web/src/App.tsx` (account state + boot load + a `signin` ScreenState), `apps/web/src/ui/screens/TitleScreen.tsx` (sign-in / signed-in options), `apps/web/test/` title tests

**Interfaces:**
- Consumes: Task 10's `loadAccount`/`requestLogin`/`logout`, `AccountState`.
- Produces:
  - `ScreenState` gains `| { screen: 'signin' }`.
  - App owns `const [account, setAccount] = useState<AccountState>(GUEST_ACCOUNT)`, loaded at boot via `loadAccount(fetcher)` in the existing boot effect (alongside the pack fetch; a `?auth=ok` query param triggers a re-fetch of the session). A test seam `accountOverride` mirrors `localStorageOverride`.
  - `TitleScreen` props gain `account`, `onSignIn`, `onSignOut`: when guest, an option "Sign in with email" → `onSignIn` (App sets `screen:'signin'`); when signed-in, the email is shown and an option "Sign out" → `onSignOut` (App `await logout(account.csrfToken)`, `setAccount(GUEST_ACCOUNT)`).
  - `SignInScreen`: an email input + submit; on submit `await requestLogin(email)`, then a uniform confirmation panel — "If that email can sign in, a link is on its way. Check your mail." — regardless of outcome; Esc/back returns to title. Keyboard-first, dialog/focus conventions.

- [ ] RED: TitleScreen shows "Sign in with email" when `account.status==='guest'` and the email + "Sign out" when signed-in (no sign-in option then); SignInScreen submit calls `requestLogin` with the typed email and then renders the uniform confirmation (assert the same confirmation text on both a resolved and a rejected `requestLogin` — no existence leak); `?auth=ok` at boot triggers a session fetch that flips the title to signed-in (inject `accountOverride`/`fetcher`); existing title tests stay green (the new options are additive/gated). Then implement → web suite + typecheck → commit `feat: add title sign-in and identity`.

---

### Task 12: Settings roaming

**Files:**
- Modify: `apps/web/src/App.tsx` (roam-on-sign-in + debounced push), `apps/web/src/session/settings.ts` (a `settingsToJson`/`settingsFromJson` pair if not already trivial), `apps/web/test/settings-roaming.test.tsx`

**Interfaces:**
- Consumes: Task 10 (`fetchProfileSettings`/`putProfileSettings`), Task 11 (`account`), the existing `Settings`/`loadSettings`/`saveSettings`/`handleSettingsChange`.
- Produces:
  - On the account transitioning to `signed-in` (boot or post-verify), the app runs a one-time roam: `fetchProfileSettings()` → if `settingsJson` non-null, parse it through the existing forward-tolerant `loadSettings`-style validation and adopt it (`setSettings` + write the localStorage cache); if null (empty server), seed the server with the current local settings via `putProfileSettings`.
  - `handleSettingsChange` keeps writing localStorage AND, when signed-in, debounce-pushes (≈500ms trailing) the serialized settings to `putProfileSettings` with `account.csrfToken`, incrementing `settingsVersion`.
  - On sign-out, no server writes occur; the localStorage cache is the source of truth (the guest path, unchanged).
  - Server settings are stored/validated opaquely (server side), so the client owns the shape end to end; a server blob that fails the client's own `loadSettings` validation falls back to defaults with the existing notice (reuse, don't reinvent).

- [ ] RED: signing in when the server holds `{"theme":"high-contrast"}` adopts high-contrast into the live settings and the localStorage cache (server-wins); signing in when the server is empty pushes the current local settings up (one `putProfileSettings` with the local blob); a settings change while signed-in triggers a debounced `putProfileSettings` (advance fake timers, assert one trailing call with the new blob + csrf) AND writes localStorage; a settings change while guest does NOT call the server; a corrupt server blob falls back to defaults via the existing loader path without crashing. Then implement → web suite + typecheck → commit `feat: roam settings across devices`.

---

### Task 13: Deploy config, docs, e2e, and the roadmap gate

**Files:**
- Modify: `Dockerfile` (runtime `ENV`), `compose.yaml` (`environment:`), `apps/server/src/config.ts` (already done in Task 3 — verify), `CLAUDE.md` (a server-auth note), `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`
- Create: `docs/server-admin/authentication.md`, `apps/web/e2e/auth.spec.ts`
- Modify: `docs/server-admin/README.md` (link the new doc)

**The auth e2e** (real server via the existing playwright webServer; hermetic via a unique email per run since the shared `data/e2e-guest.sqlite` persists across runs): generate `const email = \`e2e-${Date.now()}@example.test\`` (specs are not the deterministic engine — wall-clock is fine here) → open the app, choose "Sign in with email", submit the email, see the uniform confirmation → `GET /api/dev/last-login-link?email=<email>` (the dev transport is active because the e2e server runs with no Mailgun config) to retrieve the link → `page.goto(link)` → land back on the app with `?auth=ok`, title now shows the email → change a setting (e.g. theme to high-contrast) → open a fresh browser context carrying the session cookie (or reload) and confirm the theme came from the server → sign out, confirm the title returns to guest. Passes twice consecutively. The five existing specs stay green untouched.

- **Docs**: `docs/server-admin/authentication.md` documents the env vars (`PUBLIC_URL`, `COOKIE_SECRET`, `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`MAILGUN_SENDER`), the dev-echo behavior (no Mailgun → dev link endpoint), the magic-link flow, and the security properties (hashed tokens, cookie flags, CSRF, rate limits). `CLAUDE.md` gains a short "Server auth (6A)" note under the architecture section, preserving the "server is authoritative" line. Roadmap records 6A gate-green with links; 6B (server runs) noted next.

- [ ] Steps: write the e2e spec RED-first (assertions before the flow), then the full verification block: root `npm test`, typecheck, build, `content:validate`, `content:startup-gate`, `guest:e2e` (all six specs green twice), all five demos (zero drift — no engine/content changes: verify `git diff <base>..HEAD --stat -- packages/engine packages/content content` is empty), `smoke`. Confirm the Dockerfile/compose env additions build (`docker build` if the environment permits; otherwise a config-parse test proving `readConfig` accepts the production-shaped env and rejects the incomplete one — Task 3 already covers the parse, so here just confirm the ENV keys are present in both files). Commit `feat: prove sign-in and settings roaming end to end`, then the final whole-branch review per `superpowers:requesting-code-review`.
