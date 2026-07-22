import { useSyncExternalStore } from 'react';
import type { SessionSnapshot } from './guest-session.js';
import type { RunSession } from './run-session.js';

/** Subscribes a React component to a `RunSession`'s snapshot -- works identically for a local
 * `GuestSession` or a WebSocket-backed `ProfileSession`, since both publish through the same
 * `subscribe`/`getSnapshot` seam. The only file that imports React. */
export function useRunSession(session: RunSession): SessionSnapshot {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
  );
}
