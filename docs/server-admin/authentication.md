# Authentication and settings roaming (6A)

Email magic-link sign-in gives a player a server-side profile whose settings roam across devices.
There are no passwords. This guide covers the operator-owned configuration, the sign-in flow, the
dev-mode echo endpoint, and the security properties the server enforces.

Guest play is unaffected by any of this: an unauthenticated visitor keeps the full local-storage
guest experience. Signing in only adds a durable profile and cross-device settings roaming.

## Environment variables

The server reads these at startup (`apps/server/src/config.ts`). An empty string is treated as
unset, so a deploy manifest may declare them as blank placeholders and let the host env fill them in.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PUBLIC_URL` | **Yes in production** | `http://localhost:3000` (dev only) | The public origin. Magic links and post-verify redirects are built from it, and the login route's origin check compares against it. Its scheme decides the `Secure` cookie flag (`https` → secure). |
| `COOKIE_SECRET` | **Yes in production** | a public dev-only secret | Signs the session cookie. Must be at least 32 characters. Generate a random value (e.g. `openssl rand -hex 32`) and keep it out of source control. |
| `MAILGUN_API_KEY` | **Yes in production** | unset | Mailgun API key used to send login links. |
| `MAILGUN_DOMAIN` | **Yes in production** | unset | Mailgun sending domain. |
| `MAILGUN_SENDER` | **Yes in production** | unset | `From` address for login-link mail. |
| `LOGIN_RATE_LIMIT_PER_EMAIL_PER_HOUR` | No | `5` | Max login requests accepted per normalized email per hour. |
| `LOGIN_RATE_LIMIT_PER_SOURCE_PER_HOUR` | No | `20` | Max login requests accepted per source address per hour. |

The three `MAILGUN_*` keys are all-or-nothing: set all three or none. Setting only some is a
fail-fast configuration error.

### `PUBLIC_URL` is mandatory in production

The Dockerfile sets `NODE_ENV=production`. When `NODE_ENV=production`, the server **refuses to boot**
unless `PUBLIC_URL` is set to an explicit, non-localhost URL. This is deliberate: without the guard,
a production container with no `PUBLIC_URL` would silently fall back to the localhost dev default,
which in turn selects the public dev cookie secret and the in-memory dev-echo mail transport — a
deployment that appears healthy while signing sessions with a known secret and never actually mailing
anyone. The guard turns that silent misconfiguration into a loud startup failure.

In production, therefore, supply `PUBLIC_URL`, `COOKIE_SECRET`, and all three `MAILGUN_*` values. The
deploy manifests (`Dockerfile`, `compose.yaml`) declare them as overridable placeholders; provide the
real values through the host environment (`docker run -e …`, a compose `.env`, or your orchestrator's
secret store). Never bake real secrets into the image.

## The magic-link flow

1. The player enters an email on the sign-in screen. The client `POST`s `/api/auth/login`.
2. The server issues a uniform confirmation regardless of whether the email maps to a profile — the
   response never reveals whether an account exists.
3. If the email is allowed to sign in, the server mints a 256-bit single-use token, stores only its
   SHA-256 hash with a 15-minute expiry, and emails a link of the form
   `PUBLIC_URL/api/auth/verify?token=…`.
4. The player opens the link. `GET /api/auth/verify` looks up the token by hash, and on success sets
   the session cookie and redirects to `PUBLIC_URL/?auth=ok` (a failed or expired token redirects to
   `?auth=failed`). The token is consumed — it cannot be reused.
5. The now-authenticated client loads the profile and roams settings: the server copy wins when it
   already holds settings; an empty profile is seeded from whatever the client currently has.

## Dev mode: the echo endpoint

When **no** Mailgun configuration is present (the localhost default), the server uses a dev-echo mail
transport instead of Mailgun: it records the most recent login link per normalized email in memory
and exposes `GET /api/dev/last-login-link?email=<email>`, which returns `{ "link": "…" }` (or `404`
when there is no link for that email). This lets local development and the end-to-end auth spec drive
the full sign-in loop without sending real email. The endpoint is **only registered when Mailgun is
unconfigured**, so it never exists in a correctly configured production deployment.

## Security properties

- **Uniform login responses.** `/api/auth/login` returns the same confirmation whether or not the
  email exists, so the endpoint is not an account-existence oracle. The client's confirmation copy is
  likewise invariant.
- **Tokens stored only as hashes.** Both magic-link tokens and session tokens are 256-bit random
  values persisted only as SHA-256 hashes; the plaintext exists only in the emailed link / the
  cookie. A presented token is looked up by its hash via a keyed SQL query (not compared byte-by-byte
  against a stored value), so guessing a valid token requires defeating SHA-256 pre-image resistance,
  not winning a timing race.
- **Single-use, short-lived links.** Magic-link tokens expire after 15 minutes and are consumed on
  first successful verification.
- **Session cookie flags.** The session cookie is `HttpOnly`, `SameSite=Lax`, signed with
  `COOKIE_SECRET`, and `Secure` whenever `PUBLIC_URL` uses `https`. Sessions are revocable and expire
  after 30 days of inactivity.
- **Origin + CSRF.** `POST /api/auth/login` is checked against the `PUBLIC_URL` origin (it carries no
  CSRF token because it is pre-session and email-initiated). `GET /api/auth/verify` is the magic-link
  target, where the single-use high-entropy token is itself the credential. Every other authenticated
  state-changing request (sign-out, settings writes) requires both a valid session and a CSRF token.
- **Rate limiting.** Login requests are throttled per normalized email and per source address using
  the two `LOGIN_RATE_LIMIT_*` values above.
- **No secrets in the browser.** `PUBLIC_URL`, `COOKIE_SECRET`, and the `MAILGUN_*` values are
  server-only and never enter the web bundle.
