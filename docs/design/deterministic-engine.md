# Deterministic Engine Core

**Status:** Shipped (foundation of every later milestone)

**Package:** `packages/engine` (`@woven-deep/engine`)

Every other design doc in this directory assumes this one. It's the browser-safe
contract that lets guest play (in the browser) and server-authoritative play (on the
server, from milestone 6B) run identical rules and produce byte-identical results from
the same seed and command sequence.

## The pure reducer

The engine's only public command-resolution entry point is:

```ts
export function resolveCommand(
  state: ActiveRun,
  command: GameCommand,
  { content }: { content: CompiledContentPack },
): CommandResolution;
```

`resolveCommand` never mutates its input, calls a clock, generates identifiers, performs
I/O, or reads ambient randomness. Every value that can influence a transition is present
in the state, the command, or the supplied compiled content pack (which must match the
run's saved content hash exactly — a mismatch is an internal invariant failure). Callers
can discard the returned state after an unexpected exception and retain the
last-known-good input.

The reducer is a thin orchestrator over focused pure modules (actor lookup, scheduler,
targeting, combat, effects, inventory, equipment, identification, survival, features,
rest, projection, schema validation), each with narrow inputs/outputs and no ambient
state.

### Resolution order and failure classes

1. Recent-command dedup: an identical `commandId` returns its recorded result unchanged.
2. A reused ID with different content: a typed command-identifier conflict.
3. `expectedRevision` mismatch: a typed stale-revision rejection.
4. Validate the action; if a required choice is missing, return `decision_required` with a
   typed public descriptor and no state/revision/time/RNG change.
5. Apply. An invalid action (wall, boundary, illegal target) emits an explanatory event,
   records the result for idempotency, and advances neither turn nor revision. A valid
   action advances both by one.

Four failure classes stay distinct everywhere in the engine: **invalid player action**
(event + processed result, no turn/revision advance), **protocol rejection** (stale
revision / conflicting ID, no state change, no ring insertion), **decision required**
(typed public choices, no state change), and **internal invariant failure** (throws;
caller keeps the last-known-good state). The reducer never reinterprets an invariant
failure as a player mistake.

## Seeded random streams

The engine never calls `Math.random`. It implements `xoshiro128**` with four unsigned
32-bit state words (the all-zero state is invalid) and derives each named stream's
initial state from the run seed, a published per-stream discriminator, and a
`SplitMix32` expansion. Adding a random call to one stream cannot perturb another —
streams are isolated by construction, which is what makes it safe to add a new gameplay
system without disturbing e.g. combat replay. Stream state is part of every saved
snapshot.

Registered streams (grown over milestones, each reserved before its first consumer
shipped): `generation` (floor seeds), `encounters` (population placement),
`population-gates` (run-level appearance rolls), `combat`, `loot`, `effects`
(identification shuffles, damage effects), `merchant-stock` (NPC stock/lifetime/service
rolls), `run-records` (heirloom selection). The exact algorithm and stream discriminators
are save-format compatibility commitments, locked by published input/output test vectors.

## Versioned active-run state and save discipline

The active-run document is the complete authoritative snapshot: run/floor/hero identity,
RNG stream states, `worldTime`, every generated floor (tiles, actors, items, features,
knowledge bitsets — see `dungeon-generation-and-light.md`), and a bounded ring of the
last 128 processed command results (for idempotency, not full replay history). There is
no delta-replay model — visited floors are never regenerated from their seed, they're
loaded from the stored snapshot, because the design deliberately favors "simple complete
snapshots" over "smaller but fragile seed-and-delta."

`encodeActiveRun`/`decodeActiveRun` produce and consume stable, canonical JSON: sorted
object keys, semantic array order, only finite safe integers, no `undefined`/`NaN`/
sparse arrays/class instances. This is what makes split-replay tests meaningful:
continuous execution and execution interrupted by an encode/decode boundary must produce
byte-identical final state, events, and results.

### Schema evolution

The project was pre-release through several early schema replacements (v0 → v1 during
milestone 2's legacy migration proof, then straight replacements through v2, v3, v4 as
gameplay systems landed without production saves to preserve). Once a schema version was
used outside development, the project committed to explicit ordered migrations instead:
v4→v5 (currency/reputation, milestone 4B2), v5→v6 (metrics/conclusion, milestone 4B3),
v6→v7 (class/background/trait identity, milestone 5B), v7→v8 (house state, milestone 5C).
Each migration preserves every prior field byte-for-byte and re-validates through the
new decoder; the prior schema is frozen as a `legacyActiveRunVNSchema` for the migration
to target. Unsupported versions are rejected with a typed, safe (non-leaking) error.
Compiled content schema follows the same discipline in lockstep (currently v7).

This discipline — freeze the old schema, write one ordered migration function, prove it
byte-for-byte against a checked-in fixture — is what every future schema-bumping feature
in this codebase is expected to follow.

## Command-line replay demonstrations

Several `npm run *:demo` scripts (`engine:demo`, `dungeon:demo`, `gameplay:demo`,
`population:demo`, `merchant:demo`, `run-records:demo`) exist specifically to prove
determinism outside the test suite: each drives a scripted scenario through the engine
twice (continuously, and split across save/reload) and asserts byte-identical hashes for
final state, events, and results. They run in CI and the Docker build gate. This is the
project's answer to "how do we know a refactor didn't quietly break replay" — the demos
fail loudly rather than requiring someone to notice a subtle divergence in production.

## Compatibility commitments

Once published, command names, event names, identifier fields, schema-version semantics,
the PRNG algorithm and stream discriminators, stable serialization rules, and migration
behavior are stable interfaces. New engine features may add discriminated-union variants
and versioned state fields, but must preserve: the pure reducer boundary, complete-
snapshot persistence, browser/server engine equivalence, content-hash binding, hidden-
state ownership rules (see `content-pipeline.md` and the projection sections of the
gameplay docs), and deterministic output.
