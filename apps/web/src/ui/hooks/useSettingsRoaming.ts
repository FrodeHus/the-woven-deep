import { useEffect, useRef } from 'react';
import { fetchProfileSettings, putProfileSettings } from '../../api.js';
import type { AccountState } from '../../session/account.js';
import { saveSettings, settingsFromJson, type Settings } from '../../session/settings.js';
import type { SessionStorageLike } from '../../session/storage.js';

export interface UseSettingsRoamingResult {
  /** Debounced push of a settings change to the server -- a no-op while `account.status` isn't
   * `'signed-in'`. Trailing debounce (~500ms): rapid-fire changes (e.g. dragging a font-scale
   * slider) collapse into one PUT carrying only the final value, each call resetting the timer. */
  readonly pushSettings: (next: Settings) => void;
}

/**
 * Settings roaming: the refs/version-counter/debounced-PUT/roam-on-sign-in machinery.
 * `settingsRef` mirrors `settings` for the roam effect's async
 * closure (which only re-fires on an account-status transition, so it cannot rely on the
 * render-time `settings` staying fresh by the time its network round-trip resolves).
 * `settingsVersionRef` is a monotonic counter this client increments on every push it makes (the
 * roam-seed PUT and every debounced PUT via `pushSettings`) -- the server's own copy is opaque to
 * us; we only need our own pushes to be strictly increasing so a stale in-flight write can never
 * race ahead of a newer one. `roamedForSessionRef` guards the one-time roam-on-sign-in so it fires
 * exactly once per sign-in (reset back to `false` when the account drops to guest, so a later
 * sign-in in the same tab roams again). `settingsPushTimerRef` holds the debounce timer
 * `pushSettings` resets on every call.
 *
 * The one-time "roam on sign-in" half fires exactly once per sign-in, whether the account arrived
 * already-signed-in at boot (a fresh page load after a magic-link redirect, or `accountOverride`
 * in tests) or flipped from guest to signed-in later. Server-wins on a non-empty profile: the
 * remote blob is validated through `settingsFromJson` -- the exact same forward-tolerant rules
 * `loadSettings` applies to a local read -- so a corrupt/partial server blob falls back to
 * `DEFAULT_SETTINGS` rather than crashing or corrupting the in-memory settings. An empty profile
 * (this player has never roamed before) seeds the server with whatever is currently in effect
 * locally. Best-effort: a network failure here (session lapsed, offline) is swallowed -- the
 * guest/local settings stay exactly as they were, and the next debounced push retries.
 */
export function useSettingsRoaming(
  account: AccountState,
  fetcher: typeof fetch,
  settings: Settings,
  localStorageInstance: SessionStorageLike,
  setSettings: (next: Settings) => void,
): UseSettingsRoamingResult {
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const settingsVersionRef = useRef(0);
  const roamedForSessionRef = useRef(false);
  const settingsPushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (settingsPushTimerRef.current !== undefined) clearTimeout(settingsPushTimerRef.current);
  }, []);

  function pushSettings(next: Settings): void {
    if (account.status !== 'signed-in') return;
    const csrfToken = account.csrfToken ?? '';
    if (settingsPushTimerRef.current !== undefined) clearTimeout(settingsPushTimerRef.current);
    settingsPushTimerRef.current = setTimeout(() => {
      const nextVersion = settingsVersionRef.current + 1;
      settingsVersionRef.current = nextVersion;
      void putProfileSettings({ settingsJson: JSON.stringify(next), settingsVersion: nextVersion, csrfToken }, fetcher);
    }, 500);
  }

  useEffect(() => {
    if (account.status !== 'signed-in') {
      roamedForSessionRef.current = false;
      return;
    }
    if (roamedForSessionRef.current) return;
    roamedForSessionRef.current = true;
    let cancelled = false;
    const csrfToken = account.csrfToken ?? '';
    void (async () => {
      try {
        const remote = await fetchProfileSettings(fetcher);
        if (cancelled) return;
        if (typeof remote.settingsJson === 'string') {
          const { settings: adopted } = settingsFromJson(remote.settingsJson);
          settingsVersionRef.current = remote.settingsVersion;
          saveSettings(localStorageInstance, adopted);
          setSettings(adopted);
        } else {
          const nextVersion = settingsVersionRef.current + 1;
          settingsVersionRef.current = nextVersion;
          await putProfileSettings(
            { settingsJson: JSON.stringify(settingsRef.current), settingsVersion: nextVersion, csrfToken },
            fetcher,
          );
        }
      } catch {
        // Best-effort: leave local settings untouched on a network/parsing hiccup.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settingsRef/localStorageInstance/refs are stable seams, not reactive deps
  }, [account.status, account.csrfToken, fetcher]);

  return { pushSettings };
}
