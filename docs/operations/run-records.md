# Run records: conclusion, finalization, and repository contract

This document is the client and host contract for milestone 4B3 (run records). It covers how a run
concludes, how the engine finalizes it into a Hall record, and how the host repository stores records
and lifetime state. The engine is deterministic and clock-free: it never reads a wall clock, never
produces ambient randomness, and never talks to the repository.

## Conclusion and the `run.concluded` rejection

A run concludes the moment the hero's health reaches zero during any world step or reaction. The
engine sets `ActiveRun.conclusion` in the same transition that kills the hero, with completion type
`died` and the killer credited from the fatal damage event (`killerContentId`, or `null` for
environmental or self-inflicted deaths). Save invariants: a dead hero has exactly a non-null
conclusion, and `finalized` may be true only when the conclusion is non-null.

Once the conclusion is non-null the run is read-only. Every subsequent player command — move, wait,
attack, rest, and every trade command — is rejected with the closed reason `run.concluded`. The
rejection consumes no randomness and does not advance the revision, turn, world time, or any RNG
stream. The only operation permitted on a concluded run is `finalizeRun`.

## Events

Three domain events accompany the conclusion and finalization flow; all are hero-visible and appear
in both the authoritative and public event streams:

- `run.concluded` — carries the `completionType` and the `cause` (`killerContentId`, `depth`, `turn`,
  `worldTime`). Emitted once, inside the killing transition.
- `run.finalized` — carries the `recordId`, `completionType`, and `scoreTotal`. A finalized run
  contains exactly one `run.finalized` event.
- `achievement.granted` — one per newly granted achievement (`achievementId`, `criteriaId`, `name`).

## Finalization flow

```ts
finalizeRun(input: {
  run: ActiveRun;          // conclusion non-null, finalized === false
  content: CompiledContentPack;
  lifetime: LifetimeState; // conquered champion IDs, granted achievement IDs, discovery protection, totals
}): {
  run: ActiveRun;          // finalized === true
  record: HallRecord;
  deltas: LifetimeDeltas;
  events: readonly DomainEvent[];
};
```

`finalizeRun` is pure, deterministic, and clock-free: identical inputs produce byte-identical outputs.
It is callable **exactly once** — the `finalized` guard rejects a second call as an invariant error.
It consumes randomness only from the `run-records` RNG stream, and at most one heirloom roll; the
stream is materialized once from the run seed and never rerolled. In order it performs heirloom
selection (a single weighted roll over the dead hero's *equipped* item instances only — backpack
items, objective artifacts, quest tokens, currency, boss uniques, and items tagged `heirloom`,
`quest`, `objective`, or `nontransferable` are excluded; no eligible equipment records the fallback
relic), scoring via `scoreRun` (itemized lines plus a total; consumers never recompute), record
assembly with a deterministic `recordId` derived from the run seed and content hash, achievement
evaluation against the fallen-hero decisions plus `lifetime`, and the `LifetimeDeltas` assembly.

`LifetimeDeltas` is plain data. The engine returns it; the host applies it through the repository.
The engine never imports the repository.

## `RunRecordRepository` responsibilities

The engine ships the `RunRecordRepository` interface and an in-memory implementation used by the
tests and the `run-records:demo` exit demonstration. The guest (browser session, milestone 5) and
profile (server, milestone 6) implementations replace it behind the same interface without touching
engine types. The server never accepts records or scores from the browser.

- `standings(limit)` — up to ten ranked fallen-hero snapshots for run creation, ranked by the shared
  completion-tier-then-score comparator. Only `died` records with a positive death depth are ranked.
- `records()` / `appendRecord(stored)` — the immutable, append-only Hall; duplicate record IDs are
  rejected, and stored records are deep-frozen copies.
- `currentHeart()` / `recordHeart(record)` — the Heart lineage, most-recent-wins, at most one current
  Heart. Only `became-heart` completions write it (nothing produces that type in 4B3).
- `lifetime()` / `applyDeltas(deltas)` — conquered champion IDs, granted achievement IDs, discovery
  protection, and lifetime metric totals. `applyDeltas` is idempotent, keyed on the delta `recordId`.

## Host enrichment

Host-enriched display fields are **not** engine fields. The enrichment vocabulary is closed to exactly
the achieved-at label and the portrait/appearance glyph, attached at persistence time
(`StoredHallRecord = HallRecord + enrichment`). The engine is clock-free and never produces either
value. `achievedAt` is a host-supplied **display string**, not a validated timestamp: the guest client
(milestone 5) writes `"Run #N"` — the record's 1-based position in the session Hall — while the server
profile (milestone 6) will write a real date. Consumers render it verbatim and never parse it.
Free-text player messages are deliberately excluded from records and lineage everywhere: user-authored
text shown to other players would require moderation and output sanitization pipelines that do not
exist. Lineage display uses only engine-validated fields (hero name, class tags) plus the closed host
enrichment.

## The guest Hall (milestone 5B)

The guest client implements `RunRecordRepository` over the browser's `sessionStorage`
(`apps/web/src/session/run-records-storage.ts`, keyed at `woven-deep.guest-hall`). It behaviourally
mirrors the engine's in-memory repository — append-only immutability via deep-freeze, duplicate-ID
rejection, and delta idempotence keyed on the delta `recordId` — and differs only at the persistence
boundary: every mutation re-serializes the whole `{ records, heart, lifetime, appliedDeltaRecordIds }`
blob (a single guest session's Hall stays small, so full rewrites are cheap). A corrupt or
foreign-shaped blob is rejected at construction with `SessionHallCorruptError`; the module first resets
the key to a fresh empty Hall, so the retry the client immediately performs always succeeds, and the
active run — a separate storage key — is never touched.

Finalization is automatic and exactly-once. When a run's `conclusion` first becomes non-null (the hero
died), `GuestSession.finalizeConcludedRun` runs `finalizeRun`, appends the resulting record with its
enrichment, applies the lifetime deltas, and projects the conclusion screen. The enrichment it supplies
uses the closed vocabulary above: `portraitGlyph` from the chargen wizard's cosmetic side-state (`'@'`
default), and `achievedAt` set to `"Run #" + (repository.records().length + 1)` — the run's ordinal in
the Hall at the moment it is recorded. An already-finalized run restored from storage (Continue into a
dead run) is **not** re-finalized: its existing record is looked up by the deterministic hall-record ID
and re-projected, so reloads never double-append.

Both the conclusion and Hall screens mark everything they show as *unverified · this session only* —
the guest client has no server-side confirmation of any standing. Server-backed persistence and
verification land in milestone 6.

The full chargen → play → death → conclusion → Hall lifecycle is exercised end-to-end, in a real
browser, by `apps/web/e2e/run-lifecycle.spec.ts`.
