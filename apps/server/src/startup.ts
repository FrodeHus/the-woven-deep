import type { CompiledContentPack } from '@woven-deep/content';
import {
  registerShutdownHandlers,
  type ShutdownDatabase,
  type ShutdownServer,
  type SignalRegistrar,
} from './lifecycle.js';

interface StartupServer extends ShutdownServer {
  listen(options: { host: string; port: number }): Promise<unknown>;
}

export async function runServerStartup(input: {
  database: ShutdownDatabase;
  compilePack(): Promise<CompiledContentPack>;
  persistPack(pack: CompiledContentPack): void;
  buildServer(pack: CompiledContentPack): StartupServer;
  listenOptions: { host: string; port: number };
  signals: SignalRegistrar;
  onShutdownError(error: unknown): void;
}): Promise<void> {
  const lifecycle = registerShutdownHandlers({
    database: input.database,
    signals: input.signals,
    onError: input.onShutdownError,
  });

  try {
    const pack = await input.compilePack();
    if (lifecycle.isShuttingDown()) return;

    input.persistPack(pack);
    const server = input.buildServer(pack);
    lifecycle.attachServer(server);
    await server.listen(input.listenOptions);
  } catch (error) {
    await lifecycle.shutdown();
    throw error;
  }
}
