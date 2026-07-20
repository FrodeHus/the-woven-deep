import type { AuthConfig } from '../config.js';
import type { LoginTokenRepository } from '../db/login-token-repository.js';
import type { Clock } from './rate-limiter.js';
import { RateLimiter } from './rate-limiter.js';
import type { MailTransport } from './mail-transport.js';
import { normalizeEmail } from './email.js';

const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface LoginService {
  request(input: Readonly<{ email: string; sourceAddress: string }>): Promise<void>;
}

export function createLoginService(
  deps: Readonly<{
    clock: Clock;
    tokens: LoginTokenRepository;
    transport: MailTransport;
    config: AuthConfig;
    generateToken: () => string;
    hashToken: (token: string) => string;
  }>,
): LoginService {
  const { clock, tokens, transport, config, generateToken, hashToken } = deps;
  const rateLimiter = new RateLimiter({ clock, windowMs: RATE_LIMIT_WINDOW_MS });

  return {
    async request(input) {
      const normalizedEmail = normalizeEmail(input.email);

      // Both checks always run and each records a hit on its own key, even when the other one
      // blocks. That over-counts slightly on the non-blocking key but is intentionally the more
      // conservative choice (a short-circuit would let the second key escape counting).
      const emailAllowed = rateLimiter.check(
        `email:${normalizedEmail}`,
        config.loginRateLimit.perEmailPerHour,
      );
      const sourceAllowed = rateLimiter.check(
        `src:${input.sourceAddress}`,
        config.loginRateLimit.perSourcePerHour,
      );

      if (!emailAllowed || !sourceAllowed) {
        return;
      }

      const now = clock.now();
      const token = generateToken();

      tokens.insert({
        tokenHash: hashToken(token),
        normalizedEmail,
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
        createdAt: now.toISOString(),
      });

      const link = `${config.publicUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

      try {
        await transport.sendLoginLink({ email: input.email, link });
      } catch {
        // A transport failure must not change the uniform response.
      }
    },
  };
}
