# Task 8 report: terrain and perception command resolution

## Status

Implemented terrain-registry movement blocking and active-floor perception refresh after applied movement. Waiting, invalid, rejected, and duplicate commands do not recompute knowledge. Command/event identities, counters, recent-command retention, floor ordering, input immutability, save validation, and deterministic replay behavior remain intact.

The base commit already used `movementBlockReason` for schema v2 retained-history validation in `save-schema.ts`; this task retained that implementation and expanded its regression coverage.

## RED

Command:

```text
npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts test/save-codec.test.ts test/replay.test.ts
```

Observed four intended failures:

- closed door was incorrectly applied instead of returning `blocked.door`
- pillar was incorrectly applied instead of returning `blocked.pillar`
- void was incorrectly applied instead of returning `blocked.void`
- a carried radius-2 light did not reveal the newly illuminated corridor cell after movement

The remaining 74 focused tests passed.

## GREEN

- Replaced the wall-only reducer condition with `movementBlockReason` while preserving the distinct bounds reason.
- Recorded the accepted movement, constructed the moved hero, and resolved perception actors from same-floor saved entities plus that moved hero.
- Refreshed knowledge once in the applied-movement path and replaced only the active floor snapshot at its existing array position.
- Added table-driven blocker coverage for wall, closed door, pillar, and void.
- Added table-driven walkability coverage for floor, stair-up, and stair-down, with stairs remaining on the same floor.
- Added dark-corridor coverage for moved attachment, new exploration, retained memory, immutable input, exact duplicate references, inactive-floor identity/order, and no refresh for stale, conflicting, invalid, or wait commands.
- Expanded saved retained-history validation coverage across all four terrain blocker reasons.

## Verification

```text
npm test --workspace @woven-deep/engine -- --run test/reducer.test.ts test/save-codec.test.ts test/replay.test.ts test/cli.test.ts
PASS: 4 files, 86 tests

npm run typecheck --workspace @woven-deep/engine
PASS

npm test --workspace @woven-deep/engine
PASS: 16 files, 257 tests

npm run engine:demo
PASS: deterministic replay verified

git diff --check
PASS
```

An initial verification run exposed a TypeScript inference mismatch in the actor map: constructing it from entities inferred values as requiring `entityId`, while perception accepts positional `{x, y}` values and also needs the hero. Declaring the map's positional value type fixed the root cause; all verification above was rerun afterward.

## Files

- `packages/engine/src/reducer.ts`
- `packages/engine/test/reducer.test.ts`
- `packages/engine/test/save-codec.test.ts`
- `.superpowers/sdd/task-8-report.md`

## Self-review

- Refresh occurs only after movement is accepted and recorded.
- Bounds retains `blocked.bounds`; every terrain reason comes from the registry.
- Duplicate lookup and stale/conflict rejection still precede any refresh work.
- Invalid movement and waiting retain the original knowledge object.
- The actor map contains only active-floor saved entities and the moved hero.
- Only the active floor is copied; inactive snapshots retain identity and array order.
- The recent ring and command/event/result construction are unchanged.
- No unrelated files or generated helpers were changed.

## Commit

`feat: refresh sight after dungeon movement` (the commit containing this report)

## Concerns

None. `save-schema.ts` required no source edit because its schema v2 retained-history path already derived invalid reasons through `movementBlockReason` at the specified base commit.
