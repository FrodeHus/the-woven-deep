import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { GUEST_ACCOUNT, loadAccount, type AccountState } from '../../session/account.js';

export interface UseAccountResult {
  readonly account: AccountState;
  readonly setAccount: Dispatch<SetStateAction<AccountState>>;
}

/** Owns the boot-time account/session fetch: `GUEST_ACCOUNT` until (and unless) a session cookie
 * proves otherwise. `accountOverride` is the test-only seam that skips the network fetch entirely, seeding
 * state directly. `setAccount` is exposed so callers can flip the account themselves (e.g. on
 * sign-out). */
export function useAccount(fetcher: typeof fetch, accountOverride?: AccountState): UseAccountResult {
  const [account, setAccount] = useState<AccountState>(accountOverride ?? GUEST_ACCOUNT);
  useEffect(() => {
    if (accountOverride) return;
    let cancelled = false;
    void loadAccount(fetcher).then(
      (loaded) => {
        if (!cancelled) setAccount(loaded);
      },
      () => {
        if (!cancelled) setAccount(GUEST_ACCOUNT);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, accountOverride]);

  return { account, setAccount };
}
