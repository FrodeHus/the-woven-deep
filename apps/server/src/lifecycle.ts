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
  attachServer(server: ShutdownServer): void;
  isShuttingDown(): boolean;
  shutdown(): Promise<void>;
}

export function registerShutdownHandlers(input: {
  database: ShutdownDatabase;
  signals: SignalRegistrar;
  onError(error: unknown): void;
}): ShutdownLifecycle {
  let server: ShutdownServer | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const removeSignalListeners = (): void => {
    input.signals.off('SIGTERM', handleSignal);
    input.signals.off('SIGINT', handleSignal);
  };
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
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
    })();
    return shutdownPromise;
  };
  async function handleSignal(): Promise<void> {
    try {
      await shutdown();
    } catch (error) {
      input.onError(error);
    }
  }

  input.signals.once('SIGTERM', handleSignal);
  input.signals.once('SIGINT', handleSignal);

  return {
    attachServer(value) {
      server = value;
    },
    isShuttingDown() {
      return shutdownPromise !== undefined;
    },
    shutdown,
  };
}
