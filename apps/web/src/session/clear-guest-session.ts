import { SIGHTINGS_KEY } from './codex.js';
import { ONBOARDING_KEY } from './onboarding.js';
import { RECORDS_KEY } from './run-records-storage.js';
import { SETTINGS_KEY } from './settings.js';
import { COMMAND_SEQUENCE_KEY, PORTRAIT_KEY, SAVE_KEY, type SessionStorageLike } from './storage.js';

/**
 * Every `sessionStorage` key wiped by "clear guest session": the active run save, its
 * monotonic command-id counter, the Hall of Records, the confirmed portrait glyph, and (Task 8)
 * the unlock codex's sighting cache -- session-only, exactly like the rest of this list.
 */
export const GUEST_SESSION_STORAGE_KEYS: readonly string[] = [
  SAVE_KEY, COMMAND_SEQUENCE_KEY, RECORDS_KEY, PORTRAIT_KEY, SIGHTINGS_KEY,
];

/** The `localStorage` keys wiped alongside the above: the guest's settings and (Task 8) the
 * device-persistent onboarding mastery ledger. */
export const GUEST_LOCAL_STORAGE_KEYS: readonly string[] = [SETTINGS_KEY, ONBOARDING_KEY];

/**
 * Wipes every guest-session storage key, `sessionStorage` and `localStorage` alike -- the settings
 * overlay's "clear guest session" action. `remove` is optional on `SessionStorageLike` (see
 * `storage.ts`'s doc comment): both real browser-backed implementations
 * (`browserSessionStorage`/`browserLocalStorage`) provide it, which is all this module actually
 * depends on; a test double that omits it simply no-ops per key here, since nothing in this module
 * needs a return value to know whether the wipe "worked".
 */
export function clearGuestSession(storage: SessionStorageLike, localStorage: SessionStorageLike): void {
  for (const key of GUEST_SESSION_STORAGE_KEYS) storage.remove?.(key);
  for (const key of GUEST_LOCAL_STORAGE_KEYS) localStorage.remove?.(key);
}
