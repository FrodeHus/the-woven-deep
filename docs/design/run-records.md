# Run Records: Metrics, Conclusion, Scoring, and the Hall

**Status:** Shipped (milestone 4B3); the `died` completion type is the only one currently
producible — see "Superseded ending model" below

**Package:** `packages/engine`

When a run ends, the engine finalizes it exactly once into an immutable, deterministic
Hall record: metrics, an itemized score, a selected heirloom, evaluated achievements, and
lifetime-state deltas a host-side repository applies. The engine never touches the
repository directly and is fully clock-free — no field in a Hall record depends on wall
time.

## Superseded ending model (later spec governs)

The original master design (`2026-07-13-woven-deep-design.md`) described the objective as
recovering the Heart of the Deep as an artifact and escaping — outcome tiers of
"escaped with the Heart," "recovered the Heart but died," and "died." The later **endgame
requirements** (2026-07-15, folded into this milestone) explicitly supersede that: the
Heart of the Deep is a *living person*, not an artifact, and there is nothing to carry
out. A run concludes as exactly one of four completion types:

```ts
type CompletionType = 'died' | 'became-heart' | 'refused' | 'broke-cycle';
```

replacing the old outcome tiers everywhere, including Hall sort order (`broke-cycle` >
`became-heart` > `refused` > `died`, then score, then record ID). This milestone
implements the **complete data model** for all four types, the Heart lineage store, and
the finalization pipeline — but only `died` is actually producible today. The Final
Chamber encounter, the ending choices that produce the other three types, ending
dialogue, lore prerequisites, and the Break-the-Cycle unlock content are future work
(originally roadmap milestone 7, "Heart of the Deep return journey," renamed to a
"Final Chamber / endings" milestone); that future work only needs to wire triggers into
the pipeline described here, not rebuild it.

## Conclusion

`ActiveRun.conclusion: RunConclusion | null` is null while the hero lives. The instant
hero health reaches zero, in the same world-step transition, the engine sets
`completionType: 'died'`, credits the killer from the fatal damage event
(`killerContentId`, or `null` for environmental/self-inflicted deaths), and records
depth/turn/worldTime. From that point the run is **read-only**: every subsequent player
command — move, wait, attack, rest, any trade command — is rejected with the closed
reason `run.concluded`, consuming no randomness and advancing nothing. The only
permitted operation on a concluded run is `finalizeRun`. Save invariant: dead hero ⟺
non-null conclusion; `finalized` can only be true with a non-null conclusion.

## Metrics

A closed, typed statistic registry — counters and extrema, never raw event history — that
the reducer folds into on every relevant domain event, so continuous and split-replay
execution always agree and the active-run snapshot always carries current metrics.
Tracked: kills (total and by population model), boss/champion/Echo kills, threat
defeated, damage dealt/taken, items collected/identified, currency earned/spent, trades
completed, floors entered, deepest depth, discoveries revealed, turns elapsed, rests
completed. Adding a metric later is a schema bump — the registry is a closed strict
record, not an open map, so nothing can silently grow save size.

## Scoring

`scoreRun(run, content)` is pure, checked-integer arithmetic (no floating point
anywhere): deepest depth × coefficient, milestone boss defeats × coefficient, threat
defeated × coefficient, discoveries × coefficient, a completion-type bonus, and a bounded
turn-efficiency bonus (a capped budget that decays with turns elapsed — floored at zero,
capped so grinding can't dominate and rushing can't trivialize the score). The breakdown
stores every line item plus the total; nothing downstream recomputes it.

## Finalization

```ts
finalizeRun(input: {
  run: ActiveRun;               // conclusion non-null, finalized false
  content: CompiledContentPack;
  lifetime: LifetimeState;      // conquered champion IDs, granted achievements, discovery protection, lifetime totals
}): {
  run: ActiveRun;                // finalized: true
  record: HallRecord;
  deltas: LifetimeDeltas;
  events: readonly DomainEvent[];
};
```

Pure, callable exactly once per run (a second call is an invariant error), consuming
randomness only from the dedicated `run-records` stream. In order: (1) select the
heirloom — one weighted roll over the dead hero's *equipped* instances only, positive
weight for every eligible instance, fallback relic if none eligible, rolled once, never
rerolled (full mechanics in `populations-and-npcs.md`'s Champion section); (2) score via
`scoreRun`; (3) assemble the record with a deterministic `recordId`; (4) evaluate
achievements (first Champion defeat, first lifetime Echo defeat) against fallen-hero
decisions and lifetime state; (5) compute lifetime deltas (newly conquered Champion
IDs, achievement grants, discovery-protection updates, lifetime metric merges); (6) emit
`run.finalized` plus any `achievement.granted` events.

An heirloom instance already carrying inherited-heirloom metadata from an earlier fallen
hero is **not** excluded from being selected again by that fact alone — only the
content-defined eligibility rules exclude candidates — so a re-inherited heirloom can be
chosen again. Re-selection reassigns its origin to the new record: provenance is always
one hop, most recent wins.

## Hall record and Heart lineage

A `HallRecord` carries hero name, class tags, completion type, cause, deepest depth, the
full score breakdown, a metrics snapshot, finalized faction reputations, the heirloom
snapshot, an engine-facts build snapshot (attributes, equipped items, abilities — feeding
the Champion/Echo standings normalization), run seed, and content hash. Deliberately
**not** engine fields: achieved-at date and portrait/appearance, both host enrichment
attached at persistence time (`StoredHallRecord = HallRecord + enrichment`), and any
free-text player message — user-authored text shown to other players would require a
moderation and sanitization pipeline that doesn't exist, so lineage display uses only
engine-validated fields plus enrichment from closed vocabularies, permanently.

`HeartLineageRecord` (hero name, class tags, Hall record ID, host enrichment) is written
only by `became-heart` completions — not producible yet, but the store and its most-
recent-wins replacement rule are implemented and tested now so the future endings
milestone only needs to call it.

## Repository contract

`RunRecordRepository` is an engine-adjacent, host-implemented interface (4B3 ships an
in-memory implementation for tests/demo): `standings(limit)` (up to ten ranked fallen-hero
snapshots for run creation, feeding `populations-and-npcs.md`'s Champion/Echo selection),
`records()`/`appendRecord` (immutable, append-only), `currentHeart()`/`recordHeart`
(lineage), `lifetime()`/`applyDeltas` (conquered IDs, achievements, discovery protection,
lifetime totals). Guest play (browser `sessionStorage`) and profile play (server SQLite)
implement the same interface — see `guest-client.md` and `identity-and-persistence.md`.
The server never accepts a record or score from the browser, matching the master design's
"never trust client-submitted progression" rule everywhere else in the codebase.

## Projection

Before conclusion, the gameplay projection exposes current metrics read-only to the
controlling hero (they're facts the hero already witnessed — no new hidden-state leak).
After conclusion, the run-conclusion projection exposes the full score breakdown,
metrics, heirloom, and granted achievements — the run is over, nothing is hidden anymore.
Random state, standings internals, and other heroes' records never project, at any point.
