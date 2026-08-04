import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

const cpuCount = availableParallelism();

export default defineConfig({
  test: {
    // The seeded-invariant property tests run many simulations. Slower CI runners need well
    // above the 5s default; these limits keep them from false-failing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Forks are held to half the cores, not cores-1, for the reason spelled out in
    // packages/engine/vitest.config.ts: saturating every core starves the main process of the
    // CPU it needs to answer a worker's `onTaskUpdate` inside birpc's fixed timeout, failing
    // the run with every test passed. A two-core runner resolves to a single fork.
    pool: 'forks',
    poolOptions: { forks: { maxForks: Math.max(1, Math.floor(cpuCount / 2)), minForks: 1 } },
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
