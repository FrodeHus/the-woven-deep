import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // CLI tests spawn the demo scripts in separate processes (each recompiles content),
    // and the seeded-invariant property test runs many simulations. Slower CI runners need
    // well above the 5s default; these limits keep them from false-failing.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // A single long CPU-bound test starves Vitest's worker-RPC heartbeat when several forks
    // contend for a shared 2-core runner, surfacing as "Timeout calling onTaskUpdate". One
    // fork keeps a single reporter channel that always services the heartbeat. This reduces
    // but does not fully eliminate the flake under runner load, so the `test` script adds a
    // CI-only whole-suite retry as the backstop (a real failure is deterministic and stays
    // red across both attempts; only the nondeterministic worker crash is cleared).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
