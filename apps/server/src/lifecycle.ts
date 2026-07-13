export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

interface ShutdownServer {
  close(): Promise<void>;
}

interface ShutdownDatabase {
  pragma(source: string): unknown;
  close(): void;
}

interface SignalRegistrar {
  once(signal: ShutdownSignal, listener: () => Promise<void>): unknown;
}

export function registerShutdownHandlers(input: {
  server: ShutdownServer;
  database: ShutdownDatabase;
  signals: SignalRegistrar;
  onError(error: unknown): void;
}): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      try {
        await input.server.close();
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
  const handleSignal = async (): Promise<void> => {
    try {
      await shutdown();
    } catch (error) {
      input.onError(error);
    }
  };

  input.signals.once('SIGTERM', handleSignal);
  input.signals.once('SIGINT', handleSignal);
  return shutdown;
}
