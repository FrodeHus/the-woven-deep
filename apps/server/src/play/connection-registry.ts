import type { PlaySocket } from './play-socket.js';
import type { ServerPlaySession } from './play-session.js';

interface Entry {
  readonly socket: PlaySocket;
  readonly session: ServerPlaySession;
}

/**
 * Enforces "newest-wins": at most one live `/ws/play` connection per profile. A second connection
 * for a profile that already has one evicts the first — the old socket is told `superseded` and
 * closed (cleanly, not as an error) before the new one is stored. There is no async gap between
 * eviction and registration (both happen synchronously inside {@link register}), so a run is never
 * held by two connections at once.
 *
 * `unregister` is identity-guarded: it only removes the registry entry if the socket passed in is
 * the one currently stored for that profile. This matters because the evicted (superseded) socket
 * still fires its own `close` handler after being closed — without the guard, that stale `close`
 * would remove the NEW connection's entry (registered synchronously before the old socket's close
 * event even fires), evicting the winner by accident.
 */
export class ConnectionRegistry {
  private readonly entries = new Map<string, Entry>();

  /** Registers `socket`/`session` as the live connection for `profileId`, evicting (via
   * `superseded` + close) whatever connection was previously registered for it, if any. */
  register(profileId: string, socket: PlaySocket, session: ServerPlaySession): void {
    const existing = this.entries.get(profileId);
    if (existing !== undefined) {
      existing.socket.send(JSON.stringify({ type: 'superseded' }));
      existing.socket.close(1000, 'superseded');
    }
    this.entries.set(profileId, { socket, session });
  }

  /** Removes the registry entry for `profileId`, but only if `socket` is the one currently
   * registered — a superseded socket's own (later) close must never evict its successor. */
  unregister(profileId: string, socket: PlaySocket): void {
    const existing = this.entries.get(profileId);
    if (existing !== undefined && existing.socket === socket) {
      this.entries.delete(profileId);
    }
  }

  /** The currently-registered entry for `profileId`, if the profile has a live connection. */
  get(profileId: string): Entry | undefined {
    return this.entries.get(profileId);
  }
}
