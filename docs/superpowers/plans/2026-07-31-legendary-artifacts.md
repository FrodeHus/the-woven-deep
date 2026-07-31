# Legendary Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named singleton artifacts with recorded provenance that circulate through a profile's runs — found in the world, lost with dead heroes, guarded by their Champions, reclaimed by the Deep when forgotten.

**Architecture:** Artifacts are content entries (an `artifact` block, content v9→v10). Circulation state is an `ArtifactLedger` owned by the records repository beside `LifetimeState`, reconciled by a pure engine function. `createNewRun` gains a records input (standings + undiscovered artifacts) — wiring that also activates the dormant Champion/Echo machinery. One hidden run-start roll (`run-records` stream, its first consumer) picks the run's vault offer; boss canon relics drop only while undiscovered; death/escape routes an artifact into the Hall record's heirloom slot with priority over ordinary selection; recovery rides the existing champion heirloom materialization.

**Tech Stack:** TypeScript 5.8 ESM, Zod strict schemas, Vitest 3.2, npm workspaces (`@woven-deep/content`, `@woven-deep/engine`, `@woven-deep/session-core`, server, web).

**Spec:** `docs/superpowers/specs/2026-07-31-legendary-artifacts-design.md` — read before starting any task.

## Global Constraints

- **Determinism is the product.** No Math.random/Date.now/floats in engine code; every roll threads `Uint32State`; the `run-records` stream ordering is: offer roll at run creation (first consumer), artifact-priority-or-ordinary heirloom roll at finalize (exactly one of the two rolls per record, never both).
- **Singleton invariant:** an artifact is never simultaneously placeable-virgin and recoverable-from-a-champion. Asserted in ledger tests and repository writes.
- **Undiscovered artifacts never require fighting an Echo/Champion** — virgin routes are boss drops and the vault offer only.
- **Hidden fields:** `offeredArtifact` and `artifactsUndiscovered` never reach any projection.
- **Schema bumps:** content v9→v10 (Task 1, with migration notes — the versioned-note admin-docs test from #138 enforces the note); save v12→v13 (Task 5, frozen `legacyActiveRunV12Schema` + one ordered migration). No other task touches schema versions.
- **Demo hashes:** will drift starting Task 5 (new run fields) — do NOT re-pin mid-plan; demo/CLI suites are expected-red between Task 5 and Task 13, which re-pins once with per-fixture attribution. Per-task gates run targeted suites.
- **Build gotcha:** rebuild before content-dependent engine runs: `npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/engine`.
- **GitNexus:** `impact` before modifying existing functions; `detect_changes` before commits. **Prettier** every touched file. **Commits:** conventional, lowercase, no scope. **TDD RED-first** everywhere.
- Branch: `feat/artifacts`. Do not push until Task 13.

## File Map

| Unit | Files | Responsibility |
| --- | --- | --- |
| Content artifact block | `packages/content/src/{compiler/schema/item.ts, model/item.ts, model/common.ts, compiler/validation/*}` | v10 schema, `artifact` block, compile rules (Task 1) |
| Roster | `content/items/*.yaml`, `content/spells/` refs | 7 promotions + 2 new + Maria's Grace (Task 2) |
| Ledger core | `packages/engine/src/artifact-ledger.ts` (NEW) | types, empty, reconcile, apply — pure (Task 3) |
| Repositories | `packages/engine/src/run-record-repository.ts`, `apps/web/src/session/run-records-storage.ts`, `apps/server/src/db/hall-repository.ts` | `artifactLedger()`/`applyArtifactDeltas()` ×3 (Task 4) |
| Save v13 | `packages/engine/src/{versions.ts, model.ts, save-schema/*, save-codec.ts}` | `offeredArtifact` + `artifactsUndiscovered` (Task 5) |
| Run creation | `packages/engine/src/new-run.ts` | records input, offer roll, fallen-hero decisions (Task 6) |
| Hosts | `apps/server/src/play/play-session.ts`, `apps/web/src/session/guest-session.ts`, `apps/web/src/App.tsx` | standings + ledger wiring (Task 7) |
| Finalize | `packages/engine/src/{run-finalize.ts, heirloom-selection.ts, inventory.ts}` | artifact deltas, priority selection, recovery fix (Task 8) |
| Placement | `packages/engine/src/{boss-behavior.ts, population-placement.ts}`, `content/vaults/*` | boss gate + vault offer slot (Task 9) |
| Maria's Grace mechanics | `packages/engine/src/{survival.ts, actions.ts, equipment.ts, boss-behavior.ts, commands-model.ts, save-schema/primitives.ts}`, `apps/web/src/session/event-log.ts` | fuelless + inextinguishable (Task 10) |
| Drawbacks | `packages/engine/src/equipment.ts` | equipped drawback modifiers (Task 11) |
| Client | `apps/web/src/ui/{screens/HallScreen.tsx, overlays/DetailPane.tsx}` + helpers | gold styling, provenance, Relics panel (Task 12) |
| Endgame | fixtures + docs | re-pin, root gate, PR (Task 13) |

**Spec amendment recorded here (per amend-before-deviating):** provenance *stints* are resolved client-side from the repository's `artifactLedger()` (keyed by the item's contentId), not threaded through `ItemView` — the engine never holds the ledger, so extending `ItemView.provenance` with stints is impossible without leaking repository state into projections. `ItemView` keeps only the existing `originatingHallRecordId`. Amend the spec's Client section accordingly in Task 12's commit.

---

### Task 1: Content v10 — the `artifact` block

**Files:**
- Modify: `packages/content/src/model/common.ts:20` (`CONTENT_SCHEMA_VERSION = 10`), `packages/content/src/compiler/schema/item.ts` (block schema), `packages/content/src/model/item.ts` (TS mirror), `packages/content/src/compiler/schema/balance.ts:73-75` (`generation.artifactOfferPercent`), `packages/content/src/model/balance.ts` (mirror), the duplicated balance literals (grep `doorTilePercent`), a new validation pass in `packages/content/src/compiler/validation/` (follow the loot/vault validators' file pattern)
- Modify: every `schemaVersion: 9` envelope → 10 (sed sweep; watch for the engine save-schema's own literals as in past bumps), `docs/server-admin/content-configuration.md` (artifact block reference, v10 migration note, balance knob row)
- Test: `packages/content/test/parse-file.test.ts` + the validation suite

**Interfaces — Produces (later tasks rely on exactly these):**

```ts
// model/item.ts
export interface ArtifactSignatureDefinition {
  readonly spellId: ContentId;
  readonly charges: number;          // safePositive
  readonly rechargePerFloor: number; // safeNonNegative, <= charges enforced
}
export interface ArtifactLightDefinition {
  readonly fuelless: boolean;
  readonly inextinguishable: boolean;
}
export interface ArtifactDefinition {
  readonly canon: true;
  readonly signature: ArtifactSignatureDefinition | null;
  readonly drawbackModifiers: Readonly<Record<string, number>>; // DerivedStatName keys, values < 0; may be empty ONLY when light.inextinguishable
  readonly light: ArtifactLightDefinition | null;
}
// ItemContentEntry gains: readonly artifact: ArtifactDefinition | null;
```

Also produce a helper in the content package (beside `guaranteedUniqueItemIds`-style helpers or in the engine, wherever the sibling lives — check `commerce.ts:169`): `artifactItemIds(pack): ReadonlySet<OpaqueId>` and `artifactById(pack, contentId): ArtifactDefinition | null`. Balance: `generation.artifactOfferPercent: 12` (int 0..100), added to YAML + zod + model + all duplicated literals + docs (knob-name test).

- [ ] **Step 1: Failing tests** — item with a valid `artifact` block compiles; violations each produce a named diagnostic: artifact without `rarity: legendary`; `stackLimit != 1`; `identification.mode != known`; no signature AND no combat block; no drawback and not inextinguishable-light; positive value in `drawbackModifiers`; unknown derived-stat key; `signature.spellId` not resolving; `artifact.light` present while item `light` is null; artifact contentId appearing in any loot-table choice (extend the loot validator's exclusion the way boss uniques are excluded — see `docs/server-admin/content-configuration.md:700` rule). Write each as a real test case in the content suite's established style.
- [ ] **Step 2: Run, confirm FAIL** (unrecognized `artifact` key under strictObject).
- [ ] **Step 3: Implement** — zod block (strictObject, `.nullable()` default null? No: OPTIONAL-and-normalized-to-null following how other optional item blocks are handled — copy `light: itemLight.nullable()`'s pattern: `artifact: itemArtifact.nullable()` with YAML authoring `artifact: null` NOT required on existing items… verify how nullable-vs-optional works for existing items: if `light` is required-nullable, every item YAML says `light: null`; then artifact must follow the same convention and the sweep adds `artifact: null` to every item — check one item YAML and match the existing convention exactly; if that means touching all item files, fold it into the schemaVersion sweep). TS mirrors; the validation pass; the balance knob everywhere; `CONTENT_SCHEMA_VERSION = 10`; envelope sweep; docs + v10 migration note ("v10 adds the optional item `artifact` block and the balance `generation.artifactOfferPercent` knob").
- [ ] **Step 4: Run** content workspace tests + `npm run content:validate` + root typecheck. PASS.
- [ ] **Step 5: Commit** — `feat: content schema v10 with the artifact block`.

---

### Task 2: Roster content

**Files:**
- Modify: `content/items/champion-and-boss-rewards.yaml`, `deep-relics.yaml`, `heart-boss-rewards.yaml`, `milestone-boss-rewards.yaml` (artifact blocks on the 7 relics)
- Create: `content/items/artifacts.yaml` (2 new vault artifacts + Maria's Grace)

**Interfaces — Produces:** content ids `item.marias-grace`, `item.wardens-lantern`… no — exact new ids: `item.marias-grace`, `item.thread-counts-needle`, `item.last-cartographers-compass` (vault pool). Task 9 references the vault pool = every artifact item NOT referenced by any boss `uniqueItemId`.

- [ ] **Step 1: Author the blocks.** All artifacts: `rarity: legendary`, `stackLimit: 1`, `identification: { mode: known, poolId: null }`, `heirloomEligible: true` (the recovery path requires it — Task 8 excludes artifacts from ORDINARY selection instead). Boss relics (signatures chosen from the real spell list; drawbacks negative derived stats):
  - Warden's Ember: signature `spell.ember-bolt` charges 3 recharge 1; drawback `{ defense: -1 }`.
  - The Ashfather's Cinder: `spell.cinder-breath` 2/1; `{ maxWeave: -2 }`.
  - The Drowned Crown: `spell.frost-nova` 2/1; `{ weaveRegen: -1 }`.
  - The Herald's Sigil: `spell.static-field` 3/1; `{ meleeAccuracy: -1 }`.
  - Cinder of the Freed Heart: `spell.fireball` 2/1; `{ maxHealth: -3 }`.
  - Bound Signet: `spell.weave-shield` 2/1; `{ search: -1 }`.
  - Echo Heartstone: `spell.enervate` 3/1; `{ defense: -1 }`.
  - Thread-Count's Needle (new, `category: ring`, glyph `=`, color `#c9d6a3`): `spell.chain-spark` 3/1; `{ maxHealth: -2 }`; combat `{ accuracy: 1, defense: 0, armor: 0 }`.
  - The Last Cartographer's Compass (new, `category: ring`, glyph `=`, color `#8fb0c9`): `spell.recall` 1/0; passive combat `{ accuracy: 0, defense: 1, armor: 0 }`; drawback `{ lightOutRevealRadius: -1 }`.
  - **Maria's Grace** (`category: light`, glyph `(`, color `#ffd9a0`, equipment off-hand like the brass lantern — copy `content/items/brass-lantern.yaml`'s equipment/light structure): normal `light` block (lantern-like radius/strength; `fuelCapacity`/`fuelPerTime` present per schema but rendered moot by fuelless); `artifact: { canon: true, signature: null, drawbackModifiers: {}, light: { fuelless: true, inextinguishable: true } }`; passive `combat: { accuracy: 0, defense: 1, armor: 0 }`. Description/lore in the game's voice; description mentions the light cannot be hidden.
  Every entry keeps its existing combat block and gains nothing else. minDepth: mid-band (7+) for the three vault artifacts.
- [ ] **Step 2: Validate** — `npm run content:validate` + content suite (update the bundled-count fixtures: item count +3). Boss `uniqueItemId` references unchanged.
- [ ] **Step 3: Commit** — `feat: promote the relics to artifacts and add marias grace`.

---

### Task 3: Ledger core (pure engine module)

**Files:**
- Create: `packages/engine/src/artifact-ledger.ts`, export via `packages/engine/src/index.ts` (match how run-record-repository exports)
- Test: `packages/engine/test/artifact-ledger.test.ts`

**Interfaces — Produces (verbatim, later tasks import these):**

```ts
export type ArtifactStintOutcome = 'died-with' | 'recovered' | 'escaped-with' | 'reclaimed-by-the-deep';
export interface ArtifactStint {
  readonly heroName: string;
  readonly recordId: OpaqueId;
  readonly outcome: ArtifactStintOutcome;
  readonly depth: number;
}
export interface ArtifactLedgerEntry {
  readonly artifactId: OpaqueId;
  readonly status: 'undiscovered' | 'lost';
  readonly holderRecordId: OpaqueId | null; // non-null iff status === 'lost'
  readonly provenance: readonly ArtifactStint[];
}
export type ArtifactLedger = readonly ArtifactLedgerEntry[]; // sorted by artifactId
export interface ArtifactDeltas {
  readonly recordId: OpaqueId; // idempotence key
  readonly stints: readonly Readonly<{ artifactId: OpaqueId; stint: ArtifactStint; newStatus: 'undiscovered' | 'lost'; holderRecordId: OpaqueId | null }>[];
}
export function emptyArtifactLedger(): ArtifactLedger; // []
export function undiscoveredArtifactIds(ledger: ArtifactLedger, allArtifactIds: ReadonlySet<OpaqueId>): readonly OpaqueId[]; // ids absent from ledger OR status undiscovered, sorted
export function applyArtifactDeltas(ledger: ArtifactLedger, deltas: ArtifactDeltas): ArtifactLedger; // pure; unknown artifactIds create entries
export function reconcileArtifactLedger(input: Readonly<{ ledger: ArtifactLedger; standings: readonly FallenHeroStandingSnapshot[]; lifetime: LifetimeState }>): ArtifactLedger;
```

Reconcile rule: every `lost` entry whose `holderRecordId` is not among `standings.map(s => s.hallRecordId)` OR is in `lifetime.conqueredChampionRecordIds` flips to `undiscovered` with a `reclaimed-by-the-deep` stint (heroName from the entry's last stint, depth 0, recordId = holderRecordId). Idempotent: reconciling twice equals once (the flipped entry no longer matches). NOTE the conquered case: conquest with pickup produces a NEW `died-with`/`escaped-with` delta from the recovering run's finalize BEFORE reconcile ever sees the stale holder — order of operations in Task 4 makes deltas apply first, then reconcile; a conquered-and-picked-up artifact therefore has a new holder and never matches.

- [ ] **Step 1: Failing tests** — apply/reconcile/idempotence/singleton: (a) apply creates entries for unknown ids; (b) same recordId applied twice = once (Task 4 enforces at the repo; here applyArtifactDeltas is pure — assert determinism/shape only); (c) reconcile flips standings-evicted holders and conquered-unlooted holders, appends the stint, and is idempotent; (d) singleton: for any sequence of applies+reconciles, no entry is ever `lost` with null holder or `undiscovered` with non-null holder (property-style test over a scripted scenario); (e) `undiscoveredArtifactIds` merges absent + undiscovered, sorted.
- [ ] **Step 2: FAIL** (module missing). **Step 3: Implement** (pure, sorted outputs, checked integers only). **Step 4: PASS** engine test. **Step 5: Commit** — `feat: add the artifact ledger core`.

---

### Task 4: Repository surface (×3 + parity)

**Files:**
- Modify: `packages/engine/src/run-record-repository.ts` (interface + in-memory), `apps/web/src/session/run-records-storage.ts` (persisted shape + migrate), `apps/server/src/db/hall-repository.ts` (replay envelope)
- Test: engine repo suite, web storage suite, server repo suite + one shared parity scenario

**Interfaces — Produces:** `RunRecordRepository` gains:

```ts
  artifactLedger(): ArtifactLedger;
  applyArtifactDeltas(deltas: ArtifactDeltas): void; // idempotent by recordId; runs reconcileArtifactLedger(standings, lifetime) after applying
```

Reconcile also runs inside `appendRecord` (standings may change there). In-memory: store ledger + applied-artifact-recordId set. Guest: `PersistedHallState` gains `artifactLedger: ArtifactLedger` and `appliedArtifactRecordIds: readonly OpaqueId[]`; bump `HALL_STORE_VERSION` to 2 with a migrate step defaulting both (`migratePersistedState`), and teach `isValidPersistedState` the new keys. Server: extend the stored applied-delta envelope so `lifetime()`-style replay derives the ledger through the in-memory repo (per the header-comment strategy at `hall-repository.ts:33-49`); `lifetime_json` envelope change only — no DB DDL migration.

- [ ] **Step 1: Failing tests** — per repo: ledger empty initially; applyArtifactDeltas idempotent by recordId; reconcile runs on append (scenario: record holding artifact appended, 10 better records appended → holder evicted → ledger shows undiscovered). Parity: one scripted scenario (find → die-with → recover → evict) driven against in-memory, guest (fake storage), and server (temp sqlite, follow the existing server repo test harness) asserting deep-equal final ledgers.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** all three suites. **Step 5: Commit** — `feat: persist the artifact ledger in every records repository`.

---

### Task 5: Save v13 — `offeredArtifact` + `artifactsUndiscovered`

**Files:**
- Modify: `packages/engine/src/versions.ts:1` (13), `packages/engine/src/model.ts:177` area (two fields beside `fallenHeroStandings`), `packages/engine/src/save-schema/run-record.ts:117-123` (schema) + semantic checks near `:968-1035`, `packages/engine/src/save-schema/migrations.ts` (frozen `legacyActiveRunV12Schema` — snapshot of today's literal per the V10/V11 precedent at `:577,619`), `packages/engine/src/save-codec.ts` (migrateV12ToV13 + chain + gate), `packages/engine/src/new-run.ts:310` (initialize both: `offeredArtifact: null`, `artifactsUndiscovered: []` — Task 6 fills them)
- Test: `packages/engine/test/save-codec.test.ts`

**Interfaces — Produces:** `ActiveRun` gains `readonly offeredArtifact: OpaqueId | null;` and `readonly artifactsUndiscovered: readonly OpaqueId[];` (sorted). Migration: `{ ...v12, schemaVersion: 13, offeredArtifact: null, artifactsUndiscovered: [] }` — migrated mid-run saves offer and drop nothing (spec-sanctioned). Semantic checks: `offeredArtifact`, when non-null, must be a member of `artifactsUndiscovered`; both hidden (assert nothing projects them — extend the projection test that guards hidden fields if one exists, else add the assertion to the projection suite).

- [ ] **Step 1: Failing tests** — v12 payload (current save minus the two fields, schemaVersion 12) decodes with the defaults; round-trip byte-equality via the established downgrade pattern (see the v11 test at `save-codec.test.ts:1045+`); semantic rejection of `offeredArtifact` not in `artifactsUndiscovered`; projection never exposes either field.
- [ ] **Step 2: FAIL. Step 3: Implement** in the #138-proven order: freeze `legacyActiveRunV12Schema` FIRST, then bump, then migrate + widen the `migrateLegacy` union and gate. **Step 4: PASS** save-codec + engine suite (demo suites go red HERE — expected until Task 13). **Step 5: Commit** — `feat: save schema v13 with hidden artifact run fields`.

---

### Task 6: Run creation — records input + offer roll + fallen-hero decisions

**Files:**
- Modify: `packages/engine/src/new-run.ts:167-173` (input), `:192-201` (roll ordering), `:310-312` (fields)
- Test: `packages/engine/test/new-run.test.ts`

**Interfaces — Produces:**

```ts
createNewRun(input: Readonly<{
  pack; seed; hero;
  records?: Readonly<{
    standings: readonly FallenHeroStandingSnapshot[];
    undiscoveredArtifactIds: readonly OpaqueId[];
    conqueredChampionRecordIds: readonly OpaqueId[];
  }>;
}>): ActiveRun
```

Omitted `records` = empty everything (all existing tests/fixtures unchanged). With records: `fallenHeroStandings` = input (max 10), `conqueredChampionRecordIds` = input, `fallenHeroDecisions` = `createFallenHeroRunDecisions(...)` exactly as `population-fixture.ts:253` does (same stream, same argument shape — read it and mirror; `impact` on it first). `artifactsUndiscovered` = sorted `undiscoveredArtifactIds` filtered to ids that exist in the pack with an artifact block. Offer roll — FIRST consumer of `rng['run-records']`, before anything else touches it (extraction confirms nothing does today at creation): let `pool` = vault-pool artifacts (undiscovered ∧ not any boss `uniqueItemId`); if `pool.length > 0`, roll `rollDie(state, 100) <= balance.generation.artifactOfferPercent`, and on success roll `rollDie(state, pool.length)` to pick; thread the state back into `rng['run-records']`. Zero pool → NO rolls consumed (mirror `selectHeirloom`'s zero-candidate discipline). `offeredArtifact` = the pick or null.

- [ ] **Step 1: Failing tests** — omitted records: byte-identical run to today (encode equality against a pre-change fixture expectation); with records: standings/decisions populated (decisions parity with the fixture's shape), artifactsUndiscovered sorted+filtered; offer roll determinism (fixed seed → same offer), zero-pool consumes no run-records state (stream equality), percent-0 never offers, percent-100 with pool always offers; offered id ∈ pool.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** engine (non-demo). **Step 5: Commit** — `feat: seed runs with hall standings and an artifact offer`.

---

### Task 7: Host wiring (the standings activation)

**Files:**
- Modify: `apps/server/src/play/play-session.ts:212` (pass records from `this.hallRepo`), `apps/web/src/session/guest-session.ts:215-217` + constructor (accept a records provider), `apps/web/src/App.tsx` (pass from `useHallRepository`'s repo where GuestSession is constructed — find both construction sites incl. quickstart)
- Test: server play-session suite, web guest-session suite

**Interfaces — Consumes:** Task 6's `records` input; repository methods from Task 4. Guest: constructor gains `records?: () => Readonly<{ standings; undiscoveredArtifactIds; conqueredChampionRecordIds }>` (a thunk so each `freshRun` reads current state, not construction-time state). Server: build the same object from `this.hallRepo.standings(10)`, `undiscoveredArtifactIds(this.hallRepo.artifactLedger(), artifactItemIds(this.pack))`, `this.hallRepo.lifetime().conqueredChampionRecordIds` at the `createNewRun` call site.

- [ ] **Step 1: Failing tests** — server: a play-session test seeding the repo with a died-at-depth-3 record asserts the created run carries the standing AND (production-shaped assertion from the spec) descending to depth 3 yields a champion population — reuse the engine's champion test fixtures for the record shape. Guest: constructing GuestSession with a records thunk yields runs carrying standings; `freshRun` after a finalize reads UPDATED standings (thunk, not snapshot).
- [ ] **Step 2: FAIL. Step 3: Implement** (App.tsx wiring included; check quickstart path). **Step 4: PASS** server + web suites + typecheck. **Step 5: Commit** — `feat: feed hall standings and the artifact ledger into new runs`.

---

### Task 7b: Champion placement substrate (plan amendment, added mid-execution)

_Task 7's implementation surfaced a load-bearing gap: `placeFallenHeroEncounters` spawns champions only into vault slots tagged `side-arena`/`fallen-hero`/`champion`, and NO shipping vault authors one — champions (and therefore artifact recovery) can never occur in play. Same failure shape as the locked-door substrate gap (#132)._

**Files:**
- Modify: `packages/engine/src/champion.ts` (`placeFallenHeroEncounters` placement fallback)
- Modify: `content/vaults/` — add optional `fallen-hero`-tagged slots to two or three vaults spread across depth bands
- Test: champion placement suite

**Design (binding):** slot-preferred, fallback-guaranteed. When the death-depth floor offers a tagged slot, use it exactly as today. When it does not, fall back to a deterministic open-cell placement: the same constraint envelope the floor-loot pass uses (walkable, off protected routes, outside vault footprints, ≥ the anchor distance from stairs), row-major deterministic pick (NO new randomness — first qualifying cell, or thread the population-gates stream if a roll already exists in this path; keep stream discipline identical to the slot path). A champion whose floor genuinely has no qualifying cell skips exactly as an absent slot does today. Result: "the Deep remembers" is reliable, vault arenas remain the premium presentation.

- [x] **Step 1: Failing test** — a run with a rank-1 standing at depth N and NO tagged slot on that floor still places the champion (open-cell fallback, all constraints asserted); with a tagged slot, placement is byte-identical to today; determinism across identical inputs.
- [x] **Step 2: FAIL. Step 3: Implement** (fallback + the two/three authored vault slots). **Step 4: PASS** engine non-demo + content:validate. **Step 5: Commit** — `fix: guarantee champion placement with an open-cell fallback`.

---

### Task 8: Finalize — artifact deltas + priority selection + recovery fix

**Files:**
- Modify: `packages/engine/src/heirloom-selection.ts` (artifact-priority variant + ordinary-path exclusion), `packages/engine/src/run-finalize.ts:128-211` (deltas + call), `packages/engine/src/inventory.ts:515-545` (`recordedHeirloomContentId` artifact branch)
- Test: `packages/engine/test/heirloom-selection.test.ts`, `run-finalize` suite, champion/inventory suites

**Interfaces — Produces:** `finalizeRun` return gains `artifactDeltas: ArtifactDeltas`. New `selectRecordHeirloom(input + heldArtifactIds)` wrapper in heirloom-selection.ts: if the hero holds ≥1 artifact (equipped OR backpack — wider than the ordinary equipped-only filter), weighted-roll among ONLY the artifacts (equal weights, `rollDie` on `run-records`, single roll, none when exactly one) and build the snapshot from that instance; otherwise delegate to `selectHeirloom` unchanged (whose candidate filter now ALSO excludes artifact ids — extend the `uniques` exclusion with `artifactItemIds(content)` so an artifact never wins the ordinary roll). `ArtifactDeltas` built in finalize: chosen artifact → stint `died-with` (or `escaped-with` when `completionType !== 'died'` — check the real completion field on the conclusion), newStatus `lost`, holder = recordId; every OTHER held artifact → `reclaimed-by-the-deep`, `undiscovered`, holder null. No artifacts held → empty stints. **Recovery fix (the sharpest hazard):** `recordedHeirloomContentId` gains an artifact branch — when `artifactById(content, recorded.contentId)` is non-null, skip the `equippedItemContentIds` membership requirement (a backpack-held artifact never appears in the build snapshot's equipped list) while keeping the existence/equipment/fuel/modifier compatibility checks, so a recovered artifact materializes as itself, never the fallback relic.

- [ ] **Step 1: Failing tests** — artifact equipped → becomes the record heirloom (ordinary roll never runs: stream state shows exactly the expected consumption); artifact in BACKPACK only → still selected; two artifacts → one chosen by roll, other's delta is reclaimed; no artifacts → ordinary selection byte-identical to today (stream equality against pre-change expectation); ordinary selection can never pick an artifact even when equipped-and-eligible (weight exclusion); escape-with-artifact → `escaped-with` stint, status lost; recovery: a `RecordedHeirloomSnapshot` of a backpack-held artifact materializes as the artifact (NOT `item.champion-fallback-relic`) via `createRecordedHeirloom`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** engine non-demo. **Step 5: Commit** — `feat: route held artifacts through the hall record with priority`.

---

### Task 9: Placement — boss gate + vault offer

**Files:**
- Modify: `packages/engine/src/boss-behavior.ts:423-455` (gate), `packages/engine/src/population-placement.ts:497-535` (`fillItemSlots` artifact-tag branch)
- Modify: `content/vaults/` — add an OPTIONAL `artifact`-tagged item slot (`required: false`, `tags: [artifact]`, `lootTableId: null`, `contentId: null`) to two existing deep vaults (pick deep-band vaults, e.g. `deep-antechamber` and one other ≥ mid-band; verify their depth bands)
- Test: boss-behavior suite, population-placement suite, content validate

**Interfaces — Consumes:** `run.artifactsUndiscovered`, `run.offeredArtifact` (Task 5/6). Boss gate: in `createRewards`, pass `uniqueContentId`/`uniqueItemId` as `null` when `input.definition.uniqueItemId` has an artifact block AND is not in `input.state.artifactsUndiscovered` (`createPopulationLoot` accepts both-null per `inventory.ts:408-413`; non-artifact uniques unaffected). Vault: in `fillItemSlots`, BEFORE the lootTableId/contentId branch: slot (either the floor slot's or authored slot's) `tags` includes `'artifact'` → if `run.offeredArtifact === null` skip the slot silently; else `createFloorItem` with the offered artifact contentId (id prefix `item.artifact-offer.${slot.slotId}`), full condition, identified; consume NO randomness; clear the offer for the rest of the run by… the run is immutable mid-placement — enforce one-per-run instead by materializing only the FIRST artifact-tagged slot encountered per RUN: guard on an existing `item.artifact-offer.` instance anywhere in `run.items` (cheap scan, deterministic). Vault-validation from Task 1 must permit the both-null + artifact-tag combination (item slots currently throw on both-null — the new branch runs before that throw; also relax the authoring-side validator if it enforces the same).

- [ ] **Step 1: Failing tests** — boss with undiscovered artifact relic drops it (unchanged); boss whose relic is NOT in `artifactsUndiscovered` drops loot only, no unique instance; non-artifact unique unaffected regardless; vault slot materializes the offered artifact once (second artifact-tagged slot in the same run yields nothing); no offer → slot skipped without throwing; zero randomness consumed either way (loot-placement stream equality).
- [ ] **Step 2: FAIL. Step 3: Implement + author the two vault slots. Step 4: PASS** engine non-demo + content:validate. **Step 5: Commit** — `feat: gate boss relics on discovery and place the vault offer`.

---

### Task 10: Maria's Grace mechanics — fuelless + inextinguishable

**Files:**
- Modify: `packages/engine/src/survival.ts:136-193` (`consumeFuel` skip), `packages/engine/src/actions.ts:814-829` (toggle validation refusal), `packages/engine/src/commands-model.ts` + `packages/engine/src/save-schema/primitives.ts` (new invalid reason `'light.inextinguishable'` — live lists only), `packages/engine/src/boss-behavior.ts:157-175` (effect.light.toggle honors the refusal by skipping the item), `apps/web/src/session/event-log.ts` (line: `The Grace will not be hidden.` — generic wording: `Its light will not be hidden.`)
- Test: survival suite, actions suite, web event-log test

**Interfaces — Consumes:** `artifactById(pack, contentId)` (Task 1). Fuelless: inside `consumeFuel`'s item loop, after the `light` lookup, `if (artifactById(content, item.contentId)?.light?.fuelless) continue;` — no drain, no warning, no auto-extinguish (hazard note: the loop currently requires `(fuel ?? 0) > 0`; a fuelless artifact's instance fuel is set at creation from `fuelCapacity` and never decreases, so it stays lit; ALSO ensure `enabled` isn't forced off at `:182` for it). Inextinguishable: in `actions.ts` toggle validation, when the item is currently `enabled === true` and `artifact.light.inextinguishable`, return `{ status: 'invalid', reason: 'light.inextinguishable' }` — LIGHTING it stays legal (heirloom materialization creates it doused, extraction §7). Add the reason to the commands-model union + the live blockReason/invalid-reason list in primitives (frozen legacies untouched — the #135/#140 precedent). Boss path: dousing effects skip inextinguishable items silently.

- [ ] **Step 1: Failing tests** — lit Maria's Grace across N world-steps: fuel unchanged, still enabled, no `fuel.warning`/`item.light-extinguished` events; toggle-off → invalid `light.inextinguishable`; toggle-on from doused → applied; ordinary lantern behavior byte-identical; boss douse effect leaves it lit; event-log renders the line.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** engine non-demo + web. **Step 5: Commit** — `feat: marias grace burns without fuel and will not be hidden`.

---

### Task 11: Drawback application

**Files:**
- Modify: `packages/engine/src/equipment.ts:171-200` (`equipmentModifiers`)
- Test: stats/equipment suite

**Interfaces — Consumes:** `ItemContentEntry.artifact.drawbackModifiers` (Task 1). Fold into `base` (BEFORE the enchantment loop) so drawbacks appear in `publicModifiers` even pre-identification — artifacts are always identified, but the base-fold is the reviewer-visible guarantee. Equipped items only (per extraction §10 — the character sheet path); note in the code comment that carried-but-unequipped artifacts contribute nothing (spec's "carried-or-equipped" wording resolves to equipped-only because `equipmentModifiers` is the sole stat path — record this as a spec amendment note in the commit body).

- [ ] **Step 1: Failing test** — hero equipping an artifact with `{ defense: -1, maxHealth: -3 }` shows those deltas in derived stats and in `publicModifiers`; unequipping removes them; a non-artifact item unchanged.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit** — `feat: apply artifact drawbacks while equipped`.

---

### Task 12: Client — styling, provenance, Relics panel

**Files:**
- Modify: `apps/web/src/ui/overlays/DetailPane.tsx` (+ `inventory-model.ts` / `item-facts.ts` as needed): artifact name in gold (existing accent style — find the HUD gold-count style and reuse its token), provenance block, hide the fuel gauge for fuelless artifacts (pack lookup by contentId — the client owns the pack)
- Modify: `apps/web/src/ui/screens/HallScreen.tsx` — "Relics of the Deep" panel reading `repository.artifactLedger()`: held/lost artifacts by display name + last stint line; undiscovered as a count only
- Modify: the spec's Client section (the recorded amendment: stints resolved client-side from the ledger)
- Test: web unit suites for the touched components; visual proof

**Interfaces — Consumes:** `repository.artifactLedger()` (Task 4); item entries' `artifact` block via the pack. Provenance line format: `Borne by <heroName> — <outcome text> at depth <depth>` with outcome text map: died-with → `fell`, recovered → `reclaimed it`, escaped-with → `carried it out`, reclaimed-by-the-deep → `the Deep took it back`.

- [ ] **Step 1: Implement + unit tests** (inventory-model/DetailPane render cases; HallScreen panel with a seeded fake repository).
- [ ] **Step 2: Visual proof (mandatory, controller verifies screenshots personally):** build + run server & vite dev; Playwright: seed a guest ledger via the browser session (or play until an artifact drops with a doctored high `artifactOfferPercent` in a local content override — simplest: temporarily set the knob to 100 via `--content-dir` on a copied content tree for the SERVER run, without committing), screenshot (a) an artifact's inspect pane with gold name + provenance + no fuel gauge for Maria's Grace, (b) the Hall Relics panel. Save to /Users/frode.hus/.claude/jobs/baeb3eac/tmp/ as t12-inspect.png, t12-hall.png. State in words what each shows.
- [ ] **Step 3: PASS** web suite + typecheck; prettier. **Step 4: Commit** — `feat: show artifact provenance and the relics panel`.

---

### Task 13: Re-pin, root gate, PR

- [ ] **Step 1:** Rebuild content+engine; run every demo; per-fixture drift attribution (expected causes: content hash v10 + roster; save v13 fields; run-records stream offer roll in runs with artifact pools — note the DEMO packs may have no artifacts, in which case the offer roll consumes nothing and only content-hash/save-shape drift appears; anything else = STOP/BLOCKED).
- [ ] **Step 2:** Re-pin once (`chore: re-pin demo hashes for the artifact ledger`), attributions in the body.
- [ ] **Step 3:** Root gate: `npm test`, `npm run typecheck`, `npm run smoke` — all green.
- [ ] **Step 4:** `detect_changes({scope:"compare", base_ref:"main"})`; push `feat/artifacts`; PR (`feat: legendary artifacts with provenance and circulation`, body: closes #124, spec link, amendment notes, screenshots described, the standings-activation callout); `gh pr merge --squash --auto`.
