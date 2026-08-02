import type { LoginTokenRepository } from '../db/login-token-repository.js';
import type { ProfileRepository, ProfileRow } from '../db/profile-repository.js';
import type { SessionRepository } from '../db/session-repository.js';
import type { Clock } from './rate-limiter.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface VerifyResult {
  sessionToken: string;
  profile: ProfileRow;
}

/** Why a token is not (or no longer) redeemable -- surfaced only in server logs, never to users. */
export type TokenState = 'valid' | 'expired' | 'consumed' | 'unknown';

export interface VerifyService {
  verify(input: Readonly<{ token: string }>): VerifyResult | null;
  /** Read-only redeemability check: never consumes, safe against link-scanner prefetches. */
  peek(input: Readonly<{ token: string }>): TokenState;
}

export function createVerifyService(
  deps: Readonly<{
    clock: Clock;
    tokens: LoginTokenRepository;
    profiles: ProfileRepository;
    sessions: SessionRepository;
    generateToken: () => string;
    hashToken: (token: string) => string;
    newId: () => string;
    transaction: <T>(fn: () => T) => T;
  }>,
): VerifyService {
  const { clock, tokens, profiles, sessions, generateToken, hashToken, newId, transaction } = deps;

  return {
    peek(input) {
      const row = tokens.find(hashToken(input.token));
      if (!row) {
        return 'unknown';
      }
      if (row.consumedAt !== null) {
        return 'consumed';
      }
      return row.expiresAt <= clock.now().toISOString() ? 'expired' : 'valid';
    },

    verify(input) {
      const hash = hashToken(input.token);
      const row = tokens.findUnconsumed(hash);
      const nowIso = clock.now().toISOString();

      if (!row || row.expiresAt <= nowIso) {
        return null;
      }

      return transaction(() => {
        const consumed = tokens.markConsumed({ tokenHash: hash, nowIso });
        if (!consumed) {
          return null;
        }

        const profile =
          profiles.findByEmail(row.normalizedEmail) ??
          profiles.create({ id: newId(), normalizedEmail: row.normalizedEmail, nowIso });

        const sessionToken = generateToken();
        sessions.insert({
          tokenHash: hashToken(sessionToken),
          profileId: profile.id,
          createdAt: nowIso,
          lastSeenAt: nowIso,
          expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS).toISOString(),
        });

        return { sessionToken, profile };
      });
    },
  };
}
