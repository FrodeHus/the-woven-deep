import { useSyncExternalStore } from 'react';
import type { GuestSession, SessionSnapshot } from './guest-session.js';

/** Subscribes a React component to a `GuestSession`'s snapshot. The only file that imports React. */
export function useGuestSession(session: GuestSession): SessionSnapshot {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
  );
}
