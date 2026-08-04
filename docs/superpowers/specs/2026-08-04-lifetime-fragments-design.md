# Lifetime tablet fragments design

Issue: #147 — "design: the best ending is a lottery the player cannot grind toward".

## Problem

`broke-cycle` — the 1500-point ending and its `achievement.broke-the-cycle` — requires the hero to
*presently hold* all three Ancient Tablet fragments (`heroHoldsAllFragments`,
`final-chamber-fragments.ts`). Fragments spawn at 1-in-40 per floor
(`balance.fragmentSpawnRollDenominator: 40`) and only at depth ≥ 15, which is five eligible floors
per run. The probability of a full set in one run is roughly 1.6×10⁻⁴ — about one run in six
thousand.

Nothing carries between runs, so run #500 has exactly the odds of run #1. The stated design — the
tablet as the reward for playing many times — has no mechanism behind it, and "the Deep remembers"
remembers standings, artifacts, conquered champions, achievements, and lifetime metrics, but not
the fragments the player actually found.

`docs/design/endgame-final-chamber.md` already anticipated this as deferred "Part B". This design
lands it.

## Approach

Fragments accumulate in `LifetimeState`, the same cross-run store that already holds conquered
champion ids, granted achievements, discovery protection, and lifetime metrics. A fragment the
player has ever finished a run holding stays collected forever; the Chamber gate accepts a fragment
that is either carried right now or banked from an earlier run; and a banked fragment stops
spawning, so each run rolls only for what is still missing.

Three runs that each turn up one fragment assemble the tablet. That is the "play many times" story
the ending was always described as having.

### What counts as collected

Whatever the hero holds in their backpack **when the run concludes** — including on death. This
needs no new run-scoped tracking: `finalizeRun` already reads the final inventory for the heirloom
and death-inventory snapshots, and reads fragments off it the same way.

Picking a fragment up and then selling or dropping it before the run ends banks nothing. That is
intentional and legible: the Deep remembers what you carried out of it, or died holding.

### Where it is stored, and for whom

`LifetimeState` is host-persisted, and both hosts already persist it:

- the guest client's session-storage Hall (`apps/web/src/session/run-records-storage.ts`), which
  merges `LifetimeDeltas` itself, and
- the server's `hall_state.lifetime_json` (`apps/server/src/db/hall-repository.ts`), which stores
  the *applied-deltas envelope* and replays it through the engine's in-memory repository to derive
  `lifetime()`.

Because the server derives rather than stores the projection, it needs no SQL migration: a new
delta field flows through the replay automatically.

This deviates from the endgame doc's Part B sketch in two ways, and that doc is amended to match:

1. **No house deposit step.** Fragments bank at run conclusion rather than by depositing one in the
   house. A deposit ritual is a second mechanism for the same fact, and it strands a fragment found
   on the run where the hero dies at depth 18 — the runs the tablet is supposed to reward.
2. **Guests accumulate too.** Part B framed the lifetime store as a registration incentive, with
   guests banking nothing. Guest and registered play share one `LifetimeState` shape and one delta
   merge; special-casing guests would mean a second gate rule and a second spawn rule for the
   difference. The registration incentive stays what it already is — a guest's Hall lives in
   `sessionStorage` and does not roam.

## Design

### Engine

**`LifetimeState.collectedFragmentIds: readonly OpaqueId[]`** — sorted, unique, like its siblings.
`emptyLifetimeState()` seeds it `[]`.

**`LifetimeDeltas.newlyCollectedFragmentIds: readonly OpaqueId[]`** — produced by `finalizeRun` from
the fragments the hero holds at conclusion, minus what lifetime already knows, sorted. The
repository folds it by sorted union, exactly as it folds `newlyConqueredChampionRecordIds`. The
merge stays idempotent through the existing applied-`recordId` set.

`finalizeRun` is pure and already takes `lifetime: LifetimeState`, so the subtraction is local to
it.

**`ActiveRun.collectedFragmentIds: readonly OpaqueId[]`** — the run's snapshot of what lifetime had
banked when it started, seeded through `NewRunRecordsInput.collectedFragmentIds` by `newRunRecords`.
Validated sorted-and-unique by `validateActiveRun`, like `conqueredChampionRecordIds`. A run created
without records (the history-free path) gets `[]` and behaves exactly as today.

This is a save-schema bump: **v17 → v18**, with `legacyActiveRunV17Schema` preserved and one ordered
migration defaulting the field to `[]`.

**The gate.** `heroHoldsAllFragments` becomes `canAssembleTablet(run, content)`: every fragment id
the pack defines is satisfied if the hero holds it *or* it appears in `run.collectedFragmentIds`. An
empty fragment set still returns `false` rather than vacuously true. `heroHoldsFragment` keeps its
present meaning and name — the spawn rule still asks a strictly run-local question.

**Spawn.** `population-placement` drops a fragment from the deep-floor candidate pool when it is
already in `run.collectedFragmentIds`, alongside the existing run-local held-check. With an empty
set this changes nothing, so no pinned demo hash moves.

The roll itself is untouched: the placement still rolls `fragmentSpawnRollDenominator` first and
only then picks from the candidates, so a run with fewer candidates draws the same stream shape. A
run whose candidate pool is empty places nothing, as it does today when every fragment is already
carried.

### Web

`run-records-storage.ts` persists the new field: `emptyPersistedState` seeds `[]`, the structural
validator accepts the array, the migration defaults a blob written before this change, and
`applyDeltas` merges by `mergedSortedUnion`.

`guest-session.ts` computes `canBreakCycle` from `canAssembleTablet` against its own `ActiveRun`, so
it picks the change up with the rename.

`profile-session.ts` derives `canBreakCycle` from the projected backpack, which cannot see lifetime
state. The server carries an authoritative `canBreakCycle` on its run snapshot — computed by the
same engine predicate against the run it owns, beside the existing `bossActive` — and the client
reads it instead of re-deriving. Raw run state still never crosses the wire.

The engine reducer remains the authority: it re-checks the gate on `break-cycle` and rejects
regardless of what a client offers.

### Content

None. No schema bump, no new items, no balance change. `fragmentSpawnRollDenominator` stays 40 —
the fix is accumulation, not a higher roll.

## Odds after the change

With one fragment banked per successful deep run, the tablet is assembled after roughly three runs
that each reach depth ≥ 15 and turn up a fragment. Per-run, a five-floor deep dive finds a *given*
missing fragment with probability ≈ 1 − (39/40)⁵ ≈ 0.12 when one remains, so the tail is tens of
deep runs rather than thousands. That is a grind the player can see moving, which is the point.

## Determinism notes

- Every new field defaults to `[]`, so an existing save, an existing Hall blob, and every pinned
  demo replay produce byte-identical output. No `*-demo-hashes.json` should move; if one does, the
  change is wrong.
- The spawn exclusion consumes no randomness of its own — it filters candidates, and the roll that
  precedes it is unchanged.
- `finalizeRun` stays pure and consumes no randomness; reading the final inventory adds no draw.
- Split save/reload replay stays byte-identical: `collectedFragmentIds` is fixed at run creation and
  never mutates mid-run.

## Testing

- **RED first**, per repo convention.
- Engine: `canAssembleTablet` accepts a lifetime-banked fragment and rejects a missing one; empty
  fragment set is still false. `finalizeRun` emits only fragments not already banked. The repository
  folds the union and stays idempotent on a replayed `recordId`. `createNewRun` seeds and validates
  the field; unsorted or duplicated input throws. Save round-trip is byte-identical, and a v17 blob
  migrates to `[]`.
- Spawn: a run with a banked fragment never places that fragment; with none banked, placement is
  unchanged.
- Reducer: `break-cycle` is accepted when the missing fragments are lifetime-banked, and still
  rejected when one is neither held nor banked.
- Web: the session-storage Hall persists and merges the field, and a pre-change blob migrates.
- Server: the lifetime envelope replay surfaces banked fragments, and the run snapshot's
  `canBreakCycle` reflects them.

## Out of scope

- Any UI for showing which fragments are banked. Worth doing, and worth its own issue — the tablet
  should be visible progress, not a surprise at depth 20.
- Raising `fragmentSpawnRollDenominator` or widening the depth band.
- A house deposit ritual.
