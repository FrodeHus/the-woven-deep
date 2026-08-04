import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

const cpuCount = availableParallelism();

export default defineConfig({
  test: {
    // CLI tests spawn the demo scripts in separate processes (each recompiles content),
    // and the seeded-invariant property test runs many simulations. Slower CI runners need
    // well above the 5s default; these limits keep them from false-failing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The `*cli.test.ts` suites (packages/engine/package.json's "test" script runs them as a
    // second, separate `vitest run` invocation) each spawn a subprocess that recompiles
    // content and replays a full demo. Keeping that CPU-bound tail in its own vitest process
    // stops it from monopolising the forks the rest of the suite needs.
    //
    // Forks stay capped below the core count: a long synchronous CPU-bound test starves
    // Vitest's worker-RPC heartbeat when every core is saturated, surfacing as "Timeout
    // calling onTaskUpdate". Leaving a core free keeps the reporter channel serviced.
    pool: 'forks',
    poolOptions: { forks: { maxForks: Math.max(1, cpuCount - 1), minForks: 1 } },
  },
});
