# Deterministic Engine Kernel and Save Format Design

**Status:** Approved for implementation

**Roadmap milestone:** 2 — deterministic engine kernel and save format

**Parent design:** `docs/superpowers/specs/2026-07-13-woven-deep-design.md`

## Goal

Build the browser-safe engine contract on which guest and server-authoritative play will share identical rules. The milestone proves that a hero can execute a narrow movement-only command sequence on a fixed floor, save and reload, and produce byte-identical serialized state and event output.

## Scope

This milestone includes:

- A framework-independent `@woven-deep/engine` workspace package.
- Immutable active-run state and a pure command reducer.
- Four-direction movement and waiting on a fixed test floor.
- Stable entity, run, floor, command, and event identifiers.
- Turn and revision sequencing.
- A bounded recent-command result ring for idempotency.
- Explicit named seeded-random streams with serializable state.
- A complete versioned active-run snapshot.
- Strict save validation, stable JSON serialization, and typed load failures.
- A real checked-in legacy save and deterministic `v0` to `v1` migration.
- Deterministic replay verification from an initial snapshot and external command sequence.
- A command-line demonstration of continuous execution versus save/reload execution.

## Non-goals

Combat, inventory, equipment, hunger, field of view, procedural generation, React integration, browser storage, SQLite run persistence, WebSockets, profiles, and authentication remain in later roadmap milestones. The fixed floor and hero are fixtures that exercise the engine and save contracts; they are not a temporary gameplay implementation to extend with ad hoc rules.

## Package boundary

Create `packages/engine` as an ESM TypeScript workspace named `@woven-deep/engine`. Production code in this package must not import React, Fastify, SQLite, browser storage, Node filesystem APIs, or Node cryptography. It may consume browser-safe exported content model types, but engine state binds to content through the content hash rather than retaining compiler or filesystem objects.

The project-wide dependency policy applies to this package. Zod supplies maintained runtime schema validation. The random-state and stable-JSON modules stay deliberately small and local because their exact behavior is part of the versioned replay/save contract; substituting a package with different state or permissive serialization behavior would change persisted data. Re-evaluate maintained libraries before adding broader algorithms in later milestones.

The package exposes focused modules for:

- Domain identifiers and version constants.
- Active-run, floor, hero, command, event, and result types.
- Seeded random streams.
- Command resolution.
- Save validation, migration, and stable serialization.
- Replay verification.
- Fixed CLI fixtures through a separate Node-only package entry or script that does not enter the browser engine bundle.

## Functional engine API

The central transition is pure:

```ts
export function resolveCommand(
  state: ActiveRun,
  command: GameCommand,
): CommandResolution;
```

`resolveCommand` does not mutate the supplied state, call the clock, generate identifiers, perform I/O, or access ambient randomness. Every value that can influence a transition is present in the state or command.

```ts
export interface CommandResolution {
  readonly state: ActiveRun;
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}
```

Callers can discard the returned state after an unexpected exception and retain the last-known-good input state.

## Versioned active-run state

The `v1` active-run document contains:

- `schemaVersion`: exactly `1`.
- `gameVersion`: the stable engine rules version.
- `contentHash`: a lowercase 64-character SHA-256 content-pack hash.
- `runId`: a stable opaque run identifier.
- `runSeed`: four unsigned 32-bit words.
- `rng`: the current state of every named random stream.
- `revision`: a non-negative safe integer.
- `turn`: a non-negative safe integer.
- `hero`: stable hero identifier, display name, and current floor and coordinates.
- `activeFloorId`: the floor occupied by the hero.
- `floors`: complete generated-floor snapshots in strictly increasing floor-identifier order using JavaScript UTF-16 relational comparison.
- `recentCommands`: up to 128 processed command records ordered oldest to newest.

The initial `gameVersion` is the exact string `0.1.0`. Opaque run, floor, entity, command, and event identifiers match `^[a-z0-9][a-z0-9._:-]{0,127}$`; generation of those identifiers belongs to callers, while the engine validates and compares them. Hero display names are separate presentation data: they contain 1–40 Unicode code points, are normalized to NFC before entering state, and contain no control characters.

Milestone floor snapshots contain a stable floor identifier, seed, generator version, width, height, depth, a numeric tile array in row-major order, and immutable entity-position records. The tile array length must equal `width * height`. The initial tile registry includes only wall and walkable floor values. Coordinates use integer `x` and `y` values with the origin at the upper-left.

The state shape deliberately anticipates multiple complete floor snapshots without implementing procedural generation. Later milestones extend versioned floor and entity data through migrations rather than replacing the active-run envelope.

## Commands, events, and sequencing

Commands use a stable discriminated union. The initial variants are:

```ts
type GameCommand =
  | MoveCommand
  | WaitCommand;

interface CommandEnvelope {
  readonly commandId: string;
  readonly expectedRevision: number;
}
```

Movement accepts only north, south, east, or west. Diagonal movement is not part of this milestone. Waiting consumes one turn without changing position.

Domain events also use stable discriminated unions. The initial event set records hero movement, waiting, and invalid-action explanations. Event payloads contain stable identifiers and values needed by deterministic consumers; they never contain wall-clock timestamps or localized presentation strings.

Resolution order is fixed:

1. Search the recent-command ring for `commandId`.
2. If an identical command was processed recently, return its recorded result and events with the current state unchanged.
3. If the identifier exists with different command content, return a typed command-identifier conflict with state unchanged.
4. Validate `expectedRevision` against the current revision. A mismatch returns a typed stale-revision rejection with state unchanged.
5. Validate the requested player action.
6. A wall, boundary, or otherwise invalid action emits an explanatory invalid-action event, records the processed result for idempotency, and advances neither turn nor revision.
7. A valid move or wait emits its domain event, advances both turn and revision by one, and records its result.

Protocol rejections at steps 3 and 4 are not recorded in the ring. Processed valid and invalid player actions are recorded. Adding a 129th record evicts the oldest. Reusing an evicted identifier is processed under the normal revision rules and will ordinarily be rejected as stale if it carries its original revision.

## Seeded random streams

The engine never calls `Math.random`. It implements `xoshiro128**` with four unsigned 32-bit state words and JavaScript bitwise operations whose unsigned normalization is explicit after every step. The all-zero state is invalid.

The run seed is four unsigned 32-bit words. Each stable `RngStreamName` has a published numeric discriminator. A stream's initial four-word state is derived from the run seed, its discriminator, and a fully specified `SplitMix32` expansion. If derivation produces the forbidden all-zero state, the final word is set to the documented non-zero fallback constant.

The initial registry reserves named streams for generation, encounters, combat, loot, effects, and narrative work even though the movement fixture consumes none. Stream state is stored in every active-run snapshot. Adding a random call to one stream therefore cannot perturb another subsystem.

Tests use published input/output vectors for the algorithm, stream derivation, state serialization, and stream isolation. The implementation algorithm and stream discriminators become save-format compatibility commitments.

## Save encoding and validation

The save boundary exposes:

```ts
export function encodeActiveRun(state: ActiveRun): string;
export function decodeActiveRun(json: string): ActiveRun;
export function migrateActiveRun(input: unknown): ActiveRun;
```

`encodeActiveRun` first validates invariants and then emits stable UTF-8-compatible JSON text. Object keys are sorted by Unicode code-unit order. Array order is semantic and retained. Values must be JSON-compatible; numbers must be finite safe integers, and unsupported or ambiguous values such as `undefined`, `NaN`, infinities, sparse arrays, class instances, maps, and sets are rejected. No insignificant whitespace or trailing newline is added.

`decodeActiveRun` parses input as untrusted data, migrates supported legacy versions, validates the complete result, and returns detached immutable engine data. Validation covers:

- Exact supported schema and game-version forms.
- Identifier and content-hash syntax.
- Safe integer ranges and unsigned 32-bit PRNG words.
- Non-zero PRNG states.
- Unique and consistently referenced floor and entity identifiers, with floor snapshots strictly ordered by floor identifier.
- Floor dimensions, tile values, and tile-array lengths.
- In-bounds hero and entity positions on walkable cells.
- Active-floor consistency.
- A maximum ring length, unique command IDs, and adjacent command revisions chained from each preceding result.
- A reducer-reachable retained command suffix: wait positions remain unchanged, moves are exactly one cell in their requested direction, and adjacent event positions form one continuous chain.
- Invalid records only for movement, with a boundary or wall reason that matches the attempted target on the active floor.
- A nonempty retained suffix whose final position, revision, and turn terminate at the current hero and run counters. The first retained revision may be nonzero after older records are evicted.

Malformed JSON, invalid current data, unsupported future versions, and migration failures return typed load errors with a machine-readable safe path and reason. Error messages must not contain the entire save document.

## Legacy migration

The repository includes a checked-in authoritative `v0` fixture and its expected byte-stable `v1` output. The legacy envelope uses a single unsigned 32-bit seed, one flat `floor`, and no recent-command ring. It already contains the run identifier, game version, content hash, hero, revision, and turn.

The `v0` to `v1` migration:

- Expands the legacy seed deterministically into the four-word run seed.
- Derives every named PRNG stream from that expanded seed.
- Moves the flat floor into the ordered `floors` collection.
- Adds `activeFloorId` from the hero's floor reference.
- Initializes `recentCommands` as an empty array.
- Preserves all semantically equivalent identifiers, coordinates, tiles, turn, and revision.

Migration never guesses absent security- or content-binding data. Unknown future versions are rejected. Supplying a valid `v1` document to the migration entry point is idempotent, and stable serialization after migration must match the checked-in expected bytes.

## Replay verification

Replay is a diagnostic and test facility, not the persistence model:

```ts
export function replayCommands(
  initial: ActiveRun,
  commands: readonly GameCommand[],
): ReplayResult;
```

It resolves commands in order and returns the final state plus byte-stable per-command results and events. The facility never reads a complete command history from a normal save. Production snapshots contain complete mutable state and only the bounded recent-command ring.

Replay tests compare stable bytes, not merely object equality. Given the same initial state, command sequence, game version, and content hash, continuous execution and execution split by encode/decode must produce identical final-state bytes and identical event/result bytes.

## Command-line exit demonstration

A Node-only CLI fixture uses a small authored ASCII floor and a deterministic hero. It accepts a command script with lines such as:

```text
east
east
north
wait
save
reload
west
```

The CLI prints the hero position, turn, revision, domain events, and final state hash. Verification mode executes an equivalent command sequence continuously and across the requested save/reload boundary. It optionally accepts a second valid command file for the uninterrupted comparison run, allowing tests and diagnostics to prove the divergence failure path. It exits non-zero unless final state, command results, and events are byte-identical. Parser failures identify the malformed source line without echoing the complete script.

The demonstration includes a wall collision, a valid move, a wait, save/reload, a duplicate command, and a stale-revision rejection. File access and argument parsing stay outside the engine package's browser-safe production boundary.

## Error model

Four error categories remain distinct:

- **Invalid player action:** explanatory domain event and processed result; no turn or revision advance.
- **Protocol rejection:** typed stale-revision or command-identifier conflict; no state change and no ring insertion.
- **Save load failure:** typed corrupt, unsupported-version, or migration error with safe path and reason.
- **Internal invariant failure:** exception; the caller retains the last-known-good state and does not publish partial output.

The reducer does not catch invariant failures and reinterpret them as player mistakes. The CLI reports safe summaries and exits non-zero for incompatible saves, invalid scripts, replay divergence, or internal failures.

## Verification strategy

Test-driven implementation covers:

- Identifier and state construction invariants.
- Published PRNG vectors, seed expansion, named-stream derivation, serialization, and isolation.
- Pure movement and wait transitions without input mutation.
- Wall and boundary invalid actions that consume no turn.
- Revision advancement, stale revisions, duplicate replay, conflicting command IDs, invalid-action deduplication, and 128-entry eviction.
- Stable object-key ordering, semantic array order, safe-number rejection, and byte stability.
- Strict save validation for corrupt hashes, dimensions, tiles, coordinates, references, PRNG state, ordered floor IDs, and reducer-reachable recent-command suffixes.
- The real `v0` fixture, exact expected `v1` bytes, current-version idempotence, and future-version rejection.
- Continuous versus save/reload replay equivalence.
- CLI exit status and output for matching and deliberately divergent fixtures, line-numbered unknown directives and unsafe revisions, plus missing-file safe-I/O coverage.
- Browser-safety enforcement that prevents Node-only modules from entering the engine production graph.

The milestone verification runs all repository tests, type checks, and builds in addition to the engine-specific CLI demonstration. The existing server and Docker image continue to build without importing engine internals prematurely.

## Compatibility commitments

After this milestone publishes them, command names, event names, identifier fields, schema-version semantics, PRNG algorithm, stream discriminators, stable serialization rules, and migration behavior are stable interfaces. Incompatible changes require an explicit save migration and game-version decision.

Later milestones may add discriminated-union variants and versioned state fields. They must preserve the pure reducer boundary, complete-snapshot persistence, browser/server engine equivalence, content-hash binding, hidden-state ownership rules, and deterministic output established here.
