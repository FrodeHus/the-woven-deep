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

    registerShutdownHandlers({
      server,
      database,
      signals: {
        once(signal, listener) {
          listeners.set(signal, listener);
        },
      },
      onError: vi.fn(),
    });

    expect([...listeners.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    await Promise.all([listeners.get('SIGTERM')!(), listeners.get('SIGINT')!()]);
    expect(events).toEqual(['server', 'checkpoint', 'database']);
    expect(database.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    expect(server.close).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });
});
