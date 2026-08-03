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

/** A no-op subscription for the sessionless case below -- module-level so its identity is stable
 * across renders and `useSyncExternalStore` never needlessly resubscribes. */
const NO_SESSION_SUBSCRIBE = (): (() => void) => () => {};
const NO_SESSION_SNAPSHOT = (): null => null;

/** `useRunSession` for a component that must stay MOUNTED whether or not a session exists yet
 * (see `UiProviders`' `SessionBridge`): with no session it subscribes to nothing and yields
 * `null`, without the component having to conditionally call a hook. */
export function useOptionalRunSession(session: RunSession | undefined): SessionSnapshot | null {
  return useSyncExternalStore(
    session ? (listener) => session.subscribe(listener) : NO_SESSION_SUBSCRIBE,
    session ? () => session.getSnapshot() : NO_SESSION_SNAPSHOT,
  );
}
