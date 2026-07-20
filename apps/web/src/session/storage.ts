/**
 * The narrow storage surface `GuestSession` depends on. Keyed like the browser's own
 * `sessionStorage` (rather than bound to one implicit key) so a single instance can hold both the
 * run save and the command-sequence counter beside it. Keeping it to two methods lets tests swap
 * in an in-memory fake without any DOM, and lets `GuestSession` stay framework- and
 * browser-API-free beyond this seam.
 */
export interface SessionStorageLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /**
   * Erases a key outright (distinct from `set(key, '')`, which would leave `get` returning `''`
   * rather than `null`). Optional: every consumer before "clear guest session" only ever needed
   * `get`/`set`, so the many existing in-memory test doubles across this suite are not required to
   * implement it -- both real browser-backed implementations below do, and that (plus this
   * module's own tests) is what "clear guest session" actually depends on.
   */
  remove?(key: string): void;
}

export const SAVE_KEY = 'woven-deep.guest-run';

/** Where the confirmed portrait glyph is persisted: client-only cosmetic side-state, never engine
 * data, saved at chargen confirm and read back on Continue. Lives here (not `App.tsx`, which
 * re-exports it for its pre-existing consumers) so the framework-free `clear-guest-session.ts`
 * module can list it as a wipe target without importing the React entry point. */
export const PORTRAIT_KEY = 'woven-deep.guest-portrait';

/**
 * Persists `GuestSession`'s monotonic command-id counter, kept separate from the run save so it
 * survives independently of whether a given dispatch actually changed (and re-persisted) the run
 * itself — see `GuestSession.nextCommandId`.
 */
export const COMMAND_SEQUENCE_KEY = 'woven-deep.guest-command-seq';

/** Why a persistence attempt (or the storage backend itself) could not be used. */
export type StorageFailure = 'unavailable' | 'full';

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
  );
}

/**
 * Classifies a thrown storage error as either a quota failure (the save is too big, or the
 * browser's storage is full) or a general unavailability failure (private browsing, disabled
 * storage, security restrictions, etc). Exported so `GuestSession` can classify failures raised
 * by any `SessionStorageLike`, not only the browser-backed one below.
 */
export function classifyStorageFailure(error: unknown): StorageFailure {
  return isQuotaExceeded(error) ? 'full' : 'unavailable';
}

/**
 * Wraps `window.sessionStorage` behind `SessionStorageLike`. Reads fail soft (treated as "no
 * save") since a read failure and an absent save look identical to callers; writes propagate
 * their error so `GuestSession` can classify and surface it as a notice.
 */
export function browserSessionStorage(): SessionStorageLike {
  return {
    get(key: string): string | null {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      window.sessionStorage.setItem(key, value);
    },
    remove(key: string): void {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Best-effort, same fail-soft posture as `get` -- a wipe that can't reach storage (private
        // browsing, disabled storage) leaves nothing to clear anyway.
      }
    },
  };
}

/**
 * Wraps `window.localStorage` behind `SessionStorageLike`, for state that must outlive the tab
 * session (settings: `woven-deep.settings.v1`). Same fail-soft-read / propagate-write contract as
 * `browserSessionStorage` above.
 */
export function browserLocalStorage(): SessionStorageLike {
  return {
    get(key: string): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      window.localStorage.setItem(key, value);
    },
    remove(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Best-effort, same fail-soft posture as `get`/`browserSessionStorage.remove` above.
      }
    },
  };
}
