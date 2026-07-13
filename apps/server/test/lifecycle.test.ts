import { describe, expect, it, vi } from 'vitest';
import { registerShutdownHandlers, type ShutdownSignal } from '../src/lifecycle.js';

describe('registerShutdownHandlers', () => {
  it('closes the server before the database exactly once across termination signals', async () => {
    const listeners = new Map<ShutdownSignal, () => Promise<void>>();
    const events: string[] = [];
    const server = {
      close: vi.fn(async () => {
        events.push('server');
      }),
    };
    const database = {
      pragma: vi.fn(() => {
        events.push('checkpoint');
      }),
      close: vi.fn(() => {
        events.push('database');
      }),
    };

    const lifecycle = registerShutdownHandlers({
      database,
      signals: {
        once(signal, listener) {
          listeners.set(signal, listener);
        },
        off(signal) {
          listeners.delete(signal);
        },
      },
      onError: vi.fn(),
    });
    lifecycle.attachServer(server);

    expect([...listeners.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    const terminate = listeners.get('SIGTERM')!;
    const interrupt = listeners.get('SIGINT')!;
    await Promise.all([terminate(), interrupt()]);
    expect(events).toEqual(['server', 'checkpoint', 'database']);
    expect(database.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    expect(server.close).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('checkpoints and closes exactly once before a server is attached', async () => {
    const listeners = new Map<ShutdownSignal, () => Promise<void>>();
    const database = {
      pragma: vi.fn(),
      close: vi.fn(),
    };
    const lifecycle = registerShutdownHandlers({
      database,
      signals: {
        once(signal, listener) {
          listeners.set(signal, listener);
        },
        off(signal) {
          listeners.delete(signal);
        },
      },
      onError: vi.fn(),
    });

    const terminate = listeners.get('SIGTERM')!;
    await Promise.all([terminate(), lifecycle.shutdown()]);

    expect(lifecycle.isShuttingDown()).toBe(true);
    expect(database.pragma).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
