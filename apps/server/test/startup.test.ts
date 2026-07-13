import type { CompiledContentPack } from '@woven-deep/content';
import { describe, expect, it, vi } from 'vitest';
import type { ShutdownSignal } from '../src/lifecycle.js';
import { runServerStartup } from '../src/startup.js';

describe('runServerStartup', () => {
  it('does not persist content or create a server when terminated during compilation', async () => {
    const listeners = new Map<ShutdownSignal, () => Promise<void>>();
    const database = {
      pragma: vi.fn(),
      close: vi.fn(),
    };
    let finishCompilation!: (pack: CompiledContentPack) => void;
    const compilation = new Promise<CompiledContentPack>((resolve) => {
      finishCompilation = resolve;
    });
    const persistPack = vi.fn();
    const buildServer = vi.fn();

    const startup = runServerStartup({
      database,
      compilePack: () => compilation,
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
    finishCompilation({ schemaVersion: 1, hash: 'a'.repeat(64), entries: [] });
    await startup;

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
});
