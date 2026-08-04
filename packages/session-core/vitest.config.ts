import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

const cpuCount = availableParallelism();

export default defineConfig({
  test: {
    // The seeded-invariant property tests run many simulations. Slower CI runners need well
    // above the 5s default; these limits keep them from false-failing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Forks stay capped below the core count: a long synchronous CPU-bound test starves
    // Vitest's worker-RPC heartbeat when every core is saturated, surfacing as "Timeout
    // calling onTaskUpdate". Leaving a core free keeps the reporter channel serviced.
    pool: 'forks',
    poolOptions: { forks: { maxForks: Math.max(1, cpuCount - 1), minForks: 1 } },
  },
});
