import type { CompiledContentPack } from '@woven-deep/content';
import { describe, expect, it, vi } from 'vitest';
import type { ShutdownSignal } from '../src/lifecycle.js';
import { runServerStartup } from '../src/startup.js';

describe('runServerStartup', () => {
  it('aborts compilation and settles without persisting or creating a server on termination', async () => {
    const listeners = new Map<ShutdownSignal, () => Promise<void>>();
    const database = {
      pragma: vi.fn(),
      close: vi.fn(),
    };
    let compilationSignal: AbortSignal | undefined;
    const persistPack = vi.fn();
    const buildServer = vi.fn();

    const startup = runServerStartup({
      database,
      compilePack: (signal) => {
        compilationSignal = signal;
        return new Promise<CompiledContentPack>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      persistPack,
      buildServer,
      listenOptions: { host: '127.0.0.1', port: 3100 },
      signals: {
        once(signal, listener) {
          listeners.set(signal, listener);
        },
        off(signal) {
          listeners.delete(signal);
        },
      },
      onShutdownError: vi.fn(),
    });

    await listeners.get('SIGTERM')!();
    await startup;

    expect(compilationSignal?.aborted).toBe(true);
    expect(database.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    expect(database.pragma).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(persistPack).not.toHaveBeenCalled();
    expect(buildServer).not.toHaveBeenCalled();
  });

  it('closes resources and removes signal listeners when bootstrap fails', async () => {
    const listeners = new Map<ShutdownSignal, () => Promise<void>>();
    const failure = new Error('invalid content');
    const database = {
      pragma: vi.fn(),
      close: vi.fn(),
    };

    await expect(
      runServerStartup({
        database,
        compilePack: () => Promise.reject(failure),
        persistPack: vi.fn(),
        buildServer: vi.fn(),
        listenOptions: { host: '127.0.0.1', port: 3100 },
        signals: {
          once(signal, listener) {
            listeners.set(signal, listener);
          },
          off(signal) {
            listeners.delete(signal);
          },
        },
        onShutdownError: vi.fn(),
      }),
    ).rejects.toBe(failure);

    expect(database.pragma).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('preserves startup and cleanup failures and reports the cleanup failure', async () => {
    const startupFailure = new Error('invalid content');
    const cleanupFailure = new Error('checkpoint failed');
    const onShutdownError = vi.fn();

    const startup = runServerStartup({
      database: {
        pragma: vi.fn(() => {
          throw cleanupFailure;
        }),
        close: vi.fn(),
      },
      compilePack: () => Promise.reject(startupFailure),
      persistPack: vi.fn(),
      buildServer: vi.fn(),
      listenOptions: { host: '127.0.0.1', port: 3100 },
      signals: {
        once: vi.fn(),
        off: vi.fn(),
      },
      onShutdownError,
    });

    let caught: unknown;
    try {
      await startup;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([startupFailure, cleanupFailure]);
    expect(onShutdownError).toHaveBeenCalledOnce();
    expect(onShutdownError).toHaveBeenCalledWith(cleanupFailure);
  });
});
