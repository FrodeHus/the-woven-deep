# Dungeon NPCs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Milestone 4B2 as deterministic YAML-authored travelling merchants with finite stock, currency, transactions, identification, faction reputation, global departure, self-preservation, stock loss, and hidden-state-safe replay.

**Architecture:** Extend the existing encounter discriminated union with a merchant model backed by reusable NPC and faction content. Materialize merchant inventory and service uses once into schema-v5 run state, resolve commerce through a revision-only modal command path, and reuse 4B1 placement, perception, pathfinding, relationships, events, and projections. Keep pricing, reputation, stock transfer, lifecycle deadlines, and behavior in focused browser-safe engine modules.

**Tech Stack:** TypeScript 5.8+, Node.js 22.12+, Zod 4, YAML 2.8, ROT.js 2.2.1 through the existing adapter, Vitest 3.2, fast-check 4.8.0, Docker Compose.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-14-dungeon-npcs-design.md`; amend and reapprove the design before changing an approved rule.
- Keep the engine browser-safe. It must not import React, Fastify, SQLite, browser storage, Node-only APIs, wall clocks, ambient randomness, or profile repositories.
- Preserve `resolveCommand` as a pure immutable boundary. Every consequential roll uses a named saved random stream.
- Advance source and compiled content schema v3 to v4 and active-run save schema v4 to v5.
- Provide exactly one ordered v4-to-v5 save migration: initialize currency to zero, reputation to `[]`, active trade to `null`, and retain every existing v4 field exactly.
- New runs obtain non-negative safe-integer `startingCurrency` from the single balance entry. Currency and reputation end with the current hero.
- Reuse encounter gates, eligibility, instance limits, placement, actors, intent, perception, pathfinding, scheduling, save/replay, and projection. Do not build a parallel NPC runtime.
- Roll merchant lifetime, stock, and service uses once with a saved `merchant-stock` stream. Never refresh them on re-entry, trade, reputation change, or load.
- Successful trade commands advance revision only. They do not advance turn, world time, actor energy, hunger, fuel, or any actor turn.
- While a trade is active, reject every non-trade player command. Store at most one active trade.
- Keep opportunity reactions hostile-only. Neutral actors remain unaffected until an explicit relationship override makes them hostile.
- Prices use checked integer basis-point arithmetic: purchases and services round up, sales round down, and positive purchase/service results cost at least one.
- Trade failures are atomic and consume no randomness. One merchant can grant each commerce, aggression, death, and stock-loss consequence at most once.
- Global departure applies on inactive floors without simulating off-floor actor turns. A merchant never departs during an active trade.
- Hidden projection never reveals unseen merchants, exact deadlines outside trade, unopened stock, service rolls, random state, paths, flee targets, future drops, gate rolls, or undiscovered item properties.
- Every task follows RED/GREEN TDD, runs its focused tests, ends with a focused commit, and receives review before the next task.

## File and Responsibility Map

### Content platform

- `packages/content/src/model.ts`: schema-v4 NPC, faction, merchant encounter, service-offer, and starting-currency public types.
- `packages/content/src/compiler/schema.ts`: strict source YAML schemas and local range refinements.
- `packages/content/src/compiler/registries.ts`: closed NPC behavior, aggression response, and merchant-service registries.
- `packages/content/src/compiler/content-validation.ts`: faction coverage, encounter references, transferable stock graph, price, threshold, and service validation.
- `packages/content/src/content-schema.ts`: strict compiled-pack schema-v4 validation.
- `packages/content/src/compiler/compile-directory.ts`: schema-v4 output and stable hash input.
- `content/npcs/travelling-lampwright.yaml`: bundled reusable merchant actor.
- `content/npc-factions/lampwrights.yaml`: bundled reputation bounds and tiers.
- `content/encounters/travelling-lampwright.yaml`: production merchant encounter.
- `content/loot-tables/travelling-lampwright-stock.yaml`: finite depth-appropriate merchant stock.
- `content/balance/core-gameplay.yaml`: starting hero currency.

### Engine state, persistence, and generation

- `packages/engine/src/merchant-model.ts`: reputation records, trade session, lifecycle types, merchant helpers, and closed trade reason types.
- `packages/engine/src/population-model.ts`: `MerchantPopulation` in the population union.
- `packages/engine/src/model.ts`: schema-v5 hero/run, trade commands, merchant events, and projections' source types.
- `packages/engine/src/item-model.ts`: merchant-stock location.
- `packages/engine/src/versions.ts`: save v5 and `merchant-stock`/`merchant-runtime` streams.
- `packages/engine/src/save-schema.ts`: strict schema-v5 state, command, event, and cross-record validation.
- `packages/engine/src/save-codec.ts`: ordered v4-to-v5 migration before v5 validation.
- `packages/engine/src/content-bound-validation.ts`: run-to-NPC/faction/merchant/service/stock invariants.
- `packages/engine/src/merchant-stock.ts`: lifetime, stock, and service-use materialization from saved RNG.
- `packages/engine/src/population-placement.ts`: merchant actor and population planning through the existing placement path.
- `packages/engine/src/floor-integration.ts`: commits merchant items and updated RNG with placed actors/populations.

### Economy and runtime behavior

- `packages/engine/src/commerce.ts`: faction lookup, clamped reputation transitions, checked quotes, and transferability policy.
- `packages/engine/src/trade.ts`: trade validation, revision-only command resolution, exact item transfer, identification, and automatic close.
- `packages/engine/src/merchant-lifecycle.ts`: warnings, global departure, held-stock removal, and transaction-safe deadline order.
- `packages/engine/src/merchant-behavior.ts`: neutral threat evaluation, flee/self-defense intent, safe movement, provocation, one-time stock loss, and death effects.
- `packages/engine/src/reducer.ts`: dispatches trade commands through the free modal path and rejects ordinary commands while active.
- `packages/engine/src/world-step.ts`: integrates lifecycle boundaries, merchant aggression, behavior turns, death, and event ordering.

### Projection, verification, and operations

- `packages/engine/src/projection.ts`: visible qualitative merchant state and exact active-trade projection.
- `packages/engine/src/event-projection.ts`: merchant event visibility and commerce event passthrough for the hero.
- `packages/engine/test/merchant-*.test.ts`: focused content-bound, stock, economy, trade, lifecycle, behavior, projection, save, and replay examples.
- `packages/engine/test/merchant-properties.test.ts`: at least 512 seeded mixed-system invariant sequences.
- `scripts/merchant-demo.mjs`: deterministic 4B2 terminal exit demonstration.
- `packages/engine/test/fixtures/merchant-demo-hashes.json`: reviewed save, event, and projection hashes.
- `docs/server-admin/content-configuration.md`: complete NPC/faction/merchant/service authoring reference.
- `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`: 4B2 completion and 4B3 pending status.
- `package.json`, `scripts/smoke-runner.mjs`, and `Dockerfile`: merchant demo release gates.

---

### Task 1: Add schema-v4 NPC, faction, and merchant content

**Files:**
- Modify: `packages/content/src/model.ts`
- Modify: `packages/content/src/compiler/schema.ts`
- Modify: `packages/content/src/compiler/registries.ts`
- Modify: `packages/content/src/compiler/content-validation.ts`
- Modify: `packages/content/src/content-schema.ts`
- Modify: `packages/content/src/compiler/compile-directory.ts`
- Modify: `packages/content/test/model.test.ts`
- Modify: `packages/content/test/parse-file.test.ts`
- Modify: `packages/content/test/compile-directory.test.ts`
- Modify: `packages/content/test/default-content.test.ts`
- Modify: `packages/content/test/admin-docs.test.ts`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `content/balance/core-gameplay.yaml`
- Modify: every existing `content/**/*.yaml` schema version
- Create: `content/npcs/travelling-lampwright.yaml`
- Create: `content/npc-factions/lampwrights.yaml`
- Create: `content/encounters/travelling-lampwright.yaml`
- Create: `content/loot-tables/travelling-lampwright-stock.yaml`

**Interfaces:**
- Consumes: schema-v3 `BaseContentEntry`, `EncounterContentEntry`, loot-table graph, monster attribute schemas, item `price`, `heirloomEligible`, and stable compiler hashing.
- Produces: `NpcContentEntry`, `NpcFactionContentEntry`, `MerchantEncounterContentEntry`, `MerchantServiceOfferDefinition`, `CONTENT_SCHEMA_VERSION === 4`, `startingCurrency`, `NPC_BEHAVIOR_PARAMETER_SCHEMAS`, and `MERCHANT_SERVICE_IDS`.

- [ ] **Step 1: Write failing public-model and parser tests**

Add exact expectations for the new kinds and merchant model:

```ts
expect(CONTENT_SCHEMA_VERSION).toBe(4);
expect(CONTENT_KIND_IDS).toEqual(expect.arrayContaining(['npc', 'npc-faction']));
expect(encounterModels).toContain('merchant');
expect(parseContentFile(validNpcYaml).entries[0]).toMatchObject({
  kind: 'npc', factionId: 'npc-faction.lampwrights', disposition: 'neutral',
  behaviorId: 'npc-behavior.travelling-merchant', selfPreservationThresholdBps: 3500,
});
```

Cover strict unknown-field rejection, neutral-only NPC disposition, positive actor stats, threshold `1..10000`, faction ID shape, and schema-v3 rejection.

- [ ] **Step 2: Run focused parser tests and verify RED**

Run: `npm test --workspace @woven-deep/content -- --run test/model.test.ts test/parse-file.test.ts`

Expected: FAIL because schema version 4 and the new discriminants do not exist.

- [ ] **Step 3: Add exact public content types and closed registries**

Implement these shapes in `model.ts` and matching strict Zod schemas:

```ts
export interface ReputationTierDefinition {
  readonly tierId: string;
  readonly name: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly purchasePriceBps: number;
  readonly salePriceBps: number;
  readonly acceptsTrade: boolean;
  readonly serviceIds: readonly MerchantServiceId[];
}

export type MerchantServiceId = 'merchant-service.identify';

export interface NpcFactionContentEntry extends BaseContentEntry {
  readonly kind: 'npc-faction';
  readonly minimumReputation: number;
  readonly maximumReputation: number;
  readonly startingReputation: number;
  readonly tiers: readonly ReputationTierDefinition[];
}

export interface NpcContentEntry extends PresentedContentEntry {
  readonly kind: 'npc';
  readonly factionId: ContentId;
  readonly attributes: BaseAttributeDefinition;
  readonly health: number;
  readonly speed: number;
  readonly perception: number;
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: DiceDefinition;
  readonly armor: number;
  readonly resistances: Readonly<Record<DamageType, number>>;
  readonly disposition: 'neutral';
  readonly behaviorId: 'npc-behavior.travelling-merchant';
  readonly behaviorParameters: Readonly<Record<string, unknown>>;
  readonly selfPreservationThresholdBps: number;
}

export interface MerchantServiceOfferDefinition {
  readonly serviceId: 'merchant-service.identify';
  readonly basePrice: number;
  readonly minimumUses: number;
  readonly maximumUses: number;
  readonly tierIds: readonly string[];
}

export interface MerchantEncounterDefinition {
  readonly npcId: ContentId;
  readonly stockLootTableId: ContentId;
  readonly minimumStockRolls: number;
  readonly maximumStockRolls: number;
  readonly merchantSaleBps: number;
  readonly merchantPurchaseBps: number;
  readonly acceptedCategories: readonly ItemCategory[];
  readonly services: readonly MerchantServiceOfferDefinition[];
  readonly minimumLifetime: number;
  readonly maximumLifetime: number;
  readonly departureWarningThresholds: readonly number[];
  readonly aggressionResponse: 'flee' | 'self-defense';
  readonly commerceReputationDelta: number;
  readonly aggressionReputationDelta: number;
  readonly deathReputationDelta: number;
  readonly stockDropFraction: number;
}
```

Add `startingCurrency: number` to `BalanceContentEntry`; add the merchant encounter variant; add closed registries for `npc-behavior.travelling-merchant`, `merchant-service.identify`, `flee`, and `self-defense`.

- [ ] **Step 4: Write failing semantic compiler tests**

Add table-driven cases for: missing faction/NPC/loot references; faction gaps or overlaps; starting reputation outside bounds; duplicate tier/service IDs; nonpositive price multipliers; warning thresholds not unique descending values below minimum lifetime; min/max inversions; service uses; service tiers absent from the faction; stock graph reaching price-zero, guaranteed-unique, quest, objective, heirloom-tagged, or nontransferable items; and merchant discovery protection defaulting to zero.

```ts
expect(() => compileFixture({ faction: tiers([{ minimum: -100, maximum: -1 }, { minimum: 1, maximum: 100 }]) }))
  .toThrow(/reputation tiers must cover every value/);
expect(() => compileFixture({ stockItem: { price: 0 } })).toThrow(/merchant stock item .* positive price/);
```

- [ ] **Step 5: Implement cross-file validation and schema-v4 pack output**

Resolve every content reference before output. Walk the complete merchant loot graph with cycle protection; reject any reachable item that has `price === 0`, is a boss unique, or carries a reserved `heirloom`, `quest`, `objective`, or `nontransferable` tag. Validate exact tier coverage by sorting tiers and requiring `first.minimum === faction.minimumReputation`, adjacent `previous.maximum + 1 === next.minimum`, and final maximum equality.

- [ ] **Step 6: Add bundled content and update all source versions**

Author the Lampwright faction with bounds `-1000..1000`, starting reputation `0`, and exact contiguous tiers: `refused` (`-1000..-251`, purchase `15000`, sale `5000`, rejects trade, no services), `wary` (`-250..-1`, purchase `13000`, sale `7000`, accepts trade, no services), `neutral` (`0..249`, purchase `11000`, sale `9000`, accepts trade and identify), and `trusted` (`250..1000`, purchase `9000`, sale `10000`, accepts trade and identify). Author one neutral travelling Lampwright with self-preservation threshold `3500`, merchant sale multiplier `12000`, merchant purchase multiplier `6000`, one-to-two stock-table resolutions, one-to-two identify uses at base price `10`, lifetime `3000..5000`, warnings `[1000, 500, 100]`, flee response, commerce delta `25`, aggression delta `-300`, hero-caused death delta `-200`, and stock-drop fraction `0.5`. Configure depth `1..10`, run appearance chance `0.25`, discovery increment/cap `0`, and maximum two instances. Set balance `startingCurrency: 40`. Change every YAML file to `schemaVersion: 4`. Document both new content kinds, the merchant encounter variant, every closed registry ID, field bound, tier-coverage rule, stock restriction, and exact bundled values; extend the admin-docs coverage test accordingly.

- [ ] **Step 7: Run content gates and verify GREEN**

Run: `npm test --workspace @woven-deep/content && npm run content:validate`

Expected: all content tests pass and validation reports a schema-v4 pack containing one NPC, one faction, and one merchant encounter.

- [ ] **Step 8: Commit content contracts**

```bash
git add packages/content content
git commit -m "feat: define dungeon merchant content"
```

---

### Task 2: Introduce schema-v5 merchant run state and v4 migration

**Files:**
- Create: `packages/engine/src/merchant-model.ts`
- Modify: `packages/engine/src/population-model.ts`
- Modify: `packages/engine/src/item-model.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/versions.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/save-codec.ts`
- Modify: `packages/engine/src/content-bound-validation.ts`
- Modify: `packages/engine/src/fixture.ts`
- Modify: `packages/engine/src/gameplay-fixture.ts`
- Modify: `packages/engine/src/population-fixture.ts`
- Modify: `packages/engine/test/model.test.ts`
- Modify: `packages/engine/test/save-codec.test.ts`
- Modify: `packages/engine/test/arbitraries.ts`

**Interfaces:**
- Consumes: schema-v4 `ActiveRun`, `PopulationInstance`, `ItemInstance`, canonical save codec, strict cross-record validation, and compiled schema-v4 content from Task 1.
- Produces: schema-v5 `ActiveRun`, `HeroState.currency`, `FactionReputation`, `ActiveTrade`, `MerchantPopulation`, merchant-stock location, `SAVE_SCHEMA_VERSION === 5`, `merchant-stock` and `merchant-runtime` RNG streams, and ordered v4 migration.

- [ ] **Step 1: Write failing model and migration tests**

Assert exact defaults and preservation:

```ts
const decoded = decodeSave(JSON.stringify(v4Fixture));
expect(decoded.schemaVersion).toBe(5);
expect(decoded.hero.currency).toBe(0);
expect(decoded.reputations).toEqual([]);
expect(decoded.activeTrade).toBeNull();
expect(stripV5Fields(decoded)).toEqual(v4Fixture);
```

Add strict v5 rejection for negative/unsafe currency, unsorted or duplicate reputation, invalid merchant lifecycle, dangling merchant stock, active-trade mismatch, missing actor/faction/encounter, inconsistent warning thresholds, negative uses, and one-time flag contradictions.

- [ ] **Step 2: Run save tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts`

Expected: FAIL because version 5 and migration do not exist.

- [ ] **Step 3: Add canonical state types**

Define and export these exact contracts:

```ts
export interface FactionReputation {
  readonly factionId: OpaqueId;
  readonly value: number;
}

export interface ActiveTrade {
  readonly merchantPopulationId: OpaqueId;
  readonly merchantActorId: OpaqueId;
  readonly openedByCommandId: OpaqueId;
  readonly openedAtRevision: number;
  readonly completedCommerce: boolean;
}

export interface MerchantServiceState {
  readonly serviceId: 'merchant-service.identify';
  readonly basePrice: number;
  readonly remainingUses: number;
  readonly tierIds: readonly string[];
}

export interface MerchantPopulation extends PopulationBase {
  readonly model: 'merchant';
  readonly actorId: OpaqueId;
  readonly npcId: OpaqueId;
  readonly factionId: OpaqueId;
  readonly rolledLifetime: number;
  readonly departureAt: number;
  readonly emittedWarningThresholds: readonly number[];
  readonly initialStockItemIds: readonly OpaqueId[];
  readonly stockItemIds: readonly OpaqueId[];
  readonly services: readonly MerchantServiceState[];
  readonly lifecycle: 'available' | 'fleeing' | 'defending' | 'departed' | 'dead';
  readonly provoked: boolean;
  readonly aggressionPenaltyApplied: boolean;
  readonly deathPenaltyApplied: boolean;
  readonly stockLossResolved: boolean;
  readonly commerceBonusApplied: boolean;
}
```

Add `{ type: 'merchant-stock'; populationId: OpaqueId }` to `ItemLocation`; add `currency` to `HeroState`; add `reputations` and `activeTrade` to `ActiveRun`; include `MerchantPopulation` in the population union; add the two RNG streams to `RNG_STREAM_NAMES`.

- [ ] **Step 4: Implement strict v5 schema and content-bound checks**

Mirror every type with strict Zod records and discriminated unions. Add cross-record passes that require sorted IDs; exactly one living merchant actor for available/fleeing/defending state; no actor or held stock for departed state; one health-zero former-member actor and no held stock for dead state; stock IDs matching merchant locations in both directions; service uniqueness; and active trade pointing to an adjacent-state-capable merchant population. Content-bound validation resolves NPC, faction, merchant encounter, and service IDs.

- [ ] **Step 5: Implement the one ordered migration**

Decode JSON as unknown, detect numeric schema version, and route version 4 only through:

```ts
function migrateV4ToV5(input: unknown): unknown {
  const v4 = legacyActiveRunV4Schema.parse(input);
  const derived = deriveRngStreams(v4.runSeed);
  return {
    ...v4,
    schemaVersion: 5,
    rng: {
      ...v4.rng,
      'merchant-stock': derived['merchant-stock'],
      'merchant-runtime': derived['merchant-runtime'],
    },
    hero: { ...v4.hero, currency: 0 },
    reputations: [],
    activeTrade: null,
  };
}
```

Before replacing the v5 schema, preserve the current exact strict v4 run schema as `legacyActiveRunV4Schema`; it accepts only the former stream names, hero fields, commands, events, and population variants. Use the existing `deriveRngStreams` helper, not ambient randomness. Validate the migrated result through the same v5 decoder. Keep unsupported versions rejected.

- [ ] **Step 6: Update fixtures and property arbitraries**

New fixtures use balance `startingCurrency`; schema-v5 fixtures include both merchant streams, empty reputation, and no active trade. Preserve dedicated v4 fixture builders only for migration tests.

- [ ] **Step 7: Run save and engine type gates**

Run: `npm test --workspace @woven-deep/engine -- --run test/model.test.ts test/save-codec.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: focused tests pass; canonical v5 round-trips and v4 migrates byte-stably after first v5 encoding.

- [ ] **Step 8: Commit persistence contracts**

```bash
git add packages/engine
git commit -m "feat: add merchant save state and migration"
```

---

### Task 3: Materialize merchant stock through population placement

**Files:**
- Create: `packages/engine/src/merchant-stock.ts`
- Modify: `packages/engine/src/population-placement.ts`
- Modify: `packages/engine/src/floor-integration.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/merchant-stock.test.ts`
- Modify: `packages/engine/test/population-placement.test.ts`
- Modify: `packages/engine/test/floor-integration.test.ts`
- Modify: `packages/engine/test/population-gates.test.ts`

**Interfaces:**
- Consumes: `MerchantEncounterContentEntry`, `NpcContentEntry`, 4B1 encounter selection/placement, run `rng['merchant-stock']`, `ItemInstance`, and `MerchantPopulation` from Tasks 1–2.
- Produces: `materializeMerchant(input): MerchantMaterialization`, merchant actor/population construction, committed merchant items, advanced merchant-stock stream, and creation events without changing encounter-stream behavior.

- [ ] **Step 1: Write failing deterministic stock tests**

Cover identical materialization from identical state, lifetime bounds, exact `departureAt`, stock depth eligibility and quantities, item mutable defaults, service-use ranges, sorted IDs, no refresh after save/load, and isolation from `encounters`, `combat`, and `loot` streams.

```ts
const first = materializeMerchant(fixture);
const second = materializeMerchant(fixture);
expect(first).toEqual(second);
expect(first.rng.combat).toEqual(fixture.run.rng.combat);
expect(first.rng.encounters).toEqual(fixture.run.rng.encounters);
expect(first.population.stockItemIds).toEqual(first.items.map(item => item.itemId).sort());
```

- [ ] **Step 2: Run focused placement tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-stock.test.ts test/population-placement.test.ts test/floor-integration.test.ts`

Expected: FAIL because merchant composition and materialization do not exist.

- [ ] **Step 3: Implement merchant materialization**

Create this boundary:

```ts
export interface MerchantMaterialization {
  readonly population: MerchantPopulation;
  readonly actor: ActorState;
  readonly items: readonly ItemInstance[];
  readonly nextMerchantStockState: Uint32State;
}

export function materializeMerchant(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  encounter: MerchantEncounterContentEntry;
  populationId: OpaqueId;
  floorId: OpaqueId;
  position: Point;
}>): MerchantMaterialization;
```

Preflight the complete stock graph before rolling. At each loot-table level, retain only choices whose reachable direct item contains the floor depth; nested tables with no eligible descendants are excluded, and a table with no eligible choice is an invariant error caught before consuming RNG. Roll lifetime, additional stock-roll count, eligible loot selections/quantities, and services only from the input merchant-stock state. Create item IDs under `item.<populationId>.stock.000001`, place every item in merchant stock, and initialize the lifecycle/one-time flags exactly as Task 2 defines.

- [ ] **Step 4: Extend existing placement and integration atomically**

Merchant composition requests one cell. Build the actor from its NPC definition with neutral disposition, registered behavior, `populationId`, and merchant presentation. Return created merchant items and next merchant-stock state from placement. `integrateGeneratedFloor` commits actors, population, items, encounter decision, encounter RNG, and merchant-stock RNG in one `validateActiveRun` call; skipped/rejected placement changes neither merchant stream nor items.

- [ ] **Step 5: Add gate and placement regression cases**

Assert merchant encounter chance, depth, environment, required vault slot, instance cap, discovery defaults, stair/objective distance, required-route preservation, and one visible `population.created` event all use existing 4B1 behavior.

- [ ] **Step 6: Run placement suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-stock.test.ts test/population-placement.test.ts test/floor-integration.test.ts test/population-gates.test.ts`

Expected: all pass with deterministic stock and unchanged nonmerchant snapshots.

- [ ] **Step 7: Commit merchant creation**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: place merchants with finite stock"
```

---

### Task 4: Implement checked pricing and bounded faction reputation

**Files:**
- Create: `packages/engine/src/commerce.ts`
- Create: `packages/engine/test/merchant-commerce.test.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/content-bound-validation.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/test/population-perception.test.ts`

**Interfaces:**
- Consumes: faction tiers, merchant multipliers, item base price, hero reputation records, merchant one-time flags, and safe integers.
- Produces: `factionReputation`, `ensureFactionReputation`, `reputationTier`, `changeReputation`, `quoteMerchantPurchase`, `quoteMerchantSale`, `quoteMerchantService`, and `merchantAcceptsItem`.

- [ ] **Step 1: Write failing exact quote and reputation tests**

Use values that distinguish rounding direction:

```ts
expect(quoteMerchantPurchase({ basePrice: 3, merchantBps: 12500, factionBps: 11000 })).toBe(5);
expect(quoteMerchantSale({ basePrice: 3, merchantBps: 5000, factionBps: 9000 })).toBe(1);
expect(quoteMerchantService({ basePrice: 3, factionBps: 11000 })).toBe(4);
expect(changeReputation(runAtMaximum, faction, 50, 'commerce').value).toBe(faction.maximumReputation);
```

Cover zero sale price, positive minimum purchase/service, boundary tier selection, missing-record starting value, sorted insertion, clamping, overflow rejection, heirloom/unique/nontransferable/category rejection, and exact state immutability.

- [ ] **Step 2: Run commerce tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-commerce.test.ts`

Expected: FAIL because commerce helpers do not exist.

- [ ] **Step 3: Implement checked integer quotes**

Expose exact functions:

```ts
export function quoteMerchantPurchase(input: PriceQuoteInput): number;
export function quoteMerchantSale(input: PriceQuoteInput): number;
export function quoteMerchantService(input: Readonly<{ basePrice: number; factionBps: number }>): number;
```

Define `PriceQuoteInput` beside those functions:

```ts
export interface PriceQuoteInput {
  readonly basePrice: number;
  readonly merchantBps: number;
  readonly factionBps: number;
}
```

Use quotient/remainder integer arithmetic with explicit safe-product checks. Purchase uses ceiling division by `10000 ** 2`, sale uses floor division, service uses ceiling division by `10000`, and positive purchase/service results clamp to at least one. Reject negative, noninteger, unsafe, or overflow inputs before arithmetic.

- [ ] **Step 4: Implement deterministic reputation transitions and acceptance**

```ts
export function factionReputation(run: ActiveRun, faction: NpcFactionContentEntry): number;
export function ensureFactionReputation(run: ActiveRun, faction: NpcFactionContentEntry): ActiveRun;
export function reputationTier(value: number, faction: NpcFactionContentEntry): ReputationTierDefinition;
export function changeReputation(input: Readonly<{
  run: ActiveRun; faction: NpcFactionContentEntry; delta: number;
  reason: 'commerce' | 'aggression' | 'death'; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; event: ReputationChangedEvent }>;
export function merchantAcceptsItem(item: ItemInstance, definition: ItemContentEntry,
  encounter: MerchantEncounterContentEntry, uniqueItemIds: ReadonlySet<OpaqueId>): boolean;
```

Add the event used by that transition to `DomainEvent` and the save event union:

```ts
export interface ReputationChangedEvent {
  readonly type: 'reputation.changed';
  readonly eventId: OpaqueId;
  readonly factionId: OpaqueId;
  readonly previous: number;
  readonly delta: number;
  readonly value: number;
  readonly reason: 'commerce' | 'aggression' | 'death';
}
```

Sort reputation records by code-unit faction ID and emit exact prior/delta/result/reason values. When an actor from a merchant population is first legitimately observed, call `ensureFactionReputation` from the existing population-encounter observation boundary to materialize that faction's authored starting value exactly once. Acceptance requires backpack ownership at command time, positive item price, accepted category, no `heirloom`, `quest`, `objective`, or `nontransferable` content tag, no heirloom metadata, and no boss-guaranteed unique ID.

- [ ] **Step 5: Run commerce tests and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-commerce.test.ts && npm run typecheck --workspace @woven-deep/engine`

Expected: all pricing and reputation examples pass without floating-point rounding paths.

- [ ] **Step 6: Commit economy primitives**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add merchant pricing and reputation"
```

---

### Task 5: Add modal revision-only buy, sell, open, and close transactions

**Files:**
- Create: `packages/engine/src/trade.ts`
- Create: `packages/engine/test/merchant-trade.test.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/reducer.ts`
- Modify: `packages/engine/src/inventory.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/actions.test.ts`
- Modify: `packages/engine/test/reducer.test.ts`

**Interfaces:**
- Consumes: `ActiveTrade`, merchant stock, commerce quotes/reputation, inventory stack/split helpers, command deduplication, perception, and content-bound state.
- Produces: four trade commands (`trade-open`, `trade-buy`, `trade-sell`, `trade-close`), `validateTradeCommand`, `resolveTradeCommand`, `closeTrade`, `closeTradeIfInvalid`, exact commerce events, modal rejection, and revision-only applied results.

- [ ] **Step 1: Write failing command and modal-state tests**

Cover open requirements: living/visible/adjacent/available/nonhostile/not-due merchant, faction accepts trade, and no current trade. Cover wrong merchant, stale revision, command replay/conflict, ordinary command rejection while open, explicit close, automatic-close helper, and open/close without commerce granting no reputation.

```ts
const opened = resolveCommand(run, {
  type: 'trade-open', commandId: 'command.trade-open', expectedRevision: 0,
  merchantActorId: merchant.actorId,
}, context);
expect(opened.result).toMatchObject({ status: 'applied', revision: 1, turn: run.turn });
expect(opened.state.worldTime).toBe(run.worldTime);
expect(opened.state.activeTrade?.merchantPopulationId).toBe(merchant.populationId);
```

- [ ] **Step 2: Write failing atomic buy/sell tests**

Assert exact partial-stack IDs derived from command ID, merge compatibility, backpack capacity, funds, merchant ownership, quantities, item eligibility, equipped-item rejection, currency overflow, current tier prices, stock ID updates, and no partial mutation or RNG consumption on every invalid result.

- [ ] **Step 3: Run trade tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-trade.test.ts test/actions.test.ts test/reducer.test.ts`

Expected: FAIL because trade commands and revision-only dispatch do not exist.

- [ ] **Step 4: Define exact commands, events, and invalid reasons**

```ts
export interface TradeOpenCommand extends CommandEnvelope {
  readonly type: 'trade-open'; readonly merchantActorId: OpaqueId;
}
export interface TradeBuyCommand extends CommandEnvelope {
  readonly type: 'trade-buy'; readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number;
}
export interface TradeSellCommand extends CommandEnvelope {
  readonly type: 'trade-sell'; readonly merchantPopulationId: OpaqueId;
  readonly itemId: OpaqueId; readonly quantity: number;
}
export interface TradeCloseCommand extends CommandEnvelope {
  readonly type: 'trade-close'; readonly merchantPopulationId: OpaqueId;
}

export type TradeCommand = TradeOpenCommand | TradeBuyCommand | TradeSellCommand | TradeCloseCommand;
```

Add closed reasons: `trade.active`, `trade.required`, `merchant.unavailable`, `merchant.out-of-range`, `merchant.refuses`, `trade.merchant-mismatch`, `trade.insufficient-funds`, `trade.stock-unavailable`, `trade.item-unacceptable`, and `trade.capacity`. Define opened/bought/sold/closed events with exact item, quantity, unit price, total, and resulting currency.

- [ ] **Step 5: Implement preflight and exact item movement**

```ts
export function validateTradeCommand(input: Readonly<{
  state: ActiveRun; command: TradeCommand; content: CompiledContentPack;
}>): TradeValidation;

export function resolveTradeCommand(input: Readonly<{
  state: ActiveRun; command: TradeCommand; content: CompiledContentPack;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;

export function closeTrade(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
  reason: 'player' | 'aggression' | 'death' | 'unavailable' | 'departure';
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;

export function closeTradeIfInvalid(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

Use this closed preflight result; successful validation carries no mutation:

```ts
export type TradeValidation = Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: InvalidActionReason }>;
```

Preflight all references, visibility, adjacency, tier, ownership, quantity, price, funds/capacity, and safe totals. Reuse `canStack`; split with command-derived IDs; move exact mutable state; sort items and stock IDs. Explicit close grants the encounter's commerce delta only if commerce completed and `commerceBonusApplied === false`. `closeTradeIfInvalid` closes without a bonus when actor ownership, floor, adjacency, visibility, liveness, lifecycle, or relationship no longer satisfies the session invariant.

- [ ] **Step 6: Add a revision-only reducer branch**

After dedup/stale checks, normalize the session with `closeTradeIfInvalid`. Reject non-trade commands only when the normalized `activeTrade !== null`; if normalization closed an invalid session, include its close event before resolving the submitted command. For trade commands, validate and apply against normalized state, increment revision only, preserve turn/world time, record all events/public events, and never call `resolveWorldStep`.

- [ ] **Step 7: Run transaction suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-trade.test.ts test/actions.test.ts test/reducer.test.ts test/inventory.test.ts`

Expected: all pass; every successful trade command increments revision and preserves turn/world time.

- [ ] **Step 8: Commit modal commerce**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add authoritative merchant transactions"
```

---

### Task 6: Add identification service transactions

**Files:**
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/trade.ts`
- Modify: `packages/engine/src/identification.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Create: `packages/engine/test/merchant-service.test.ts`
- Modify: `packages/engine/test/identification.test.ts`

**Interfaces:**
- Consumes: active trade path from Task 5, `MerchantServiceState`, service quote, existing `identifyItem`/`identifyAppearance`, hero backpack/equipment ownership, and current faction tier.
- Produces: `TradeServiceCommand`, service-purchased event, identify target validation, saved use decrement, and transaction commerce marking.

- [ ] **Step 1: Write failing service tests**

Cover backpack and equipped unidentified targets, shuffled appearance and instance identification, already identified rejection, wrong owner, absent/tier-blocked/exhausted offer, insufficient funds, exact service rounding, one use decrement, save/reload preservation, and atomic failure.

```ts
const resolved = resolveCommand(runWithTrade, {
  type: 'trade-service', commandId: 'command.identify', expectedRevision: runWithTrade.revision,
  merchantPopulationId: merchant.populationId,
  serviceId: 'merchant-service.identify', targetItemId: 'item.hero.unknown',
}, context);
expect(resolved.state.items.find(item => item.itemId === 'item.hero.unknown')?.identified).toBe(true);
expect(service(resolved.state).remainingUses).toBe(service(runWithTrade).remainingUses - 1);
expect(resolved.state.activeTrade?.completedCommerce).toBe(true);
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-service.test.ts test/identification.test.ts`

Expected: FAIL because the service command is not registered.

- [ ] **Step 3: Add the command and atomic resolver branch**

```ts
export interface TradeServiceCommand extends CommandEnvelope {
  readonly type: 'trade-service';
  readonly merchantPopulationId: OpaqueId;
  readonly serviceId: 'merchant-service.identify';
  readonly targetItemId: OpaqueId;
}

// Replace Task 5's four-command union with the complete five-command union.
export type TradeCommand = TradeOpenCommand | TradeBuyCommand | TradeSellCommand
  | TradeServiceCommand | TradeCloseCommand;
```

Preflight tier allow-list, merchant offer tier IDs, remaining uses, carried/equipped ownership, unidentified state, price, and funds. On success, deduct currency, decrement the exact saved service, call the existing identification transition, append its events after `trade.service-purchased`, and mark completed commerce. Add `trade.service-unavailable` and `trade.target-invalid` reasons.

- [ ] **Step 4: Run service and save suites**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-service.test.ts test/identification.test.ts test/save-codec.test.ts`

Expected: all pass with exact service-use persistence across v5 round-trips.

- [ ] **Step 5: Commit identification service**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add merchant identification service"
```

---

### Task 7: Resolve global merchant warnings and departure

**Files:**
- Create: `packages/engine/src/merchant-lifecycle.ts`
- Create: `packages/engine/test/merchant-lifecycle.test.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/rest.ts`
- Modify: `packages/engine/src/floor-integration.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: absolute `departureAt`, warning thresholds, global world-time transitions, active trade, merchant-held stock, and `closeTrade`.
- Produces: `advanceMerchantLifecycle`, one-time warning events, atomic departure, off-floor processing without actor turns, and automatic-close-before-departure ordering.

- [ ] **Step 1: Write failing active/off-floor deadline tests**

Cover crossing multiple warning thresholds in one world step, stable population ordering, no duplicate warning after reload, off-floor warning/departure, no off-floor movement/energy change, removal of actor and all held stock, transaction deferral, due-on-load automatic closure, and no opening when due.

```ts
const advanced = advanceMerchantLifecycle({
  state: runWithMerchantOnInactiveFloor,
  content,
  previousWorldTime: 900,
  nextWorldTime: 1200,
  eventId: 'event.deadlines',
});
expect(advanced.events.map(event => event.type)).toContain('merchant.departed');
expect(advanced.state.actors).not.toContainEqual(expect.objectContaining({ actorId: merchant.actorId }));
expect(advanced.state.items.some(item => item.location.type === 'merchant-stock')).toBe(false);
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-lifecycle.test.ts test/world-step.test.ts test/rest.test.ts`

Expected: FAIL because global merchant deadlines are not processed.

- [ ] **Step 3: Implement the pure lifecycle boundary**

```ts
export function advanceMerchantLifecycle(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  previousWorldTime: number;
  nextWorldTime: number;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

Sort merchant populations by ID. Emit each crossed configured remaining-time threshold once, storing emitted thresholds. When due, skip a currently valid active trade; otherwise close invalid trade first, remove actor and held stock atomically, update population to departed with empty living/stock IDs, and emit departure after automatic-close. Never alter inactive-floor actor energy or behavior.

- [ ] **Step 4: Integrate every global-time advancement boundary**

Call the lifecycle function after each ordinary world step, each rest substep/final advancement, and floor transitions that can observe an already-due save. Pass the pre/post world-time values. Trade commands never call it except `trade-close`, which immediately resolves a previously due merchant after closure.

- [ ] **Step 5: Run lifecycle regression suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-lifecycle.test.ts test/world-step.test.ts test/rest.test.ts test/floor-integration.test.ts test/save-codec.test.ts`

Expected: all pass; inactive floors remain frozen except merchant deadline records and atomic removal.

- [ ] **Step 6: Commit global departure**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add merchant departure lifecycle"
```

---

### Task 8: Add merchant threat response, aggression, stock loss, and death consequences

**Files:**
- Create: `packages/engine/src/merchant-behavior.ts`
- Create: `packages/engine/test/merchant-behavior.test.ts`
- Modify: `packages/engine/src/behavior.ts`
- Modify: `packages/engine/src/world-step.ts`
- Modify: `packages/engine/src/combat.ts`
- Modify: `packages/engine/src/population-intent.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Modify: `packages/engine/src/reactions.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/test/reactions.test.ts`
- Modify: `packages/engine/test/actions.test.ts`

**Interfaces:**
- Consumes: existing explicit-neutral aggression rule, relationship overrides, merchant behavior state, pathfinding, actor scheduler, commerce reputation, `closeTrade`, merchant-runtime RNG, exact item splitting, and hostile-only reactions.
- Produces: `merchantBehaviorAction`, `provokeMerchant`, `resolveMerchantDeath`, deterministic one-time stock loss, flee/self-defense lifecycle, and merchant provocation/drop/death events.

- [ ] **Step 1: Write failing neutral-threat and behavior tests**

Assert unrelated hostile monsters ignore neutral merchants; direct damage, relationship override, or collateral danger creates a threat; below-threshold merchants flee; authored self-defense attacks only hostile known threats; flee path maximizes distance through existing pathfinding; inactive floors do not act; and neutral movement creates no opportunity reaction.

- [ ] **Step 2: Write failing aggression/stock/death tests**

Cover explicit attack ordering, active trade closure, one aggression penalty, hero relationship becoming hostile, authored lifecycle before later AI, `ceil(totalUnits * fraction)`, zero/one fractions, deterministic unit selection and stack split IDs, one-time drop, held-stock destruction on death, one death penalty, and dedup/save replay.

```ts
const provoked = provokeMerchant({ state, content, merchantPopulationId: merchant.populationId,
  sourceActorId: state.hero.actorId, eventId: 'command.attack' });
expect(provoked.events.map(event => event.type)).toEqual([
  'trade.closed', 'reputation.changed', 'relationship.changed',
  'merchant.provoked', 'merchant.stock-dropped',
]);
expect(groundUnits(provoked.state)).toBe(Math.ceil(stockUnits(state) * encounter.definition.stockDropFraction));
```

- [ ] **Step 3: Run behavior tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-behavior.test.ts test/actions.test.ts test/reactions.test.ts test/world-step.test.ts`

Expected: FAIL because merchant behavior hooks do not exist.

- [ ] **Step 4: Implement registered behavior and threat selection**

```ts
export function merchantBehaviorAction(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; actorId: OpaqueId;
}>): GameAction;

export function provokeMerchant(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  merchantPopulationId: OpaqueId; sourceActorId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;

export function resolveMerchantDeath(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack;
  merchantPopulationId: OpaqueId; killerActorId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }>;
```

Threat candidates require hostile relationship, direct remembered damage, or explicit danger state. Use saved intent/goal and existing deterministic next-step selection. Flee chooses the valid candidate step with greatest Chebyshev distance from threats, then existing code-unit/cell tie-breaks. Self-defense delegates to ordinary approach/attack against known hostile threats and falls back to flee below threshold.

- [ ] **Step 5: Implement one-time provocation and stock loss**

Before resolving the hero's ordinary explicit adjacent attack, find a neutral merchant target and call `provokeMerchant`, so even a miss counts as deliberate aggression. Also call it on the first hero-sourced ranged or effect damage to an unprovoked merchant; monster-sourced damage creates a threat but causes no hero reputation or stock-loss consequence. Close trade, apply one aggression delta, set hostile relationship, change lifecycle, and resolve stock loss. Roll a deterministic permutation from `merchant-runtime`; select exactly the ceiling unit count; split using IDs under `item.<populationId>.drop.<sequence>`; place selected units at the merchant cell; retain the remainder in merchant stock; save the advanced stream and flag.

- [ ] **Step 6: Integrate death cleanup and preserve reaction rules**

After ordinary death detection, call `resolveMerchantDeath`: apply the death delta once only when the hero is credited as killer, remove every held stock item, clear active trade, move the actor to former membership, set dead lifecycle, and emit merchant death. Do not drop retained stock. Keep `reactionEligible` dependent on hostile relationship and awareness; add regression tests for neutral flee and hostile-after-provocation movement.

- [ ] **Step 7: Run behavior and combat suites and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-behavior.test.ts test/actions.test.ts test/reactions.test.ts test/world-step.test.ts test/combat.test.ts`

Expected: all pass with the existing bump confirmation and explicit attack behavior unchanged.

- [ ] **Step 8: Commit self-preservation and consequences**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: add merchant self-preservation and stock loss"
```

---

### Task 9: Project visible merchant state, exact active trade, and redacted events

**Files:**
- Modify: `packages/engine/src/projection.ts`
- Modify: `packages/engine/src/event-projection.ts`
- Modify: `packages/engine/src/model.ts`
- Modify: `packages/engine/src/save-schema.ts`
- Create: `packages/engine/test/merchant-projection.test.ts`
- Modify: `packages/engine/test/projection.test.ts`
- Modify: `packages/engine/test/event-projection.test.ts`
- Modify: `packages/engine/test/population-projection.test.ts`

**Interfaces:**
- Consumes: hero perception, merchant population, current faction tier, commerce quotes, `projectItem`, active trade, domain events, and saved warning state.
- Produces: qualitative visible merchant extension, `ObservableTradeProjection`, exact hero commerce events, and redaction of all unopened/hidden merchant state.

- [ ] **Step 1: Write failing visible/hidden projection tests**

Assert visible merchants expose name/glyph/color/health/disposition, faction name, qualitative tier, broad intent, trade availability, and only the most urgent emitted warning. Assert unseen/remembered merchants expose no actor, faction, stock, deadline, services, flee goal, path, or random state.

- [ ] **Step 2: Write failing active-trade projection tests**

Assert a valid session exposes exact currency, stock quantities and current quotes, eligible backpack sale quotes, service price/uses/valid target IDs, and merchant IDs. Unidentified stock must equal `projectItem`'s appearance-only representation and omit content ID/effects/true properties.

```ts
const projected = projectGameplayState({ state: runWithTrade, content });
expect(projected.trade).toMatchObject({
  merchantPopulationId: merchant.populationId,
  currency: runWithTrade.hero.currency,
});
expect(projected.trade?.stock[0]?.item).toEqual(projectItem({ run: runWithTrade, content, itemId: stockId }));
expect(JSON.stringify(projected)).not.toContain('merchant-stock');
```

- [ ] **Step 3: Run projection tests and verify RED**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-projection.test.ts test/projection.test.ts test/event-projection.test.ts test/population-projection.test.ts`

Expected: FAIL because merchant and trade projections are absent.

- [ ] **Step 4: Define and implement the projection contract**

```ts
export interface ObservableTradeProjection {
  readonly merchantPopulationId: OpaqueId;
  readonly merchantActorId: OpaqueId;
  readonly merchantName: string;
  readonly factionName: string;
  readonly reputationTier: string;
  readonly currency: number;
  readonly stock: readonly Readonly<{ item: Readonly<Record<string, unknown>>; quantity: number; unitPrice: number }>[];
  readonly saleOffers: readonly Readonly<{ itemId: OpaqueId; quantity: number; unitPrice: number }>[];
  readonly services: readonly Readonly<{
    serviceId: 'merchant-service.identify'; unitPrice: number; remainingUses: number;
    targetItemIds: readonly OpaqueId[];
  }>[];
}
```

Derive this only when active trade invariants hold. Sort stock, offers, services, and targets by code-unit ID. Use `projectItem` for every item. Extend visible actor projection with qualitative merchant data only; derive deadline presentation from emitted warning thresholds rather than exact `departureAt`.

- [ ] **Step 5: Add event projection rules**

Pass exact open/buy/sell/service/close/reputation events to the controlling hero. Show departure warning/departure/provocation/stock-drop/death only when the merchant is legitimately visible, except the current hero always receives its own trade auto-close reason and faction reputation change. Suppress merchant creation and off-floor departure details when no merchant actor is visible.

- [ ] **Step 6: Run projection suites and browser boundary**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-projection.test.ts test/projection.test.ts test/event-projection.test.ts test/population-projection.test.ts test/browser-boundary.test.ts`

Expected: all pass and the production engine graph remains browser-safe.

- [ ] **Step 7: Commit projection contracts**

```bash
git add packages/engine/src packages/engine/test
git commit -m "feat: project merchant commerce safely"
```

---

### Task 10: Prove replay, properties, demonstration, docs, and release gates

**Files:**
- Create: `packages/engine/test/merchant-replay.test.ts`
- Create: `packages/engine/test/merchant-properties.test.ts`
- Create: `scripts/merchant-demo.mjs`
- Create: `packages/engine/test/fixtures/merchant-demo-hashes.json`
- Create: `packages/engine/test/merchant-cli.test.ts`
- Modify: `packages/engine/test/arbitraries.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/content/test/admin-docs.test.ts`
- Modify: `docs/server-admin/content-configuration.md`
- Modify: `docs/superpowers/plans/2026-07-13-implementation-roadmap.md`
- Modify: `package.json`
- Modify: `scripts/smoke-runner.mjs`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: the complete schema-v4 content and schema-v5 merchant engine vertical slice from Tasks 1–9.
- Produces: continuous/split replay proof, 512-seed invariant suite, deterministic terminal demonstration with reviewed hashes, complete authoring docs, roadmap completion, and release/Docker gates.

- [ ] **Step 1: Write failing split-replay coverage**

Create a command sequence that opens trade, buys, sells, identifies, closes, advances warnings, changes floors, returns, provokes, drops stock, and encounters a same-faction merchant that refuses trade. Compare continuous execution with save/reload boundaries before and after every transition:

```ts
expect(encodeSave(split.state)).toBe(encodeSave(continuous.state));
expect(stableJson(split.events)).toBe(stableJson(continuous.events));
expect(stableJson(split.projections)).toBe(stableJson(continuous.projections));
```

- [ ] **Step 2: Add 512-seed mixed-system properties**

Generate valid merchant content within compiler bounds and mixed ordinary/trade commands. After every accepted command assert: schema-v5 validity; nonnegative safe currency; sorted unique stock/reputation/service IDs; stock/location bidirectionality; at most one active trade; exact currency conservation across quoted transfers; no time advancement from trade; no duplicate one-time consequence; departed/dead merchants own no actor/stock; hidden projection contains no merchant-only fields; and split replay equality. Configure `numRuns: 512` with shrinking enabled.

- [ ] **Step 3: Run replay/properties and verify GREEN**

Run: `npm test --workspace @woven-deep/engine -- --run test/merchant-replay.test.ts test/merchant-properties.test.ts`

Expected: all replay examples and 512 seeded property runs pass with shrinking enabled.

- [ ] **Step 4: Build the deterministic exit demo**

Add `npm run merchant:demo`. The script compiles bundled content, forces two eligible Lampwright merchant placements, performs buy/sell/identify, prints only observable trade data, advances warning thresholds, proves off-floor departure without actor turns, attacks the first merchant in a second scenario, verifies exact stock loss and flee state, and shows the related merchant refusing trade. Run twice in separate Node processes and compare save/event/projection hashes.

- [ ] **Step 5: Review and store demo hashes**

Run: `npm run merchant:demo`

Expected: the script prints stable nonempty `saveHash`, `eventHash`, and `projectionHash` values twice and exits zero. Inspect the transcript for every exit-demo claim, then store those exact hashes in `packages/engine/test/fixtures/merchant-demo-hashes.json`; the CLI test must reject any mismatch.

- [ ] **Step 6: Document every authoring contract**

Document NPC fields, faction coverage and tiers, merchant encounter fields, stock transferability, price formulas and rounding, services, lifetime/warnings, aggression responses, reputation deltas, stock-drop ceiling rule, starting currency, registry values, save migration, and production rarity. Extend `admin-docs.test.ts` so each content kind and closed identifier must appear in the docs.

- [ ] **Step 7: Update roadmap and release gates**

Mark 4B2 complete with links to the approved spec and this plan; leave 4B3 run records pending. Add merchant demo to smoke and Docker build gates without removing existing population/gameplay/dungeon gates.

- [ ] **Step 8: Run full verification**

Run, in order:

```bash
npm test
npm run typecheck
npm run build
npm run content:validate
npm run content:startup-gate
npm run merchant:demo
npm run population:demo
npm run gameplay:demo
npm run dungeon:demo
npm run smoke
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/api/health
docker compose down
git diff --check
git status --short
```

Expected: all tests, 512 seeded simulations, typecheck, build, content gates, deterministic demos, smoke, and Docker health pass; final Git status contains only the intended Task 10 changes before commit.

- [ ] **Step 9: Commit milestone verification**

```bash
git add packages scripts docs package.json Dockerfile
git commit -m "feat: complete dungeon NPC milestone"
```

- [ ] **Step 10: Request final review**

Run the `superpowers:requesting-code-review` workflow against the complete branch diff from its merge base. Resolve every confirmed issue with a failing regression test, rerun the affected focused suite and the full verification block, then use `superpowers:verification-before-completion` before reporting 4B2 complete.
