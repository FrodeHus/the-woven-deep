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
    // Forks are held to half the cores, not cores-1. The suite's long synchronous CPU-bound
    // tests block their worker for seconds at a time; if the forks saturate every core, the
    // main process cannot service the worker's `onTaskUpdate` RPC inside birpc's fixed
    // timeout (not configurable) and the run dies with `[vitest-worker]: Timeout calling
    // "onTaskUpdate"` — every test having passed. Halving leaves the reporter real headroom.
    // A two-core runner still resolves to a single fork, i.e. the old singleFork behaviour.
    pool: 'forks',
    poolOptions: { forks: { maxForks: Math.max(1, Math.floor(cpuCount / 2)), minForks: 1 } },
    // Same goal, second lever: the default reporter prints a line per slow test, and this
    // suite has hundreds. On CI that is main-process work competing with the same RPC. The
    // dot reporter still prints full failure detail and the summary.
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
