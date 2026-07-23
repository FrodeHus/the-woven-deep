import { emptyRunMetrics, type AchievementGrant, type LifetimeState } from '@woven-deep/engine';
import { fetchSession } from '../api.js';

/** The zeroed `LifetimeState` a guest (or a signed-in profile with no `hall_state` row yet) sees --
 * matches exactly what the server sends for that same profile (`EMPTY_LIFETIME` in
 * `apps/server/src/routes/auth.ts`), so the two never drift. */
const EMPTY_LIFETIME: LifetimeState = {
  conqueredChampionRecordIds: [],
  grantedAchievementIds: [],
  discoveryProtection: [],
  totals: emptyRunMetrics(),
};

export interface AccountState {
  status: 'guest' | 'signed-in';
  email: string | null;
  csrfToken: string | null;
  readonly unlockedClassIds: readonly string[];
  /** The profile's server-persisted lifetime totals -- always the zeroed `EMPTY_LIFETIME` for a
   * guest (there is no profile to have any). */
  readonly lifetime: LifetimeState;
  /** The profile's server-persisted granted achievements -- always empty for a guest. */
  readonly achievements: readonly AchievementGrant[];
}

export const GUEST_ACCOUNT: AccountState = {
  status: 'guest',
  email: null,
  csrfToken: null,
  unlockedClassIds: [],
  lifetime: EMPTY_LIFETIME,
  achievements: [],
};

export async function loadAccount(fetcher: typeof fetch = fetch): Promise<AccountState> {
  const info = await fetchSession(fetcher);
  if (!info.authenticated) return GUEST_ACCOUNT;
  return {
    status: 'signed-in',
    email: info.email ?? null,
    csrfToken: info.csrfToken ?? null,
    unlockedClassIds: info.unlockedClassIds ?? [],
    lifetime: info.lifetime ?? EMPTY_LIFETIME,
    achievements: info.achievements ?? [],
  };
}
