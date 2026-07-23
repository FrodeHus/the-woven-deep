import { fetchSession } from '../api.js';

export interface AccountState {
  status: 'guest' | 'signed-in';
  email: string | null;
  csrfToken: string | null;
  readonly unlockedClassIds: readonly string[];
}

export const GUEST_ACCOUNT: AccountState = {
  status: 'guest',
  email: null,
  csrfToken: null,
  unlockedClassIds: [],
};

export async function loadAccount(fetcher: typeof fetch = fetch): Promise<AccountState> {
  const info = await fetchSession(fetcher);
  if (!info.authenticated) return GUEST_ACCOUNT;
  return {
    status: 'signed-in',
    email: info.email ?? null,
    csrfToken: info.csrfToken ?? null,
    unlockedClassIds: info.unlockedClassIds ?? [],
  };
}
