import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthConfig } from '../config.js';
import type { AuthBundle } from '../routes/auth.js';
import { LoginTokenRepository } from '../db/login-token-repository.js';
import { ProfileRepository } from '../db/profile-repository.js';
import { SessionRepository } from '../db/session-repository.js';
import type { Clock } from './rate-limiter.js';
import { createLoginService } from './login-service.js';
import { createVerifyService } from './verify-service.js';
import { createSessionService } from './session-service.js';
import { createSettingsService } from './settings-service.js';
import { createMailTransport } from './mail-transport.js';
import { generateToken, hashToken } from './tokens.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const realClock: Clock = { now: () => new Date() };

/**
 * Composition root helper: wires repositories(db) -> transport(config) -> the four auth
 * services into a single `AuthBundle`. Reused by `main.ts` (the real server boot) and by
 * route tests that want a fully-wired bundle without duplicating the plumbing.
 */
export function createAuthBundle(
  input: Readonly<{ db: Database.Database; config: AuthConfig; fetchImpl?: typeof fetch }>,
): AuthBundle {
  const { db, config, fetchImpl } = input;

  const tokens = new LoginTokenRepository(db);
  const profiles = new ProfileRepository(db);
  const sessions = new SessionRepository(db);
  const transport = createMailTransport(config, fetchImpl);

  const login = createLoginService({
    clock: realClock,
    tokens,
    transport,
    config,
    generateToken,
    hashToken,
  });
  const verify = createVerifyService({
    clock: realClock,
    tokens,
    profiles,
    sessions,
    generateToken,
    hashToken,
    newId: () => randomUUID(),
    transaction: (fn) => db.transaction(fn)(),
  });
  const session = createSessionService({
    clock: realClock,
    sessions,
    profiles,
    hashToken,
    sessionTtlMs: SESSION_TTL_MS,
  });
  const settings = createSettingsService({ clock: realClock, profiles });

  return { config, login, verify, session, settings, transport };
}
