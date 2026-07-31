# Legendary Artifacts — Design

**Date:** 2026-07-31
**Status:** Approved pending user review
**Issue:** #124 (also wires the dormant fallen-hero standings, activating Champions/Echoes in production)

## Summary

Named, singleton artifacts with recorded provenance that circulate through a profile's runs.
Approach 1: artifacts are hand-authored content entries (an `artifact` block, content schema
v9→v10); circulation state lives in a new `ArtifactLedger` owned by the records repository
beside `LifetimeState`. Undiscovered artifacts enter the world through boss drops and rare
deep-vault rolls — never gated behind an Echo/Champion fight; artifacts lost with a dead hero
are recoverable only by defeating that hero's Champion, and recycle back to the undiscovered
pool if their holding record falls out of the standings. Signature abilities and drawbacks use
only existing machinery (spells/charges; negative derived-stat modifiers) — no new effect
primitives.

## Decisions (user-confirmed)

1. **Same-profile circulation (v1).** Cross-player anything is phase 2 with its own spec. The
   ledger shape must survive a later sync to a shared service unchanged.
2. **Undiscovered artifacts never require fighting an Echo.** Virgin acquisition routes are
   milestone/heart boss drops and a rare deep-vault slot roll. Champion recovery applies only
   to artifacts previously found and then lost. Shrine bargains are a future hook (#118).
3. **Activated + stat-block abilities (v1).** Signature ability = existing `spellId` +
   charges; passive contribution = the existing `combat` block; drawback = always-on negative
   derived-stat modifiers via the enchantment-modifier validation path. No triggered/passive
   effect system, no new entries in the closed effect registry.
4. **Singleton with recycling.** Each artifact exists at most once across the profile's
   history. Lost → recoverable via the holding hero's Champion. Holding record leaves the
   top-10 standings, or its Champion is conquered without pickup → the artifact returns to
   the undiscovered pool. Nothing is ever silently bricked.
5. **Canon-only roster (v1).** Procedurally-forged artifacts are a follow-up tier; the
   registry design must let them slot in without schema churn. The roster includes the user's
   authored artifact **Maria's Grace** (permanent light; see Roster).
6. **Rare pacing.** Most runs see zero artifacts. Bosses always drop their canon relic while
   it is undiscovered; otherwise ~12% of qualifying deep vaults offer one undiscovered
   artifact per run at most.

## Content model (schema v9→v10)

New optional `artifact` block on item entries:

```yaml
artifact:
  canon: true                       # v1: always true; forged tier reuses the block later
  signature:                        # optional — Maria's Grace has none
    spellId: spell.frost-nova       # must resolve to an existing spell entry
    charges: 3
    rechargePerFloor: 1             # charges regained on entering a new floor, capped at charges
  drawbackModifiers:                # required unless artifact.light.inextinguishable is true
    speed: -1                       # keys are DERIVED_STAT_NAMES; values must be negative
  light:                            # optional; only valid when the item has a light block
    fuelless: true                  # never consumes fuel; fuel gauge hidden
    inextinguishable: true          # effect.light.toggle refuses to douse it (log line)
```

Compile validation (all diagnostics named): `artifact` requires `rarity: legendary`,
`stackLimit: 1`, and `identification.mode: known`; at least one of
`signature`/`combat`-passive present; a drawback present (negative modifiers, or
`inextinguishable: true` counts as the drawback for light artifacts — never pure upside);
`signature.spellId` resolves; `drawbackModifiers` keys are derived stats with values < 0;
artifact items are forbidden in every ordinary loot graph (extends the existing
guaranteed-unique exclusion) and are not `heirloomEligible` in the ordinary sense (they take
the dedicated priority path below). Merchants refuse artifacts (same guard as heirlooms).
Migration notes v10 in `docs/server-admin/content-configuration.md` (the versioned-note test
from #138 enforces this).

## Circulation & ledger

### Ledger state (repository-owned, beside `LifetimeState`)

```ts
interface ArtifactStint {
  readonly heroName: string;
  readonly recordId: OpaqueId;         // Hall record of the stint
  readonly outcome: 'died-with' | 'recovered' | 'escaped-with' | 'reclaimed-by-the-deep';
  readonly depth: number;              // depth at which the stint ended
}
interface ArtifactLedgerEntry {
  readonly artifactId: OpaqueId;       // item content id
  readonly status: 'undiscovered' | 'lost';
  readonly holderRecordId: OpaqueId | null;  // set iff status === 'lost'
  readonly provenance: readonly ArtifactStint[];
}
type ArtifactLedger = readonly ArtifactLedgerEntry[];  // one entry per canon artifact, sorted by artifactId
```

`RunRecordRepository` gains `artifactLedger(): ArtifactLedger` and
`applyArtifactDeltas(deltas)` — deltas keyed by `recordId` for idempotence, mirroring
`applyDeltas`. Guest (sessionStorage) and server (SQLite `hall_state`) implement identically;
a parity test drives both through the same scenario. Artifacts absent from the ledger (new
content) are implicitly `undiscovered`; artifacts removed from content are ignored on read.

### Run start (the standings wiring fix)

`createNewRun` input gains `artifacts: { undiscovered: readonly OpaqueId[] }` alongside the
standings. Both production hosts (`apps/server` play-session, `apps/web` guest-session) now
pass `repository.standings(10)` into `fallenHeroStandings` and the ledger's undiscovered set —
**this activates the existing Champion/Echo machinery in production for the first time** (it
is engine-complete but currently receives `[]`). `conqueredChampionRecordIds` already flows
via lifetime state.

One hidden run-start roll on the `run-records` stream (ordered BEFORE heirloom selection so
the two draws are stably sequenced; heirloom selection happens at death, so in practice the
offer roll is the stream's first consumer): with `artifactOfferPercent` (balance knob, 12),
decide whether this run offers a vault artifact and, if so, roll uniformly which undiscovered
non-boss artifact. Store as a hidden run field `offeredArtifact: OpaqueId | null` — never
projected (hidden-field rule). Boss canon relics are NOT part of this roll; each drops from
its boss iff still undiscovered.

### Placement

- **Boss drops:** `createRewards` consults the run's undiscovered set: the boss's
  `uniqueItemId` artifact materializes only while undiscovered; otherwise the boss drops only
  its ordinary reward loot. (Fallback tokens remain for champions, unchanged.)
- **Vault offers:** deep vaults may author an `artifact`-tagged item slot (new slot tag, not a
  new kind). When the run's `offeredArtifact` is non-null and a qualifying vault places, the
  slot materializes that artifact (identified, full condition). At most one vault artifact per
  run. Slots with the tag are ignored when there is no offer.

### Death, recovery, escape

- `finalizeRun` computes `ArtifactDeltas` alongside lifetime deltas. Hero dies holding
  artifacts (backpack or equipped): ONE artifact (weighted roll among held artifacts on the
  `run-records` stream — this replaces ordinary heirloom selection for that record) becomes
  the Hall record's heirloom, `status: lost`, `holderRecordId` set, stint `died-with`
  appended. Any additional held artifacts recycle immediately (`undiscovered`, stint
  `reclaimed-by-the-deep`). Ordinary heirloom selection runs only when no artifact is held.
- Recovery uses the existing champion heirloom materialization unchanged (identity, condition,
  enchantment preserved; `item.heirloom.<populationId>` instance id; provenance metadata
  attached). When a run that picked the artifact up finalizes, the stint (`recovered`, or
  `died-with` again if that hero also died holding it) is appended and status updates.
- Hero escapes/wins holding an artifact: stint `escaped-with`, and the artifact re-enters
  circulation exactly as a death does — it becomes the victorious record's heirloom
  (`lost`, holder = that record), recoverable via that record's Champion if it ranks, else
  recycled by reconciliation. One recovery mechanism, no separate trophy-case system
  (deferred).

### Reconciliation (recycling)

`reconcileArtifactLedger(ledger, standings, lifetime): ArtifactLedger` — pure engine
function, called by both repositories after every `appendRecord`/`applyArtifactDeltas`:
any `lost` entry whose `holderRecordId` is not in the current top-10 standings, or whose
champion is in `conqueredChampionRecordIds` while the artifact was never picked up, flips to
`undiscovered` with a `reclaimed-by-the-deep` stint. Singleton invariant (asserted in
tests and repository writes): an artifact is never simultaneously placeable-virgin and
recoverable-from-a-champion.

## Roster (v1 content)

All seven existing relics gain `artifact` blocks (signature from the existing spell list,
drawback numbers final in content review): Warden's Ember, The Ashfather's Cinder, The
Drowned Crown, The Herald's Sigil, Cinder of the Freed Heart (boss-bound), Bound Signet and
Echo Heartstone (deep-vault pool). Two new vault-pool artifacts (authored during
implementation, following the block rules). Plus:

- **Maria's Grace** — a lantern that never dims. `light: { fuelless: true,
  inextinguishable: true }`, no fuel gauge, modest passive (`combat: { defense: 1 }`), no
  signature spell. Its drawback is its blessing: it cannot be doused — the light toggle
  refuses ("The Grace will not be hidden."), so its bearer can never move unseen in the dark.
  Vault pool, `minDepth` mid-band.

## Client

- Artifact names render in a distinct gold style in inspect, log lines, and the HUD pickup
  toast — the same `text-accent` token the HUD spends on the carried-gold count. **Amended
  (Task 12):** artifact-ness and provenance are both resolved CLIENT-SIDE from the compiled
  pack and the records repository, not from `ItemView`. The client owns the pack, so an
  item's `artifact` block is a lookup by `contentId` (absent for an unidentified item, whose
  projection omits `contentId` entirely — so its gold name can never give it away), and no
  styling flag is added to `ItemView`. Provenance *stints* come from
  `repository.artifactLedger()`, keyed by the same `contentId`: the engine never holds the
  ledger, so extending `ItemView.provenance` with stints would mean leaking repository state
  into a projection. `ItemView` keeps only the existing `originatingHallRecordId`.
- Inspect overlay shows provenance lines, oldest first: `Borne by <heroName> — <outcome text>
  at depth <depth>` (`died-with` → "fell", `recovered` → "reclaimed it", `escaped-with` →
  "carried it out", `reclaimed-by-the-deep` → "the Deep took it back"; the depth clause is
  dropped for a depth-0 stint, which is what the ledger's reconcile pass stamps). An
  `escaped-with` stint's text is overridden by the Hall record's own `completionType` where
  the record is available (joined client-side by `recordId`) — a hero who became the Heart
  reads "was bound into the Heart with it", not "carried it out".
- Inspect also states an artifact's `drawbackModifiers` as signed rows, and hides the fuel
  gauge and every refuel affordance when the pack says `artifact.light.fuelless` — never on
  `fuel === null`, since a fuelless instance is created holding `fuel: fuelCapacity`.
- Hall screen gains a compact "Relics of the Deep" panel: held/lost artifacts by name with
  their last stint; undiscovered shown only as a count ("3 relics remain unfound") — no
  spoilers.
- Sprites: existing relic sprites carry over via contentId mapping; Maria's Grace uses the
  brass-lantern sprite with a warm tint until dedicated art; glyph fallback everywhere.

## Determinism, saves, schema

- Save schema v12→v13: hidden `offeredArtifact` on the run + nothing else run-side (artifact
  instances are ordinary `ItemInstance`s; provenance metadata rides the existing heirloom
  path). One ordered migration (`offeredArtifact: null` for migrated saves — a mid-run save
  from before the feature simply offers nothing and drops no boss relic for the rest of that
  run — the migrated `artifactsUndiscovered` is empty, which the boss gate reads as "already
  found").
- `run-records` stream ordering specified: offer roll at run creation; artifact-priority
  heirloom roll at finalize (replacing, not preceding, the ordinary heirloom roll for
  artifact-holding records). Demo hashes re-pin once, each delta attributed.
- Content schema v10 with migration notes; the versioned-note admin-docs test extended.

## Testing

- `reconcileArtifactLedger` pure suite: singleton invariant, standings-eviction recycle,
  conquered-without-pickup recycle, idempotence.
- Repository parity: guest and server driven through the same find→die→recover→evict
  scenario yield identical ledgers.
- Boss-drop suppression when the relic is in circulation; vault offer respects
  `offeredArtifact` and the one-per-run cap; no artifact ever enters an ordinary loot graph
  (compile test).
- Artifact-priority heirloom selection (single and multi-artifact deaths); ordinary selection
  untouched when no artifact held.
- Maria's Grace: never consumes fuel, toggle refuses with the log line, drawback validation
  accepts inextinguishable-as-drawback.
- Save v12→v13 migration round-trip; replay equality; demo re-pins attributed.
- Standings wiring: a production-shaped host (server + guest session tests) yields champions
  on the death floor — the dormant-machinery activation is asserted, not assumed.

## Out of scope

Cross-player circulation (phase 2 — ledger sync to a shared service), procedurally-forged
tier, shrine acquisition (#118 hook), unidentified artifacts, triggered/passive ability
system, trophy-case for escaped artifacts, dedicated artifact art.
