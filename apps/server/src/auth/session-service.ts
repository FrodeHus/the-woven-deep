import type { ProfileRepository } from '../db/profile-repository.js';
import type { SessionRepository } from '../db/session-repository.js';
import type { Clock } from './rate-limiter.js';

const TOUCH_THRESHOLD_MS = 60_000;

export interface AuthenticatedProfile {
  profileId: string;
  email: string;
}

export interface SessionService {
  authenticate(sessionToken: string): AuthenticatedProfile | null;
  revoke(sessionToken: string): void;
}

export function createSessionService(
  deps: Readonly<{
    clock: Clock;
    sessions: SessionRepository;
    profiles: ProfileRepository;
    hashToken: (token: string) => string;
    sessionTtlMs: number;
  }>,
): SessionService {
  const { clock, sessions, profiles, hashToken, sessionTtlMs } = deps;

  return {
    authenticate(sessionToken) {
      const tokenHash = hashToken(sessionToken);
      const row = sessions.find(tokenHash);
      const now = clock.now();
      const nowIso = now.toISOString();

      if (!row || row.revokedAt !== null || row.expiresAt <= nowIso) {
        return null;
      }

      if (now.getTime() - new Date(row.lastSeenAt).getTime() > TOUCH_THRESHOLD_MS) {
        sessions.touch({
          tokenHash,
          lastSeenAt: nowIso,
          expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString(),
        });
      }

      const profile = profiles.findById(row.profileId);
      if (!profile) {
        return null;
      }

      return { profileId: row.profileId, email: profile.normalizedEmail };
    },

    revoke(sessionToken) {
      sessions.revoke({ tokenHash: hashToken(sessionToken), nowIso: clock.now().toISOString() });
    },
  };
}
