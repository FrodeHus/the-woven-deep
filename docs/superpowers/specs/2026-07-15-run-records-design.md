# Run Records Design (Milestone 4B3)

Approved design for milestone 4B3: deterministic run metrics, explicit run conclusion, scoring, immutable Hall records, Heart lineage, heirloom selection, achievements, and lifetime-state finalization for The Woven Deep.

## Goal

When a run ends, the engine finalizes it exactly once into an immutable, deterministic Hall record with an itemized score, selects the heirloom, evaluates achievements, and emits lifetime-state deltas that a host-side repository applies. An automated simulation can fight populations, trade with or attack a travelling merchant, die, and finalize a byte-stable run record — the 4B exit demonstration.

## Relationship to other milestones and superseded text

- **Endgame requirements (2026-07-15) supersede the master design's escape model.** The Heart of the Deep is a living person, not an artifact. Runs conclude as one of four completion types: `died`, `became-heart`, `refused`, `broke-cycle`. The master design's outcome tiers (escaped-with-Heart / died-with-Heart / died) are replaced everywhere by completion-type tiers. The roadmap's milestone 7 ("Heart of the Deep return journey") must be amended to a Final Chamber / endings milestone; that amendment is part of 4B3's roadmap update.
- 4B3 implements the complete **data model** for all four completion types, the Heart lineage store, and the finalization pipeline. Only `died` is producible in 4B3. The Final Chamber encounter, ending choices, dialogue, lore prerequisites, and Break-the-Cycle unlock content belong to the future endgame milestone, which only wires triggers into the pipeline built here.
- 4B1 hand-offs consumed here: `evaluateDiscoveryProtection` updates (persisted by 4B3), fallen-hero standings/decisions (`fallenHeroStandings`, `fallenHeroDecisions`, `conqueredChampionRecordIds` on `ActiveRun`), Champion/Echo defeat events, and the heirloom selection rules quoted in the population-encounters design.
- 4B2 hand-offs consumed here: faction reputation records (finalized reputation statistics), merchant commerce metrics sources (trade events, currency deltas).
- Milestones 5–6 replace the in-memory repository with browser-session (guest) and server-side (profile) storage without touching engine types.

## Scope

In scope: save schema v6 (metrics, conclusion, `run-records` RNG stream, v5→v6 migration), content schema v5 (achievement kind, score balance coefficients), the statistic registry, explicit run conclusion with post-conclusion command rejection, `scoreRun`, `HallRecord`, `HeartLineageRecord`, `finalizeRun`, heirloom selection, achievement evaluation, lifetime deltas, `RunRecordRepository` interface + in-memory implementation, projection/event rules, replay and property proofs, deterministic demo, docs, and release gates.

Out of scope: Final Chamber and ending choices (endgame milestone), any UI (milestone 5), browser or SQLite persistence (milestones 5–6), unlock pools beyond the two 4B3 achievements (milestones 6–7), portraits/appearance (character generation milestone).

## State model (save schema v6)

`ActiveRun` gains exactly two fields plus one RNG stream.

### Metrics

A typed statistic registry of counters and extrema — never raw event history. All values are non-negative safe integers. The reducer and world step fold domain events into the registry at the moment the events are produced, so the active-run snapshot always carries current-hero metrics and split replay preserves them.

Tracked (score-serving and conclusion-screen-serving only):

- `kills` (total), `killsByModel` (individual / group / swarm / boss), `bossKills`, `championKills`, `echoKills`
- `threatDefeated` (sum of defeated monsters' authored threat values)
- `damageDealt`, `damageTaken`
- `itemsCollected`, `itemsIdentified`
- `currencyEarned`, `currencySpent`, `tradesCompleted`
- `floorsEntered`, `deepestDepth` (extremum)
- `discoveriesRevealed` (features/secrets)
- `turnsElapsed`, `restsCompleted`

Adding a metric later is a schema bump; the registry is a closed strict record, not an open map.

### Conclusion

```ts
type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';

interface RunConclusion {
  readonly completionType: CompletionType;
  readonly cause: Readonly<{
    killerContentId: ContentId | null;   // null for non-death completions
    depth: number;
    turn: number;
    worldTime: number;
  }>;
  readonly concludedAtRevision: number;
  readonly finalized: boolean;
}
```

`ActiveRun.conclusion: RunConclusion | null` — null while the hero lives. When hero health reaches zero during any world step or reaction, the engine sets the conclusion in the same transition (completionType `died`, killer credited from the fatal damage event). Once non-null, every player command is rejected with the closed reason `run.concluded`; the run is read-only except for `finalizeRun`. Save invariants: dead hero ⟺ non-null conclusion; `finalized` may be true only with non-null conclusion; strict schema mirrors every field.

### RNG

`run-records` joins `RNG_STREAM_NAMES`, derived from the run seed like every other stream. Heirloom selection is its only 4B3 consumer. Materialized once; never rerolled.

### Migration

Exactly one ordered v5→v6 migration: preserve every v5 field byte-for-byte, add zeroed metrics, `conclusion: null`, and the derived `run-records` stream. The current strict v5 run schema is preserved as `legacyActiveRunV5Schema`; the migrated result re-validates through the v6 decoder; all other versions stay rejected. New runs start with zeroed metrics.

## Content (content schema v5)

- **Achievement kind** `content/achievements/*.yaml`: `kind: 'achievement'`, presented name/description, and a criteria discriminant from a closed registry. 4B3 registry: `first-champion-defeat`, `first-echo-defeat`. Bundled entries: `Defeated the Deep's Champion`, `Silenced an Echo`. Compiler validation: unique criteria per achievement (at most one achievement per criterion), strict unknown-field rejection.
- **Score coefficients** in `content/balance/core-gameplay.yaml`: integer coefficients for depth, boss defeats, threat, discoveries, per-completion-type bonus, and the turn-efficiency bonus parameters (bonus budget and decay), all validated non-negative safe integers with documented bounds. No floating point anywhere.
- Every source YAML bumps to `schemaVersion: 5`; compiled pack and hash input follow; documentation and admin-docs coverage tests extend accordingly.

## Scoring

`scoreRun(run, content): ScoreBreakdown` — pure, checked-integer arithmetic in the commerce style (explicit safe-product checks, quotient/remainder division). Components, each an itemized line: deepest depth × coefficient, milestone boss defeats × coefficient, threat defeated × coefficient, discoveries × coefficient, completion-type bonus, bounded turn-efficiency bonus (a capped budget decayed by turns elapsed; never negative, capped so grinding cannot dominate and rushing cannot trivialize). The breakdown stores every line plus the total; consumers never recompute.

## Hall record and Heart lineage

```ts
interface HallRecord {
  readonly recordId: OpaqueId;            // deterministic: derived from run seed + content hash
  readonly heroName: string;
  readonly classTags: readonly string[];
  readonly completionType: CompletionType;
  readonly cause: RunConclusion['cause'];
  readonly deepestDepth: number;
  readonly score: ScoreBreakdown;
  readonly metrics: RunMetrics;           // copied snapshot
  readonly reputations: readonly FactionReputation[]; // finalized statistics
  readonly heirloom: RecordedHeirloomSnapshot;
  readonly runSeed: string;
  readonly contentHash: string;
}
```

Host-enriched display fields — achieved-at date and portrait/appearance — are **not** engine fields. The engine is deterministic and clock-free; the repository layer attaches enrichment at persistence time (`StoredHallRecord = HallRecord + enrichment`). Free-text player messages are deliberately excluded from records and lineage everywhere: user-authored text shown to other players would require moderation (offensive content) and output sanitization (XSS), and no such pipeline exists. Lineage display uses only engine-validated fields (hero name, class tags) plus host enrichment from closed vocabularies.

`HeartLineageRecord`: hero name, class tags, `hallRecordId`, host enrichment. Repository exposes `currentHeart()` and `recordHeart(record)`; most-recent-wins replacement; at most one current Heart; only `became-heart` completions write it (nothing produces that type in 4B3, but the store and replacement rule are implemented and tested).

Hall sorting is a pure shared comparator: completion-type tier first (`broke-cycle` > `became-heart` > `refused` > `died`), then score descending, then record ID for total order.

## Finalization

```ts
function finalizeRun(input: Readonly<{
  run: ActiveRun;               // conclusion non-null, finalized false
  content: CompiledContentPack;
  lifetime: LifetimeState;      // conquered champion IDs, granted achievement IDs, discovery protection, lifetime totals
}>): Readonly<{
  run: ActiveRun;               // finalized: true
  record: HallRecord;
  deltas: LifetimeDeltas;
  events: readonly DomainEvent[];
}>;
```

Pure, callable exactly once (`finalized` guard; second call is an invariant error). Consumes randomness only from `run-records`. Steps, in order:

1. **Heirloom selection** — one deterministic weighted choice over the dead hero's *equipped* item instances only. Backpack items never; objective artifacts, quest tokens, currency, and non-transferable items excluded. Weights favor rarity/quality but every eligible instance retains positive weight. No eligible equipment → the recorded fallback relic. Rolled once, never rerolled.
2. **Score** via `scoreRun`.
3. **Record assembly** with deterministic `recordId`.
4. **Achievement evaluation** against fallen-hero decisions plus `lifetime` (first Champion defeat when a retained champion decision is defeated and its record not yet conquered; first lifetime Echo defeat).
5. **Lifetime deltas**: newly conquered Champion record IDs, achievement grants, discovery-protection updates (4B1's sorted `DiscoveryProtectionUpdate[]`), lifetime metric merges.
6. **Events**: `run.finalized` (record ID, completion type, score total) plus achievement-granted events, all hero-visible.

`LifetimeDeltas` is pure data; the host applies it through the repository. The engine never imports the repository.

## Repository interface

`RunRecordRepository` (engine-adjacent package boundary, host implemented; 4B3 ships the interface and an in-memory implementation used by tests and the demo):

- `standings(limit)` — up to ten ranked fallen-hero snapshots for run creation (feeds existing `fallenHeroStandings`), ranked by the shared comparator.
- `records()` / `appendRecord(stored)` — immutable, append-only Hall.
- `currentHeart()` / `recordHeart(...)` — lineage, most-recent-wins.
- `lifetime()` / `applyDeltas(deltas)` — conquered IDs, achievements, discovery protection, lifetime totals.

Guest (browser session, milestone 5) and profile (server, milestone 6) implementations replace the in-memory one behind the same interface. The server never accepts records or scores from the browser (master design rule stands).

## Events and projection

- New events: `run.concluded` (completion type, cause), `run.finalized`, `achievement.granted`. All added to the domain and save event unions with strict schemas and cross-record checks (e.g. a finalized run must contain exactly one `run.finalized`).
- Projection: the run-conclusion projection exposes the full score breakdown, metrics snapshot, heirloom, and granted achievements to the controlling hero once concluded — the run is over, nothing is hidden-state. Before conclusion, the gameplay projection exposes the current metrics read-only to the controlling hero (they are facts the hero already witnessed); no metric reveals hidden state existing projections redact. Random state, standings internals, and other heroes' records never project.
- Post-conclusion command rejection uses closed reason `run.concluded` and consumes no randomness.

## Determinism and verification

- Metrics fold in the reducer/world step, so continuous vs. split (save/reload) execution produces identical metrics, conclusion, and — after `finalizeRun` on both sides — byte-identical records. Split-replay tests prove it.
- Property suite (512 seeds, shrinking on): metrics validity and monotonicity, conclusion consistency, no command accepted after conclusion, finalize-once, record determinism, heirloom eligibility invariants, score non-negativity and breakdown-total equality, delta idempotence at the repository.
- Deterministic exit demo `run-records:demo`: an automated simulation fights a leader group, contains or flees a swarm, encounters a rare boss, trades with and attacks a travelling merchant, dies, finalizes, and prints record/score/lineage data; run twice in separate processes with pinned save/event/record hashes; added to smoke and Docker gates alongside existing demos.
- Docs: authoring reference for the achievement kind and score coefficients; client contract for `run.concluded` / finalization; roadmap updated (4B3 complete, endgame milestone amended per the endgame requirements).

## Engine constraints (unchanged)

Browser-safe engine; pure immutable `resolveCommand`; every consequential roll from a named saved stream; atomic failures; no wall clocks or ambient randomness; strict schemas with unknown-field rejection; RED/GREEN TDD per task with focused commits and review.
