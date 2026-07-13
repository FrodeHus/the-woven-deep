export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface ShutdownServer {
  close(): Promise<void>;
}

export interface ShutdownDatabase {
  pragma(source: string): unknown;
  close(): void;
}

export interface SignalRegistrar {
  once(signal: ShutdownSignal, listener: () => Promise<void>): unknown;
  off(signal: ShutdownSignal, listener: () => Promise<void>): unknown;
}

export interface ShutdownLifecycle {
  readonly signal: AbortSignal;
  attachServer(server: ShutdownServer): void;
  isShuttingDown(): boolean;
  shutdown(): Promise<void>;
}

export function registerShutdownHandlers(input: {
  database: ShutdownDatabase;
  signals: SignalRegistrar;
  onError(error: unknown): void;
}): ShutdownLifecycle {
  const shutdownController = new AbortController();
  let server: ShutdownServer | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const removeSignalListeners = (): void => {
    input.signals.off('SIGTERM', handleSignal);
    input.signals.off('SIGINT', handleSignal);
  };
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      shutdownController.abort();
      removeSignalListeners();
      try {
        await server?.close();
      } finally {
        try {
          input.database.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          input.database.close();
        }
      }
    })().catch((error: unknown) => {
      input.onError(error);
      throw error;
    });
    return shutdownPromise;
  };
  async function handleSignal(): Promise<void> {
    try {
      await shutdown();
    } catch {
      // shutdown reports its failure exactly once before rejecting callers
    }
  }

  input.signals.once('SIGTERM', handleSignal);
  input.signals.once('SIGINT', handleSignal);

  return {
    signal: shutdownController.signal,
    attachServer(value) {
      server = value;
    },
    isShuttingDown() {
      return shutdownPromise !== undefined;
    },
    shutdown,
  };
}
