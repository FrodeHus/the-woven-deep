# Server content configuration

The Woven Deep loads gameplay content from YAML when the server starts. Administrators can add and balance monsters, NPCs, NPC factions, encounters, fallen-hero bosses, achievements, items, identification pools, spells, traps, loot tables, vaults, conditions, and global balance values without rebuilding the application, provided they use the engine's supported behaviors, effects, targets, and condition traits.

YAML is configuration, not a scripting language. A new combination of supported rules needs only YAML. A fundamentally new rule requires a code change, a strict schema, tests, and an update to this guide.

## Safe editing workflow

1. Copy the complete bundled `content/` directory to a reviewed operator-owned directory. A mounted directory replaces the bundled directory; it does not overlay it.
2. Edit existing `.yaml` or `.yml` files, or add new ones anywhere below that directory.
3. Validate the complete replacement directory:

   ```bash
   npm run content:validate -- /absolute/path/to/content
   ```

4. Record the reported SHA-256 content hash and compare it with the reviewed build output.
5. Mount the directory read-only and recreate the service:

   ```yaml
   services:
     rogue:
       volumes:
         - /absolute/path/to/content:/app/content:ro
         - rogue-data:/data
   ```

   ```bash
   docker compose up -d --force-recreate --wait --wait-timeout 60
   node scripts/smoke.mjs http://localhost:3000
   ```

6. Confirm the running server reports the expected content hash before admitting play.

For a release image, run the repeatable startup integration gate as well:

```bash
npm run content:startup-gate
```

The gate builds the Compose image, starts it with a complete schema-v5 directory mounted read-only,
smoke-tests the server, then restarts against an invalid replacement using the same database. It requires
the invalid container to exit and verifies that the immutable content-pack publication set did not change.
Pass an existing image reference after `--` to skip the build, for example
`npm run content:startup-gate -- rogue-rogue`.

Any parse, schema, reference, or semantic error rejects the entire pack at startup. The server never skips an invalid file or partially loads a directory.

## Directory and file discovery

- The compiler recursively reads regular files ending in `.yaml` or `.yml`.
- Directory names and filenames are organizational only. They do not become content IDs and do not affect the content hash.
- Entries from every file share one global ID namespace.
- Formatting, comments, and file ordering do not affect the hash. Material values and IDs do.
- YAML aliases and custom tags are rejected. Each file is limited to 262,144 UTF-8 bytes.
- A complete pack requires at least one `monster`, `item`, `vault`, and `balance` entry. Exactly one balance entry and at most one `fallen-champion-template` entry are permitted.
- Across the complete pack, entry tags must cover the foundational generation categories `defense`, `food`, `healing`, `identification`, `light`, and `offense`. These are compile-time coverage markers for pool reporting. They do not implement an item's mechanics; the kind-specific fields and registered effects do that.

A conventional layout is:

```text
content/
  achievements/
  balance/
  champions/
  conditions/
  encounters/
  items/
  loot-tables/
  monsters/
  npcs/
  npc-factions/
  spells/
  traps/
  vaults/
```

## File envelope and common fields

Every file is one strict document:

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.example
    name: Example
    tags: [example]
    # kind-specific fields follow
```

Unknown fields are errors, including plausible misspellings.

| Field | Type | Required/default | Rules and meaning |
|---|---|---|---|
| `schemaVersion` | integer | Required | Must be exactly `7`. |
| `entries` | array | Required, at least one | May contain any supported content kind. |
| `kind` | enum | Required | One of `monster`, `npc`, `npc-faction`, `item`, `identification-pool`, `spell`, `trap`, `loot-table`, `balance`, `vault`, `condition`, `encounter`, `fallen-champion-template`, `achievement`, `class`, `background`, or `trait`. |
| `id` | string | Required | Globally unique stable ID such as `monster.cave-rat`. |
| `name` | string | Required | Trimmed display name, 1–80 characters. |
| `tags` | slug array | Defaults to `[]` | Descriptive taxonomy. Tags never activate engine rules. |

## Identifiers and cross-file references

Stable IDs start with a lowercase letter and contain at least two dot-separated segments. Each segment contains lowercase letters, digits, or hyphens. Examples: `item.brass-lantern`, `condition.reaction-suppressed`, and `loot-table.depth-one`.

Slug values such as tags and vault-local slot IDs contain lowercase letters, digits, and hyphens without dots. All content IDs are globally unique, even when their kinds differ or they live in different files.

Cross-file references resolve after every file is parsed, so declaration order is irrelevant. References must resolve to the required kind. Direct loot choices must reference an `item`; nested choices must reference a `loot-table`, and loot-table cycles are rejected. A weapon's ammunition tag must match a tag on at least one ammunition item. Condition application and removal must reference a `condition`, and authored duration overrides must satisfy that condition's definition.

## Balance entries

A pack contains exactly one `balance` entry. `startingCurrency` is a non-negative safe integer; the bundled value is `40`.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `readinessThreshold` | positive safe integer | Yes | Energy required to become ready. |
| `normalActionCost` | positive safe integer | Yes | Default energy cost. |
| `speedMinimum`, `speedMaximum` | positive safe integers | Yes | Supported actor-speed bounds; minimum cannot exceed maximum, and every monster speed must fall within them. |
| `energyMinimum`, `energyMaximum` | safe integers | Yes | Supported saved-energy bounds; minimum cannot exceed maximum, and readiness must fall within them. |
| `attributeMinimum`, `attributeMaximum` | non-negative safe integers | Yes | Base attribute bounds; minimum cannot exceed maximum, and every monster attribute must fall within them. |
| `hungerMaximum` | positive safe integer | Yes | Maximum hunger reserve. |
| `hungerThresholds` | object | Yes | Remaining-reserve boundaries satisfying `starving <= weak <= hungry < hungerMaximum`. A stage begins when reserve reaches or falls below its boundary. |
| `starvationInterval` | positive safe integer | Yes | Time between starvation damage events. |
| `starvationDamage` | positive safe integer | Yes | Damage per starvation event. |
| `recoveryInterval` | positive safe integer | Yes | World-time interval between natural recovery attempts. |
| `recoveryAmount` | non-negative safe integer | Yes | Base health restored at each recovery interval before hunger scaling. Zero disables natural recovery. |
| `restMaximumDuration` | positive safe integer | Yes | Hard upper bound, in world-time units, for a single rest command. Player requests may choose a shorter duration but cannot exceed this value. |
| `recoveryByHungerStage` | object | Yes | Integer percentages from 0 through 100 for `sated`, `hungry`, `weak`, and `starving` recovery. |
| `hungerStageModifiers` | object | Yes | Derived-stat modifiers for each hunger stage. Each stage accepts the same closed stat names used by condition modifiers. |
| `formulas` | map of integer maps | Yes | Derived-stat coefficients; unknown operands fail engine validation. |
| `actionCosts` | registered-action-ID-to-integer map | Yes | Non-negative cost overrides. Unknown action IDs fail compilation. |
| `score` | object | Yes | Run scoring coefficients described in the `score` table below. Every value is an integer; no floating point is accepted. |
| `pointBuy` | object | Yes | Chargen point-buy attribute table described below. |
| `restockMilestones` | array of positive safe integers | Yes | Strictly increasing world-time milestones at which town merchant stock restocks. The bundled value is `[5, 10, 15, 20]`. |
| `house` | object | Yes | Player house sizing, described below. The bundled value is `{ baseCapacity: 6, strongboxIncrement: 4 }`. |
| `encounterDensity` | object | Yes | Dungeon encounter density, described below. The bundled value is `{ cellsPerEncounter: 2000 }`. |

`house` carries a positive safe integer `baseCapacity` (the player house's starting storage capacity) and a positive safe integer `strongboxIncrement` (additional capacity granted per purchased strongbox upgrade). `encounterDensity` carries a positive safe integer `cellsPerEncounter`, the average number of floor cells the generator budgets per placed encounter.

### Point-buy attribute table

`pointBuy` supplies the chargen cost curve for raising a base attribute from `attributeMinimum` to `attributeMaximum`.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `budget` | positive safe integer | Yes | Total points a new character may spend across all base attributes. |
| `costs` | array of `{ value, cost }` | Yes | One row per attribute value, ordered from `attributeMinimum` through `attributeMaximum` with no gaps or duplicates. `value` is a safe integer and `cost` is a non-negative safe integer; `cost` must be non-decreasing as `value` increases (a plateau is allowed, a decrease is rejected). |

```yaml
pointBuy:
  budget: 30
  costs:
    - { value: 0, cost: 0 }
    - { value: 1, cost: 1 }
    - { value: 10, cost: 10 }
    - { value: 20, cost: 30 }
    - { value: 30, cost: 60 }
```

```yaml
schemaVersion: 7
entries:
  - kind: balance
    id: balance.core-gameplay
    name: Core gameplay
    tags: [core]
    readinessThreshold: 100
    normalActionCost: 100
    speedMinimum: 25
    speedMaximum: 400
    energyMinimum: -10000
    energyMaximum: 10000
    attributeMinimum: 0
    attributeMaximum: 30
    hungerMaximum: 10000
    hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 }
    starvationInterval: 500
    starvationDamage: 1
    recoveryInterval: 500
    recoveryAmount: 10
    restMaximumDuration: 5000
    recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 }
    hungerStageModifiers:
      sated: {}
      hungry: {}
      weak: { meleeAccuracy: -1, meleeDamageBonus: -1, defense: -1 }
      starving: { meleeAccuracy: -2, meleeDamageBonus: -2, defense: -2 }
    formulas:
      maxHealth: { base: 8, vitality: 2 }
      meleeAccuracy: { might: 1 }
      meleeDamageBonus: { might: 1 }
      rangedAccuracy: { agility: 1 }
      defense: { base: 8, agility: 1 }
      search: { wits: 1 }
      disarm: { agility: 1, wits: 1 }
    actionCosts: { action.move: 100, action.spawn: 100, action.wait: 100 }
    score:
      depthCoefficient: 100
      bossDefeatCoefficient: 250
      threatCoefficient: 5
      discoveryCoefficient: 25
      completionBonus: { died: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }
      turnEfficiencyBudget: 500
      turnEfficiencyDecayInterval: 200
    pointBuy:
      budget: 30
      costs:
        - { value: 0, cost: 0 }
        - { value: 1, cost: 1 }
        - { value: 10, cost: 10 }
        - { value: 20, cost: 30 }
        - { value: 30, cost: 60 }
    restockMilestones: [5, 10, 15, 20]
    house: { baseCapacity: 6, strongboxIncrement: 4 }
    encounterDensity: { cellsPerEncounter: 2000 }
```

The closed action-cost IDs are `action.attack`, `action.cast`, `action.close-door`, `action.disarm`, `action.drop`, `action.equip`, `action.fire`, `action.move`, `action.open-door`, `action.pickup`, `action.refuel`, `action.search`, `action.spawn`, `action.split-stack`, `action.throw-item`, `action.toggle-light`, `action.unequip`, `action.use-item`, and `action.wait`. A pack may override any subset; `normalActionCost` supplies the normal fallback.

### Score coefficients

The `score` object supplies every coefficient used to compute a deterministic run score. Each coefficient is a non-negative safe integer (`0` through `9007199254740991`, meaning `2^53 - 1`); fractional, negative, and unsafe values are rejected, as are unknown fields.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `depthCoefficient` | non-negative safe integer | Yes | Points per deepest floor reached. Bundled value `100`. |
| `bossDefeatCoefficient` | non-negative safe integer | Yes | Points per boss defeated. Bundled value `250`. |
| `threatCoefficient` | non-negative safe integer | Yes | Points per monster `threat` point defeated. Bundled value `5`. |
| `discoveryCoefficient` | non-negative safe integer | Yes | Points per discovery. Bundled value `25`. |
| `completionBonus` | object | Yes | Non-negative safe-integer bonus for exactly the closed completion keys `died`, `became-heart`, `refused`, and `broke-cycle`. All four keys are required; unknown keys are rejected. Bundled values are `0`, `800`, `400`, and `1500` respectively. |
| `turnEfficiencyBudget` | non-negative safe integer | Yes | Turn budget before efficiency decay begins. Bundled value `500`. |
| `turnEfficiencyDecayInterval` | positive safe integer | Yes | Turns per efficiency decay step; zero is rejected. Bundled value `200`. |

## Monster entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `glyph` | one Unicode glyph | Yes | Map character. |
| `color` | `#RRGGBB` | Yes | Presentation color. |
| `minDepth`, `maxDepth` | positive safe integers | Yes | Inclusive appearance range; maximum must not be lower than minimum. |
| `attributes` | object | Yes | Non-negative `might`, `agility`, `vitality`, `wits`, and `resolve`, all within the balance attribute bounds. |
| `health`, `speed` | positive safe integers | Yes | Base hit points and scheduler speed; speed must be within the balance speed bounds. |
| `accuracy`, `defense` | safe integers | Yes | Base attack and defense values. |
| `perception`, `armor` | non-negative safe integers | Yes | Sight capability and flat mitigation. |
| `damage` | dice object | Yes | Positive `count` up to 100, positive `sides` up to 10,000, and safe-integer `bonus`. |
| `resistances` | object | Yes | Integer percentage from -100 through 100 for every damage type. |
| `disposition` | enum | Yes | `friendly`, `neutral`, or `hostile`. |
| `behaviorId` | registered ID | Yes | Closed AI behavior described below. |
| `behaviorParameters` | object | Defaults to `{}` | Strict parameters for the behavior. |
| `threat` | non-negative safe integer | Yes | Scoring weight of defeating this monster, multiplied by the balance `threatCoefficient`. Bounds are `0` through `9007199254740991` (`2^53 - 1`); fractional and negative values are rejected. Bundled values: `1` for `monster.cave-rat`, `2` for `monster.training-beetle`, `4` for the swarm-source `monster.rat-brood`, and `12` for the boss `monster.ashen-warden`. |
| `rarity` | enum | Yes | `common`, `uncommon`, `rare`, or `legendary`. |

```yaml
schemaVersion: 7
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: "#9e927c"
    tags: [animal, darkness]
    minDepth: 1
    maxDepth: 6
    attributes: { might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2 }
    health: 4
    speed: 110
    accuracy: 1
    defense: 10
    perception: 6
    damage: { count: 1, sides: 3, bonus: 0 }
    armor: 0
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 10, arcane: 0 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    behaviorParameters: {}
    threat: 1
    rarity: common
```

Monsters are reusable creature definitions. Population frequency and composition belong to encounter entries, allowing one monster to participate in several encounter types.

## NPC and NPC-faction entries

An `npc` is a presented actor with `glyph`, `color`, a valid `factionId`, positive attributes, `health`, `speed`, `perception`, `accuracy`, and `defense`, non-negative `armor`, damage dice, all six resistances, and `selfPreservationThresholdBps` from `1` through `10000`. NPC disposition is closed to `neutral`; the available behavior is `npc-behavior.travelling-merchant`, whose `behaviorParameters` object is strict and empty.

An `npc-faction` declares safe-integer `minimumReputation`, `maximumReputation`, and `startingReputation`, plus non-empty `tiers`. The starting value must be inside the bounds. Each tier has a unique slug `tierId`, display `name`, inclusive `minimum` and `maximum`, positive `purchasePriceBps` and `salePriceBps`, `acceptsTrade`, and `serviceIds`. Tiers are sorted by minimum and must cover every integer in the faction range exactly once: no gaps or overlaps. The only service ID is `merchant-service.identify`.

The bundled `npc-faction.lampwrights` spans `-1000..1000`, starts at `0`, and uses `refused` (`-1000..-251`, `15000`/`5000`, no trade/services), `wary` (`-250..-1`, `13000`/`7000`, trade/no services), `neutral` (`0..249`, `11000`/`9000`, trade/identify), and `trusted` (`250..1000`, `9000`/`10000`, trade/identify). The neutral `npc.travelling-lampwright` uses threshold `3500`.

## Encounter entries

An `encounter` has a strict `model` of `individual`, `group`, `swarm`, `boss`, or `merchant`. All models share:

- The common `kind`, `id`, `name`, and `tags` fields described above. `kind` is exactly `encounter`.
- Positive inclusive `minDepth` and `maxDepth`, positive selection `weight`, `rarity`, `environmentTags`, and `requiredVaultTags`.
- Optional `adminDescription` (plain text up to 500 characters) for operator-facing balance notes. It is required when supernatural collapse grants individual rewards.
- A run-level `runAppearanceChance` from 0 through 1, rolled once and saved. `discoveryProtectionIncrement` raises a later run's chance after eligible depth was reached without observation, up to `discoveryProtectionCap`. The cap cannot be below the base chance.
- Positive `maximumInstancesPerRun`; bosses require exactly one.
- `placement` with non-negative stair/objective distances and member spread, non-empty `allowedTerrainTags`, `requiresVaultSlot`, and `failureMode` of `optional` or `required`. Placement is atomic and preserves required routes.
- `intentPresentation.visible`, which permits broad visible intent but never exposes exact goals, paths, rolls, or shared knowledge.

### Hard encounter allocation bounds

Positive safe integer validation is necessary but not sufficient: values can be valid JavaScript integers yet still exceed the engine's bounded random-selection or allocation budget. The compiler rejects the complete pack when any of these limits is exceeded:

- Aggregate encounter selection weight: at most `4294967296` (`2^32`). This is the checked sum of every encounter `weight`, not a per-entry limit.
- Individual or aggregate group members per encounter: at most `1024`. For a group, the compiler checks the sum of every role's `maximumQuantity`.
- Aggregate swarm `spawnRoles[].weight`: at most `4294967296` (`2^32`).
- Swarm children created per spawn: at most `256`.
- Living children per swarm: at most `1023`.
- Living members per swarm encounter: at most `1024`. The source counts as one living member.
- Living swarm actors per floor: at most `1024`.

The exact boundary is valid. Boundary plus one is rejected before selection, RNG consumption, or actor allocation. Common errors include assigning several individually valid weights whose checked sum exceeds `2^32`, authoring group roles whose maximum quantities total `1025`, or setting a swarm cap to `1025` because the value is still a positive safe integer.

### Encounter field reference

| Field | Models | Rules and rejection modes |
|---|---|---|
| `definition` | All | Strict model-specific object. Its shape must match `model`; fields from another model and unknown nested fields reject the complete pack. |
| `intentPresentation`, `visible` | All | `intentPresentation` is required and contains only boolean `visible`. This controls broad observable intent, never exact targets, paths, rolls, or relayed hidden knowledge. |
| `runAppearanceChance`, `discoveryProtectionIncrement`, `discoveryProtectionCap` | All | Probabilities are 0–1. Discovery values default to zero only for merchants; all other models must declare them, and their cap must be at least the base chance. |
| `maximumInstancesPerRun` | All | Positive; exactly 1 for a boss. Placement refuses additional instances after this saved run cap. |
| `minimumStairDistance`, `minimumObjectiveDistance`, `maximumMemberDistance` (under `placement`) | All | Non-negative integers. A placement that cannot preserve distances, routes, occupancy, and member spread is rejected atomically. |
| `allowedTerrainTags`, `requiresVaultSlot`, `failureMode` (under `placement`) | All | Terrain tags are non-empty. A required vault slot must match all vault tags; `optional` skips an impossible placement while `required` rejects floor creation. |
| `minimumQuantity`, `maximumQuantity` | Individual | Positive inclusive range with maximum at least minimum and no more than 1,024 members. |
| `roles`, `roleId` | Group | `roles` is a non-empty list with unique slug `roleId` values. Each role has a valid `monsterId`, quantity range, `formationPreference`, and strict `behaviorParameters`. |
| `communicationRadius`, `coordinationModifiers` | Group | Radius is positive and used for hop-by-hop relay; disconnected members receive no shared observation. `coordinationModifiers` requires safe-integer `accuracy`, `defense`, and `damage`. |
| `leaderChance`, `leaderRoleId`, `leaderDeathResponse` | Group | `leaderChance` is 0–1, the leader role must exist, and the response uses its exact registered parameters. |
| `leaderAccentColor`, `leaderAlternateGlyph` | Group | Accent is required `#RRGGBB`; alternate glyph is either one Unicode glyph or null. These identify the leader without changing the referenced monster. |
| `responseParameters` | Group, Swarm | Strict parameters selected by the corresponding registered leader-death or source-destruction response. Unknown and missing parameters reject the pack. |
| `supernaturalBond`, `collapseRewards` | Group | `collapse` requires the bond. Individual rewards additionally require an `adminDescription`; otherwise compilation fails. |
| `sourceMonsterId` | Swarm | Valid monster reference carrying the `swarm-source` tag. It identifies the one source actor that owns the spawn timer. |
| `spawnInterval`, `minimumSpawnQuantity`, `maximumSpawnQuantity` | Swarm | Positive source-owned interval and positive inclusive birth range, with maximum at least minimum and at most 256 children per spawn. Off-floor time is frozen and missed births are never replayed. |
| `placementRadius` | Swarm | Positive maximum distance from the source for each atomic spawn attempt. The nested swarm `allowedTerrainTags` list is non-empty. |
| `maximumLivingChildren`, `maximumLivingMembers`, `maximumFloorActors` | Swarm | Positive nested caps: at most 1,023 children, 1,024 encounter members including the source, and 1,024 floor swarm actors. Children cannot exceed members, and members cannot exceed the floor cap. |
| `sourceDestructionResponse` | Swarm | One registered `stop`, `flee`, `decay`, or `frenzy` response with no unknown parameters. |
| `phases`, `phaseId`, `healthThresholdPercent` | Boss | `phases` is the ordered phase list. Each unique slug `phaseId` has a unique positive threshold below 100; thresholds strictly descend, are crossed once, and never reverse after healing. Each phase also declares registered behavior, strict parameters, modifiers, and effects. |
| `behaviorId`, `behaviorParameters` | Boss phase | Registered behavior ID and its strict parameter object. The behavior must be supported by the closed behavior registry. |
| `effects`, `effectId`, `parameters`, `requiresLivingTarget` | Boss phase | Ordered safe-subset effects. Each effect declares its registered `effectId`, strict `parameters`, and boolean `requiresLivingTarget`; unsafe actor-context effects reject the pack. |
| `recoveryPerWorldTime`, `recoveryCapPercent` | Boss | The rate is finite and non-negative and the cap is 0–100. Recovery occurs once on re-entry from elapsed absence and never exceeds the cap. |
| `uniqueItemId`, `enhancedLootTableId` | Boss | References must resolve to an item and loot table. The guaranteed item is created at most once and its content cannot appear in any ordinary loot graph. |
| `vaultTags` | Boss | Optional slug list constraining the authored arena or vault context. References that cannot satisfy required placement reject atomically according to `failureMode`. |
| `npcId`, `stockLootTableId` | Merchant | Valid NPC and loot-table references. The complete stock graph is checked with cycle protection. |
| `minimumStockRolls`, `maximumStockRolls` | Merchant | Positive inclusive range; maximum is at least minimum. |
| `merchantSaleBps`, `merchantPurchaseBps` | Merchant | Positive basis-point multipliers. |
| `acceptedCategories` | Merchant | Non-empty item categories: `weapon`, `ammunition`, `armor`, `shield`, `light`, `fuel`, `food`, `potion`, `scroll`, `ring`, or `misc`. |
| `services`, `serviceId`, `basePrice`, `minimumUses`, `maximumUses`, `tierIds` | Merchant | Unique `merchant-service.identify` or `merchant-service.strongbox` offers have non-negative price/use bounds, maximum uses at least minimum uses, and reference tiers that enable the offered service in the NPC faction. A `merchant-service.strongbox` offer additionally requires `minimumUses` and `maximumUses` of exactly `1`. |
| `permanent` | Merchant | Required boolean. `true` marks a fixed town shopkeeper that never departs; `false` marks an ordinary dungeon-wandering merchant. |
| `minimumLifetime`, `maximumLifetime`, `departureWarningThresholds` | Merchant | Optional in the source schema, but conditionally required: `permanent: true` forbids all three; `permanent: false` requires all three. When present, lifetime is a positive range and warnings are unique, strictly descending, and below the minimum lifetime. |
| `aggressionResponse` | Merchant | Closed to `flee` or `self-defense`. |
| `commerceReputationDelta`, `aggressionReputationDelta`, `deathReputationDelta` | Merchant | Safe-integer reputation changes. |
| `stockDropFraction` | Merchant | Probability from 0 through 1. |
| `fallbackMonsterId`, `fallbackItemId` | Fallen Champion | Required valid references used when historical monster or equipment content has been removed. |
| `echoAppearanceChance`, `maximumEchoesPerRun` | Fallen Champion | Each rank 2–10 is independently gated, then the lowest rolls are retained up to the run cap. |
| `echoHealthPercent`, `echoDamagePercent`, `echoDefensePercent`, `echoAbilityLimit` | Fallen Champion | Echo values must be strictly weaker than Champion values and the ability limit cannot exceed the Champion limit. |
| `echoLootTableId` | Fallen Champion | Ordinary enhanced loot only; a table containing a boss-unique item is rejected. |
| `rarityWeights`, `qualityRankBonus` (under `heirloomSelection`) | Fallen Champion | Positive nondecreasing rarity weights plus a non-negative quality bonus select exactly one equipped item instance. |

An `individual` definition has `monsterId`, `minimumQuantity`, and `maximumQuantity`. A `group` has unique roles, a `formation` (`cluster`, `line`, `screen`, `wedge`, or `surround`), positive `communicationRadius`, leader probability and role, accent/glyph, integer coordination modifiers, and a leader response. Role `formationPreference` is `front`, `center`, `rear`, `flank`, or `free`.

Leader responses are `weaken`, `panic`, `disband`, `surrender`, `frenzy`, and `collapse`. `weaken` requires integer combat `modifiers`; `panic` requires positive `duration`; `frenzy` requires both; the other responses require `{}`. `collapse` requires `supernaturalBond: true`; `collapseRewards` explicitly chooses `none` or `individual`. Groups relay knowledge only across range-connected members and freeze on inactive floors.

A `swarm` source monster must carry the `swarm-source` tag. `spawnRoles` are weighted monster references. The source alone owns `spawnInterval`; inclusive spawn quantities, placement radius/terrain, `maximumLivingChildren`, `maximumLivingMembers`, and `maximumFloorActors` bound growth. Source responses are `stop` and `flee` with `{}`, `decay` with positive `interval` and `damage`, or `frenzy` with positive `duration` and integer combat `modifiers`. Swarms freeze off-floor and never catch up missed growth.

A `boss` references one monster, strictly descending unique phase thresholds, registered phase behaviors/effects, recovery rate and cap, one `uniqueItemId`, one `enhancedLootTableId`, and optional vault tags. Boss phases use the closed safe subset `effect.damage`, `effect.heal`, `effect.condition.apply`, `effect.condition.remove`, `effect.reveal`, `effect.fuel.transfer`, `effect.light.toggle`, and `effect.feature.mutate`. Actor-context effects `effect.hunger.restore`, `effect.item.consume`, and `effect.force-move` are rejected in boss phases. Phases never reverse. Recovery is one bounded re-entry calculation, not off-floor turns. The bundled default boss chance is `0.08`, increment `0.03`, and cap `0.35`.

A `merchant` resolves `minimumStockRolls..maximumStockRolls` from its stock loot table. Every reachable stock item must have a positive price and must not be boss-guaranteed unique or tagged `heirloom`, `quest`, `objective`, or `nontransferable`. The bundled travelling Lampwright appears at depths `1..10` with chance `0.25`, production rarity `uncommon`, discovery increment/cap `0`, and at most `2` instances. It resolves `1..2` stock rolls, uses sale/purchase multipliers `12000`/`6000`, offers `1..2` identify uses at base price `10`, is not `permanent`, lives `3000..5000`, warns at `[1000, 500, 100]`, uses `flee`, applies reputation deltas `25`, `-300`, and `-200`, and drops stock fraction `0.5`.

A `permanent` merchant (`permanent: true`) is a fixed town shopkeeper: it never departs, so it must omit `minimumLifetime`, `maximumLifetime`, and `departureWarningThresholds` entirely. The three bundled town merchants — the Provisioner, the Armorer, and the Curios Dealer — are each `permanent: true`, each carries a distinct NPC faction and stock loot table, and each declares `requiredVaultTags: [town]` so placement resolves only against the `town` vault. The `merchant-service.strongbox` service, offered by the Town Provisioner at base price `120` across every faction tier, lets a hero rent house storage; because a strongbox purchase is one-time per merchant relationship, its offer requires `minimumUses` and `maximumUses` of exactly `1`. Restocking a permanent merchant's stock loot table is driven by the balance entry's `restockMilestones`.

Merchant prices are exact integer arithmetic in basis points; quotes never round through floats:

- A hero purchase quotes `basePrice * merchantSaleBps * tier purchasePriceBps / 10000^2`, rounded up, with a minimum price of `1` whenever the product is nonzero.
- A hero sale pays `basePrice * merchantPurchaseBps * tier salePriceBps / 10000^2`, rounded down, so a merchant never overpays.
- A service quotes `basePrice * tier purchasePriceBps / 10000`, rounded up, with the same nonzero minimum of `1`.
- Every quote and running currency total must stay a non-negative safe integer; a transaction that would overflow is rejected atomically.

Trade eligibility is two-sided: the merchant must accept the item's category (`acceptedCategories`), the item must sit in the hero's own backpack (equipped or foreign items are refused), and heirlooms, boss uniques, and the tagged exclusions above are never transferable in either direction. The hero's spendable currency starts at the balance entry's `startingCurrency` and changes only through quoted trades and services.

Lifetime is rolled once at materialization inside `minimumLifetime..maximumLifetime`; each authored `departureWarningThresholds` value is emitted exactly once as remaining time crosses it, on any floor. A due merchant departs with all held stock even while its floor is inactive and never takes catch-up actor turns; an open trade defers the departure only while the modal session remains valid. On the first hero provocation the merchant applies `aggressionReputationDelta` once, switches to its authored `aggressionResponse` (`flee` or `self-defense`), and drops exactly `ceil(total stock units * stockDropFraction)` units at its cell — the ceiling rule guarantees any positive fraction drops at least one unit. Killing a merchant applies `deathReputationDelta` once (hero kills only) and destroys the remaining held stock. An explicit player close after completed commerce grants `commerceReputationDelta` at most once per merchant.

Client contract: when a trade command resolves as invalid, any events attached to the result (for example `trade.closed` or `merchant.departed`) are authoritative and must be applied by the client; an invalid command may carry state-changing normalization events without a revision bump. A merchant fleeing a monster keeps its lifecycle `available`, so a trade may open mid-flee whenever the adjacency and visibility preflights pass.

Runs persist with save schema version `5`, which adds faction `reputations`, the modal `activeTrade` session, merchant populations, and the dedicated `merchant-stock` and `merchant-runtime` RNG streams. Schema-v4 saves migrate to v5 automatically on load with empty merchant state; unknown save versions are rejected.

Run records raise the current save format to schema version `6`, which adds the typed run `metrics` registry, the explicit run `conclusion` (completion type, cause, `concludedAtRevision`, `finalized`), and the derived `run-records` RNG stream that seeds heirloom selection. The single ordered v5→v6 migration preserves every v5 field byte-for-byte and adds zeroed metrics, a null conclusion, and the derived `run-records` stream; migrated saves re-validate through the strict v6 decoder, and every other version stays rejected. New runs start with zeroed metrics and no conclusion. On the content side, schema version `6` added the `class`, `background`, and `trait` kinds and the balance `pointBuy` attribute table described above, on top of the `achievement` kind and the balance `score` coefficients added at v5.

Content schema version `7` adds the town slice: a `permanent` merchant flag, the `merchant-service.strongbox` service, the balance `restockMilestones`, `house`, and `encounterDensity` blocks, and a tag-scoped `town` vault contract, all described in their respective sections below. Every bundled source file declares `schemaVersion: 7`, and the compiled pack hash covers the new entries.

```yaml
schemaVersion: 7
entries:
  - kind: encounter
    id: encounter.cave-rat-individuals
    name: Cave rat stragglers
    tags: [animal, early]
    model: individual
    minDepth: 1
    maxDepth: 6
    environmentTags: []
    requiredVaultTags: []
    weight: 10
    rarity: common
    runAppearanceChance: 1
    discoveryProtectionIncrement: 0
    discoveryProtectionCap: 1
    maximumInstancesPerRun: 24
    placement: { minimumStairDistance: 3, minimumObjectiveDistance: 3, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.cave-rat, minimumQuantity: 1, maximumQuantity: 2 }
```

The bundled `content/encounters/early-populations.yaml` is the complete copyable reference for group, swarm, and boss definitions. Add new `.yaml` or `.yml` files anywhere under the complete content directory, then run `npm run content:validate -- /absolute/path/to/content` and `npm run population:demo -- --content-dir /absolute/path/to/content`. Common rejections include unknown or misspelled fields; duplicate IDs, roles, or phases; a missing or wrong-kind monster/item/loot reference; an ascending phase threshold; an unsafe boss effect; an untagged swarm source; inconsistent caps; impossible required placement; `collapse` without a supernatural bond; an Echo that is not strictly weaker; an Echo loot table containing a boss-unique item; or a boss instance limit other than one.

Population actors, group communication, swarm timers, and boss recovery do not simulate while their floor is inactive. The saved clock and population state resume deterministically when the floor becomes active; swarms do not accumulate catch-up births, while bosses calculate their single bounded re-entry recovery from saved exit time.

## Fallen-champion template

The optional single `fallen-champion-template` normalizes the current profile or guest session's ranked fallen heroes. Rank 1 becomes the guaranteed optional Deep's Champion; independently gated ranks 2–10 may become weaker `Echo of <Hero Name>` bosses.

It uses the common `kind`, `id`, `name`, and `tags` fields; `kind` is exactly
`fallen-champion-template`. Every other supported field is listed below and unknown nested fields reject
the entire pack.

- `fallbackMonsterId` and `fallbackItemId` handle removed historical content.
- `minimumHealth`, `maximumHealth`, `attributeMaximum`, `damageMaximum`, and `abilityLimit` cap Champion power.
- `echoAppearanceChance` is independently rolled once per rank 2–10. Passing candidates with the lowest rolls are retained up to `maximumEchoesPerRun`; bundled content caps this at two.
- `echoHealthPercent`, `echoDamagePercent`, and `echoDefensePercent` are positive percentages below 100. `echoAbilityLimit` cannot exceed the Champion limit.
- `echoLootTableId` supplies enhanced ordinary loot. Echoes never drop recorded heirlooms or guaranteed unique rewards. They cannot repeat in one run but may return in later runs.
- `heirloomSelection.rarityWeights` contains positive nondecreasing `common`, `uncommon`, `rare`, and `legendary` weights. `qualityRankBonus` is non-negative.

The Champion heirloom is selected once at the original death from unique equipped item instances only. Backpack items never qualify, and a multi-slot item is still one candidate. Better rarity and positive quality ranks raise its weight, but common equipment retains a non-zero chance. There is no minimum rarity and no reroll, so damaged, depleted, or mundane equipped gear remains possible. If nothing equipped is eligible, the fallback relic is recorded.

```yaml
schemaVersion: 7
entries:
  - kind: fallen-champion-template
    id: fallen-champion-template.core
    name: The Deep's Champion
    tags: [boss, champion]
    fallbackMonsterId: monster.ashen-warden
    fallbackItemId: item.champion-fallback-relic
    minimumHealth: 18
    maximumHealth: 180
    attributeMaximum: 30
    damageMaximum: 30
    abilityLimit: 3
    echoAppearanceChance: 0.08
    maximumEchoesPerRun: 2
    echoHealthPercent: 65
    echoDamagePercent: 70
    echoDefensePercent: 80
    echoAbilityLimit: 2
    echoLootTableId: loot-table.ashen-warden
    heirloomSelection:
      rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 }
      qualityRankBonus: 2
```

## Item entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `glyph`, `color` | glyph and `#RRGGBB` | Yes | Floor/inventory presentation. |
| `minDepth`, `maxDepth` | positive safe integers | Yes | Inclusive generation range. |
| `category` | enum | Yes | `weapon`, `ammunition`, `armor`, `shield`, `light`, `fuel`, `food`, `potion`, `scroll`, `ring`, or `misc`. |
| `stackLimit` | positive safe integer | Yes | Maximum quantity per stack. |
| `price` | non-negative safe integer | Yes | Base economy value. |
| `rarity` | enum | Yes | `common`, `uncommon`, `rare`, or `legendary`. |
| `heirloomEligible` | boolean | Defaults to true | Whether the item may be recorded as a Champion heirloom. Set false for objectives, quest tokens, currency, and other non-transferable items. |
| `actionCost` | non-negative safe integer | Yes | Use/equip action cost. |
| `equipment` | object or null | Yes | Slots, handedness, and reserved slots. |
| `combat` | object or null | Yes | Accuracy, defense, armor, optional damage dice, non-negative range, and optional ammunition tag. A non-null ammunition tag must match a tag on an ammunition item. |
| `light` | object or null | Yes | RGB color, radius 1–32, strength 1–255, positive fuel capacity/use, descending unique warning thresholds no greater than capacity, and accepted fuel tags. |
| `identification` | object | Yes | Mode `known`, `shuffled`, or `instance`, plus a separate identification-pool reference under the rules below. The item `name` is always its real, identified name. |
| `effects` | effect array | Yes | Ordered primitive effects, possibly empty. |

Equipment `slots` use `main-hand`, `off-hand`, `body`, `head`, `hands`, `feet`, `neck`, `left-ring`, or `right-ring`. Handedness is `one-handed`, `two-handed`, or `none`. Two-handed items use `main-hand` and reserve `off-hand`; a slot cannot also be reserved.

Category compatibility is strict: weapons require equipment plus damage; armor and shields require equipment plus non-damaging combat values; light items require a `light` object; and ammunition cannot be equipped or emit light. `fuelTags` are matched against tags on fuel item definitions. An empty `fuelTags` list describes a non-refillable light.

Identification modes have distinct contracts:

- `known` uses `poolId: null` and always presents the item's real name, glyph, and color.
- `shuffled` references an `identification-pool`. At run creation, the engine assigns each item definition a unique random verb–noun name and a random visual from that pool. Learning one shuffled appearance identifies every matching instance during that run.
- `instance` also references an `identification-pool`, but learning an item's properties applies only to that physical item. Its unidentified name still comes from the run mapping.

Items never contain their unidentified names. The generated mapping is saved with the run, so save/reload cannot reroll it, and a later run receives a new mapping. Items using the same pool must have the pool's category. The compiler requires at least as many unique verb–noun combinations as item definitions using the pool.

```yaml
schemaVersion: 7
entries:
  - kind: item
    id: item.brass-lantern
    name: Brass lantern
    glyph: "¤"
    color: "#e8c879"
    tags: [light, utility]
    minDepth: 1
    maxDepth: 20
    category: light
    stackLimit: 1
    price: 24
    rarity: common
    actionCost: 100
    equipment: { slots: [off-hand], handedness: one-handed, reservedSlots: [] }
    combat: null
    light:
      color: [255, 198, 92]
      radius: 7
      strength: 180
      fuelCapacity: 2400
      fuelPerTime: 1
      warningThresholds: [600, 300, 100]
      fuelTags: [lamp-oil]
    identification: { mode: known, poolId: null }
    effects: []
```

## Identification-pool entries

Identification pools are normal content-pack entries and may be placed in any `.yaml` or `.yml` file. `verbs` and `nouns` are non-empty word lists. Their Cartesian product supplies unique run-local names in `Verb noun` form. `visuals` supplies one or more random glyph/color combinations; visual IDs must be unique within the pool. Duplicate verbs or nouns are rejected because they could produce duplicate names.

The pool's `name` is an administrator-facing label. It is not shown as an unidentified item name.

```yaml
schemaVersion: 7
entries:
  - kind: identification-pool
    id: identification-pool.potions
    name: Potion unidentified names
    tags: [identification, potion]
    category: potion
    verbs: [Bubbling, Dancing, Smoking, Whispering]
    nouns: [draught, flask, phial, vial]
    visuals:
      - { id: visual.amber-glass, glyph: "!", color: "#c58745" }
      - { id: visual.cobalt-glass, glyph: "¡", color: "#5277b8" }
```

An item references the pool but declares only its real name:

```yaml
identification: { mode: shuffled, poolId: identification-pool.potions }
```

## Spell entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `targetingId` | registered ID | Yes | One closed targeting rule below. |
| `range` | non-negative safe integer | Yes | Chebyshev targeting distance. |
| `actionCost` | positive safe integer | Yes | Scheduler energy cost. |
| `effects` | non-empty effect array | Yes | Applied in listed order. |

```yaml
schemaVersion: 7
entries:
  - kind: spell
    id: spell.mend
    name: Mend
    tags: [healing]
    targetingId: target.self
    range: 0
    actionCost: 100
    effects:
      - effectId: effect.heal
        parameters: { dice: { count: 1, sides: 6, bonus: 2 } }
        requiresLivingTarget: true
```

## Trap entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `glyph`, `color` | glyph and `#RRGGBB` | Yes | Revealed presentation. |
| `targetingId` | registered ID | Yes | Trigger target rule. |
| `discoveryDifficulty`, `disarmDifficulty` | non-negative safe integers | Yes | Search and disarm thresholds. |
| `disarmOutcomes` | object | Yes | `failure` and `criticalFailure` are `safe`, `tool-damage`, or `trigger`; positive `toolDamage` is removed from an equipped item tagged `disarm-tool`. |
| `resetMode` | enum | Yes | `once`, `reset`, or `disabled`. |
| `effects` | non-empty effect array | Yes | Ordered trigger effects. |

```yaml
schemaVersion: 7
entries:
  - kind: trap
    id: trap.poison-dart
    name: Poison dart
    glyph: "^"
    color: "#8cab72"
    tags: [mechanical, poison]
    targetingId: target.actor
    discoveryDifficulty: 8
    disarmDifficulty: 10
    disarmOutcomes: { failure: safe, criticalFailure: trigger, toolDamage: 10 }
    resetMode: once
    effects:
      - effectId: effect.damage
        parameters: { damageType: poison, dice: { count: 1, sides: 4, bonus: 0 } }
        requiresLivingTarget: true
```

## Loot-table entries

Loot expansion is bounded across the complete reachable graph, including nested tables. Positive safe integers alone do not make a table safe: all local limits and the recursive worst case must pass together.

- Aggregate `choices[].weight` per loot table: at most `4294967296` (`2^32`).
- Loot-table `rolls`: at most `256`.
- Each loot choice quantity: at most `256` and no greater than the direct item's `stackLimit`.
- Recursive worst-case created loot units: at most `4096`.

The recursive calculation follows the most expensive possible choice at every roll and multiplies through nested-table quantities and rolls using checked arithmetic. The exact boundary is accepted; `4097` worst-case units, `257` rolls, `257` quantity, or a checked weight sum of `4294967297` rejects the pack before any loot RNG is consumed or items are created.

Boss guaranteed-unique content is forbidden anywhere in an ordinary loot graph, including another boss enhanced-loot table or an Echo loot table. A Champion heirloom may legitimately use the same item content because its saved provenance and item identity are distinct; ordinary weighted loot may not.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `rolls` | positive safe integer | Yes | Independent selections; maximum 256. |
| `choices` | non-empty array | Yes | Weighted choices. |
| `choices[].contentId` | item content ID or null | Yes | Direct result; it must resolve to an `item`, and exactly one reference field is non-null. |
| `choices[].lootTableId` | loot-table ID or null | Yes | Nested result; cycles are rejected. |
| `choices[].weight` | positive safe integer | Yes | Relative selection weight; the checked table sum cannot exceed `2^32`. |
| `minimumQuantity`, `maximumQuantity` | positive safe integers | Yes | Inclusive quantity range; maximum cannot be smaller, cannot exceed 256, and for a direct item cannot exceed its `stackLimit`. |
| `choices[].minDepth`, `choices[].maxDepth` | safe integers 0–999 | No | Optional per-choice depth band. Absent means unbanded: the choice is always available, matching prior behavior. When present, `0 <= minDepth <= maxDepth <= 999`; `minDepth` may be given alone to mean "available from this depth onward." Town merchant restocks use these bands to widen their stock at `balance.restockMilestones` so deeper runs surface new goods. Honoring the band during loot and stock rolls is engine work tracked separately from this content-layer authoring and validation. |

```yaml
schemaVersion: 7
entries:
  - kind: loot-table
    id: loot-table.basic-supplies
    name: Basic supplies
    tags: [supply]
    rolls: 1
    choices:
      - { contentId: item.brass-lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

Typical diagnostics identify the table or choice path and the violated contract, for example:

```text
loot choice weight total exceeds rollDie maximum 2^32
loot table rolls exceed runtime-safe limit 256
loot choice quantity exceeds item stack limit 4
loot table worst-case created units exceed runtime-safe limit 4096
guaranteed boss-unique item item.warden-ember cannot appear in ordinary loot
```

## Vault entries

| Field | Type | Required/default | Rules and meaning |
|---|---|---|---|
| `minDepth`, `maxDepth` | safe integers | Required | Inclusive placement range. Positive for every ordinary vault; a vault tagged `town` is the sole exception and must declare exactly `0` and `0`. |
| `rarity` | enum | Required | `common`, `uncommon`, `rare`, or `legendary`. |
| `weight`, `maxPerFloor` | positive safe integers | Required | Selection weight and placement cap. |
| `margin` | non-negative safe integer | Required | Required surrounding space. |
| `transforms.rotations` | sorted unique array | Required | One or more of 0, 90, 180, and 270. |
| `transforms.reflectHorizontal` | boolean | Defaults to false | Allow horizontal reflection. |
| `layout` | string array | Required | 1–100 rows, each at most 160 Unicode code points. |
| `legend` | symbol map | Required | Each symbol defines terrain and at most one entrance, light, or slot action. |

Terrain is `wall`, `floor`, `closed-door`, `pillar`, `stair-up`, `stair-down`, or `void`. A placement slot kind is `monster`, `item`, `trap`, `npc`, `fixture`, or `objective`. Slot IDs are vault-local slugs. Required slots must occur in the layout. Lights require a local suffix, one glyph, stable presentation token, RGB color, radius 1–32, strength 1–255, and optional enabled state (default true). Void terrain cannot contain lights or placement slots.

```yaml
schemaVersion: 7
entries:
  - kind: vault
    id: vault.small-cache
    name: Small cache
    tags: [cache]
    minDepth: 1
    maxDepth: 8
    rarity: uncommon
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0, 90, 180, 270], reflectHorizontal: true }
    layout: ["#####", "#+i.#", "#####"]
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "i":
        terrain: floor
        slot: { id: item-cache, kind: item, required: true, tags: [cache] }
```

### The `town` vault

A vault tagged `town` carries additional structural requirements enforced on top of the ordinary rules above:

- `minDepth` and `maxDepth` must both be `0`.
- Its required placement slots must be exactly the five: `dungeon-entrance`, `house-door`, `merchant-provisioner`, `merchant-arms`, and `merchant-curios` — no more, no fewer.
- The `dungeon-entrance` slot's legend entry must use `stair-down` terrain.
- The legend must declare at least one light fixture, in addition to the ordinary requirement of at least one entrance.

The bundled `content/vaults/town.yaml` is the complete copyable reference: a walled town square with three merchant stalls (each holding one of the three required merchant slots and a light fixture), an enclosed house with a single `house-door` closed-door slot, a `dungeon-entrance` slot on a stair-down tile, and additional walkway lights.

## Condition entries

| Field | Type | Required/default | Rules and meaning |
|---|---|---|---|
| `description` | string | Required | Trimmed plain text, 1–500 characters. |
| `color` | `#RRGGBB` | Required | Status presentation color. |
| `duration.mode` | enum | Required | `timed` or `permanent`. |
| `duration.default`, `duration.maximum` | integers or null | Required | Timed values are positive and default cannot exceed maximum; permanent values are null. |
| `stacking.mode` | enum | Required | `replace`, `refresh`, or `intensify`. |
| `stacking.maximumStacks` | positive safe integer, maximum 100 | Required | Must be 1 for replace and refresh. |
| `modifiersPerStack` | derived-stat integer map | Defaults to `{}` | Supported keys: `maxHealth`, `meleeAccuracy`, `meleeDamageBonus`, `rangedAccuracy`, `defense`, `search`, and `disarm`. |
| `traits` | sorted unique registered-ID array | Defaults to `[]` | Closed engine rules described below. |

Replace and refresh produce one stack; intensify adds one up to the cap. Every reapplication refreshes source, application time, and deadline. Timed applications may omit duration to use the default or supply a positive override no greater than the maximum. Permanent conditions reject an override. Removal and expiration remove the complete condition instance.

```yaml
schemaVersion: 7
entries:
  - kind: condition
    id: condition.stunned
    name: Stunned
    description: Cannot take normal actions or reactions.
    tags: [control, harmful]
    color: "#d8c46a"
    duration: { mode: timed, default: 100, maximum: 500 }
    stacking: { mode: intensify, maximumStacks: 3 }
    modifiersPerStack: { defense: -2 }
    traits: [condition-trait.incapacitated, condition-trait.suppresses-reactions]
```

## Achievement entries

An `achievement` names a permanent account milestone. Beyond the common `id`, `name`, and `tags` fields it accepts exactly two kind-specific fields; unknown fields are rejected.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `description` | string | Yes | Trimmed non-empty text, at most 200 characters. |
| `criteriaId` | registered ID | Yes | One entry from the closed criteria registry below. Each criterion may be claimed by at most one achievement per pack. |

The closed achievement criteria registry contains exactly `first-champion-defeat` (first defeat of the Deep's Champion) and `first-echo-defeat` (first defeat of a fallen hero's Echo). New criteria require a code change; unknown criteria IDs fail compilation.

```yaml
schemaVersion: 7
entries:
  - kind: achievement
    id: achievement.defeated-the-deeps-champion
    name: Defeated the Deep's Champion
    tags: [fallen-hero, prestige]
    description: Defeat the Deep's Champion for the first time.
    criteriaId: first-champion-defeat
  - kind: achievement
    id: achievement.silenced-an-echo
    name: Silenced an Echo
    tags: [fallen-hero]
    description: Defeat an Echo of a fallen hero for the first time.
    criteriaId: first-echo-defeat
```

## Class, background, and trait entries

`class`, `background`, and `trait` are the three chargen content kinds. Each carries a `description` (trimmed, 1–300 characters).

### Class entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `playable` | boolean | Yes | Whether the class is available at chargen. |
| `silhouetteGlyph` | one Unicode glyph | Yes | Character-select silhouette marker. |
| `unlockHint` | string or null | Yes | Required non-empty text (at most 200 characters) when `playable` is `false`, describing how to unlock the class; must be `null` when `playable` is `true`. |
| `classTags` | non-empty slug array | Yes | Descriptive class taxonomy. |
| `kits` | array of kit definitions, at most 3 | Yes | Starting-loadout choices. A playable class requires at least 2 kits; a locked class may declare 0 through 3. |

Each kit has a slug `kitId` unique within the class, a display `name`, an `equipped` array, and a `backpack` array.

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `equipped[].contentId` | item reference | Yes | Must resolve to an `item` entry. |
| `equipped[].slot` | equipment slot enum | Yes | Must be one of the slots the referenced item's `equipment.slots` allows. |
| `equipped[].enabled` | boolean | Defaults to `true` | Whether the item starts equipped and active. |
| `backpack[].contentId` | item reference | Yes | Must resolve to an `item` entry. |
| `backpack[].quantity` | positive safe integer | Defaults to `1` | Starting stack size. |

```yaml
schemaVersion: 7
entries:
  - kind: class
    id: class.wayfarer
    name: Wayfarer
    tags: [chargen, playable]
    description: A traveller equally at home with blade or bow.
    playable: true
    silhouetteGlyph: "W"
    unlockHint: null
    classTags: [wayfarer]
    kits:
      - kitId: blade
        name: Blade
        equipped:
          - { contentId: item.iron-sword, slot: main-hand, enabled: true }
        backpack:
          - { contentId: item.travel-ration, quantity: 3 }
      - kitId: ranger
        name: Ranger
        equipped:
          - { contentId: item.hunting-bow, slot: main-hand, enabled: true }
        backpack:
          - { contentId: item.wooden-arrows, quantity: 20 }
  - kind: class
    id: class.archivist
    name: Archivist
    tags: [chargen, locked]
    description: A keeper of forbidden lore.
    playable: false
    silhouetteGlyph: "A"
    unlockHint: Read three lore fragments recovered from fallen champions to unlock the Archivist.
    classTags: [archivist]
    kits: []
```

### Background and trait entries

`background` and `trait` both carry a `modifiers` derived-stat integer map (non-zero safe-integer values, keys drawn from the same closed stat names as condition modifiers: `maxHealth`, `meleeAccuracy`, `meleeDamageBonus`, `rangedAccuracy`, `defense`, `search`, `disarm`). A `trait` must declare exactly one modifier key; a `background` may declare any number, including zero. A `background` additionally carries `extraItems`, an array of `{ contentId, quantity }` starting-inventory grants using the same shape as a class kit's `backpack`, each `contentId` resolving to an `item` entry.

```yaml
schemaVersion: 7
entries:
  - kind: background
    id: background.caravan-guard
    name: Caravan guard
    tags: [chargen]
    description: Years spent warding merchant caravans.
    modifiers: { defense: 1 }
    extraItems: []
  - kind: trait
    id: trait.keen-eyed
    name: Keen-eyed
    tags: [chargen]
    description: Sharp senses spot hidden things.
    modifiers: { search: 2 }
```

## Closed behavior registry

- `behavior.approach-and-attack`: parameters `{}`. Approaches a hostile target and attacks when able.
- `behavior.patrol`: parameters `{ waypoints: [{ x, y }, ...] }` with at least one safe-integer floor cell.
  While unaware, the actor paths to the first waypoint, advances to the next waypoint when standing on one,
  and wraps to the beginning. Current hostile observations and valid last-known investigations take precedence.

Unregistered behavior IDs and extra parameters fail compilation.

## Closed targeting registry

- `target.self`: the source actor.
- `target.actor`: one visible actor in range.
- `target.line`: a visible unobstructed line ending at a cell.
- `target.cell`: one visible cell in range.

Visibility includes field of view and nonzero illumination.

## Closed primitive-effect registry

Each effect has `effectId`, strict `parameters`, and optional `requiresLivingTarget` (default false). Effects execute in list order.

| Effect ID | Parameters |
|---|---|
| `effect.damage` | `damageType` and `dice` |
| `effect.heal` | `dice` |
| `effect.hunger.restore` | positive integer `amount`; restoration is capped at `hungerMaximum` and reports only the effective amount |
| `effect.condition.apply` | `conditionId`; optional positive `duration` |
| `effect.condition.remove` | `conditionId` |
| `effect.force-move` | positive `distance`, maximum 8 |
| `effect.reveal` | positive `radius`, maximum 32 |
| `effect.fuel.transfer` | positive `maximum` |
| `effect.light.toggle` | boolean `enabled` |
| `effect.item.consume` | positive `quantity` |
| `effect.feature.mutate` | stable `state` ID such as `door.open` |

Damage types are `physical`, `fire`, `cold`, `lightning`, `poison`, and `arcane`. Dice use the same bounded structure documented for monsters.

## Closed condition-trait registry

- `condition-trait.incapacitated`: excludes the actor from normal scheduling.
- `condition-trait.suppresses-reactions`: prevents the actor from making reactions.
- `condition-trait.avoids-opportunity-attacks`: prevents hostile opportunity attacks when the affected actor leaves reach.
- `condition-trait.interrupts-rest`: interrupts rest while active.
- `condition-trait.blocks-recovery`: prevents natural recovery while active.
- `condition-trait.prevents-movement`: prevents voluntary movement while allowing other actions unless another trait forbids them.

Traits may be combined. Descriptive tags never substitute for traits.

## Validation diagnostics

Validation errors report the relative file, structural entry path, and reason. Examples include:

```text
conditions/stun.yaml:$.entries.condition.stunned.stacking.maximumStacks: replace and refresh conditions require maximumStacks 1
items/venom.yaml:$.entries.item.venom.effects.0.parameters.conditionId: unknown condition reference condition.poisoned
```

Fix all reported issues and rerun `npm run content:validate -- /absolute/path/to/content`. Do not bypass startup validation or edit a compiled pack or database row directly.

## Content hashes, active runs, and rollback

The compiler sorts and materializes entries, then hashes the complete semantic pack. Active runs store that exact hash. Changing a value, ID, reference, effect order, condition trait, or vault layout produces a different hash.

Never silently attach an active run to a different content hash. Keep old content directories available while runs still depend on them, or end those development runs explicitly. For rollback:

1. Restore the previous complete read-only content directory.
2. Recreate the container.
3. Verify the previous expected hash and smoke test.
4. Admit play only after verification succeeds.

## Complete examples

Each content-kind section above contains a complete copyable `schemaVersion: 7` document. The bundled `content/` directory is also an executable reference and is validated in every repository test run. Copy the complete directory before customizing it; do not mount a partial overlay.
