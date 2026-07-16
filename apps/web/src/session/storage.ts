/**
 * The narrow storage surface `GuestSession` depends on. Keeping it to two methods lets tests
 * swap in an in-memory fake without any DOM, and lets `GuestSession` stay framework- and
 * browser-API-free beyond this seam.
 */
export interface SessionStorageLike {
  get(): string | null;
  set(value: string): void;
}

export const SAVE_KEY = 'woven-deep.guest-run';

/** Why a persistence attempt (or the storage backend itself) could not be used. */
export type StorageFailure = 'unavailable' | 'full';

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014);
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
    get(): string | null {
      try {
        return window.sessionStorage.getItem(SAVE_KEY);
      } catch {
        return null;
      }
    },
    set(value: string): void {
      window.sessionStorage.setItem(SAVE_KEY, value);
    },
  };
}
