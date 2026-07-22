import { describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry } from '../../src/play/connection-registry.js';
import type { PlaySocket } from '../../src/play/play-socket.js';
import type { ServerPlaySession } from '../../src/play/play-session.js';

function fakeSocket(): PlaySocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
}

function fakeSession(): ServerPlaySession {
  return {} as ServerPlaySession;
}

describe('ConnectionRegistry', () => {
  it('registers a first connection without evicting anything', () => {
    const registry = new ConnectionRegistry();
    const socket = fakeSocket();
    const session = fakeSession();

    registry.register('profile-1', socket, session);

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    expect(registry.get('profile-1')).toEqual({ socket, session });
  });

  it('evicts the previous connection when a second one registers for the same profile', () => {
    const registry = new ConnectionRegistry();
    const firstSocket = fakeSocket();
    const secondSocket = fakeSocket();
    const firstSession = fakeSession();
    const secondSession = fakeSession();

    registry.register('profile-1', firstSocket, firstSession);
    registry.register('profile-1', secondSocket, secondSession);

    expect(firstSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'superseded' }));
    expect(firstSocket.close).toHaveBeenCalledWith(1000, 'superseded');
    expect(secondSocket.send).not.toHaveBeenCalled();
    expect(secondSocket.close).not.toHaveBeenCalled();
    expect(registry.get('profile-1')).toEqual({ socket: secondSocket, session: secondSession });
  });

  it('does not evict connections for a different profile', () => {
    const registry = new ConnectionRegistry();
    const socketA = fakeSocket();
    const socketB = fakeSocket();

    registry.register('profile-a', socketA, fakeSession());
    registry.register('profile-b', socketB, fakeSession());

    expect(socketA.send).not.toHaveBeenCalled();
    expect(socketA.close).not.toHaveBeenCalled();
    expect(registry.get('profile-a')?.socket).toBe(socketA);
    expect(registry.get('profile-b')?.socket).toBe(socketB);
  });

  it('unregister removes the entry when the socket matches the one currently stored', () => {
    const registry = new ConnectionRegistry();
    const socket = fakeSocket();

    registry.register('profile-1', socket, fakeSession());
    registry.unregister('profile-1', socket);

    expect(registry.get('profile-1')).toBeUndefined();
  });

  it('unregister is identity-guarded: a superseded socket cannot evict its successor', () => {
    const registry = new ConnectionRegistry();
    const firstSocket = fakeSocket();
    const secondSocket = fakeSocket();
    const secondSession = fakeSession();

    registry.register('profile-1', firstSocket, fakeSession());
    registry.register('profile-1', secondSocket, secondSession);

    // The evicted first socket's own (later) close handler fires and calls unregister with its
    // own (stale) socket identity — this must be a no-op, leaving the second connection intact.
    registry.unregister('profile-1', firstSocket);

    expect(registry.get('profile-1')).toEqual({ socket: secondSocket, session: secondSession });
  });

  it('unregister on an unknown profile is a no-op', () => {
    const registry = new ConnectionRegistry();
    expect(() => registry.unregister('unknown-profile', fakeSocket())).not.toThrow();
  });
});
