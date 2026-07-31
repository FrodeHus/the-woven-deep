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
    // fork keeps a single reporter channel that always services the heartbeat.
    //
    // The `*cli.test.ts` suites (packages/engine/package.json's "test" script runs them as a
    // second, separate `vitest run` invocation) each spawn a subprocess that recompiles
    // content and replays a full demo — a CPU-bound tail that, packed into the same single
    // fork as the rest of the 133-file suite, still starves the heartbeat on a 2-core CI
    // runner even with singleFork. Splitting them into their own vitest process gives that
    // tail a fresh fork and heartbeat channel. Keep singleFork in both processes.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
