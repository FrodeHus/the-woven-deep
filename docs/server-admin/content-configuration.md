# Server content configuration

The Woven Deep loads gameplay content from YAML when the server starts. Administrators can add and balance monsters, items, spells, traps, loot tables, vaults, conditions, and global balance values without rebuilding the application, provided they use the engine's supported behaviors, effects, targets, and condition traits.

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

Any parse, schema, reference, or semantic error rejects the entire pack at startup. The server never skips an invalid file or partially loads a directory.

## Directory and file discovery

- The compiler recursively reads regular files ending in `.yaml` or `.yml`.
- Directory names and filenames are organizational only. They do not become content IDs and do not affect the content hash.
- Entries from every file share one global ID namespace.
- Formatting, comments, and file ordering do not affect the hash. Material values and IDs do.
- YAML aliases and custom tags are rejected. Each file is limited to 262,144 UTF-8 bytes.
- A complete pack requires at least one `monster`, `item`, `vault`, and `balance` entry. Exactly one balance entry is permitted.
- Across the complete pack, entry tags must cover the foundational generation categories `defense`, `food`, `healing`, `identification`, `light`, and `offense`. These are compile-time coverage markers for pool reporting. They do not implement an item's mechanics; the kind-specific fields and registered effects do that.

A conventional layout is:

```text
content/
  balance/
  conditions/
  items/
  loot-tables/
  monsters/
  spells/
  traps/
  vaults/
```

## File envelope and common fields

Every file is one strict document:

```yaml
schemaVersion: 2
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
| `schemaVersion` | integer | Required | Must be exactly `2`. |
| `entries` | array | Required, at least one | May contain any supported content kind. |
| `kind` | enum | Required | One of `monster`, `item`, `spell`, `trap`, `loot-table`, `balance`, `vault`, or `condition`. |
| `id` | string | Required | Globally unique stable ID such as `monster.cave-rat`. |
| `name` | string | Required | Trimmed display name, 1–80 characters. |
| `tags` | slug array | Defaults to `[]` | Descriptive taxonomy. Tags never activate engine rules. |

## Identifiers and cross-file references

Stable IDs start with a lowercase letter and contain at least two dot-separated segments. Each segment contains lowercase letters, digits, or hyphens. Examples: `item.brass-lantern`, `condition.reaction-suppressed`, and `loot-table.depth-one`.

Slug values such as tags and vault-local slot IDs contain lowercase letters, digits, and hyphens without dots. All content IDs are globally unique, even when their kinds differ or they live in different files.

Cross-file references resolve after every file is parsed, so declaration order is irrelevant. References must resolve to the required kind. Direct loot choices must reference an `item`; nested choices must reference a `loot-table`, and loot-table cycles are rejected. A weapon's ammunition tag must match a tag on at least one ammunition item. Condition application and removal must reference a `condition`, and authored duration overrides must satisfy that condition's definition.

## Balance entries

A pack contains exactly one `balance` entry.

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

```yaml
schemaVersion: 2
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
    recoveryAmount: 1
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
    actionCosts: { action.move: 100, action.wait: 100 }
```

The closed action-cost IDs are `action.attack`, `action.cast`, `action.close-door`, `action.disarm`, `action.drop`, `action.equip`, `action.fire`, `action.move`, `action.open-door`, `action.pickup`, `action.refuel`, `action.search`, `action.split-stack`, `action.throw-item`, `action.toggle-light`, `action.unequip`, `action.use-item`, and `action.wait`. A pack may override any subset; `normalActionCost` supplies the normal fallback.

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
| `runAppearanceChance` | number | Yes | Inclusive probability from 0 through 1. |
| `rarity` | enum | Yes | `common`, `uncommon`, `rare`, or `legendary`. |

```yaml
schemaVersion: 2
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
    runAppearanceChance: 1
    rarity: common
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
| `actionCost` | non-negative safe integer | Yes | Use/equip action cost. |
| `equipment` | object or null | Yes | Slots, handedness, and reserved slots. |
| `combat` | object or null | Yes | Accuracy, defense, armor, optional damage dice, non-negative range, and optional ammunition tag. A non-null ammunition tag must match a tag on an ammunition item. |
| `light` | object or null | Yes | RGB color, radius 1–32, strength 1–255, positive fuel capacity/use, descending unique warning thresholds no greater than capacity, and accepted fuel tags. |
| `identification` | object | Yes | Mode `known`, `shuffled`, or `instance`, optional group ID, and appearance IDs under the rules below. |
| `effects` | effect array | Yes | Ordered primitive effects, possibly empty. |

Equipment `slots` use `main-hand`, `off-hand`, `body`, `head`, `hands`, `feet`, `neck`, `left-ring`, or `right-ring`. Handedness is `one-handed`, `two-handed`, or `none`. Two-handed items use `main-hand` and reserve `off-hand`; a slot cannot also be reserved.

Category compatibility is strict: weapons require equipment plus damage; armor and shields require equipment plus non-damaging combat values; light items require a `light` object; and ammunition cannot be equipped or emit light. `fuelTags` are matched against tags on fuel item definitions. An empty `fuelTags` list describes a non-refillable light.

Identification modes have distinct contracts:

- `known` uses `groupId: null` and no appearances.
- `shuffled` requires a group ID. Every member has the same item category and the same ordered appearance pool. The number of unique appearances must exactly equal the number of items in the group, giving every item one different appearance in a run.
- `instance` uses `groupId: null` and at least one appearance. Its properties are learned for that individual item rather than every item sharing an appearance.

```yaml
schemaVersion: 2
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
    identification: { mode: known, groupId: null, appearances: [] }
    effects: []
```

## Spell entries

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `targetingId` | registered ID | Yes | One closed targeting rule below. |
| `range` | non-negative safe integer | Yes | Chebyshev targeting distance. |
| `actionCost` | positive safe integer | Yes | Scheduler energy cost. |
| `effects` | non-empty effect array | Yes | Applied in listed order. |

```yaml
schemaVersion: 2
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
schemaVersion: 2
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

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `rolls` | positive safe integer | Yes | Independent selections. |
| `choices` | non-empty array | Yes | Weighted choices. |
| `choices[].contentId` | item content ID or null | Yes | Direct result; it must resolve to an `item`, and exactly one reference field is non-null. |
| `choices[].lootTableId` | loot-table ID or null | Yes | Nested result; cycles are rejected. |
| `choices[].weight` | positive safe integer | Yes | Relative selection weight. |
| `minimumQuantity`, `maximumQuantity` | positive safe integers | Yes | Inclusive quantity range; maximum cannot be smaller. |

```yaml
schemaVersion: 2
entries:
  - kind: loot-table
    id: loot-table.basic-supplies
    name: Basic supplies
    tags: [supply]
    rolls: 1
    choices:
      - { contentId: item.brass-lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }
```

## Vault entries

| Field | Type | Required/default | Rules and meaning |
|---|---|---|---|
| `minDepth`, `maxDepth` | positive safe integers | Required | Inclusive placement range. |
| `rarity` | enum | Required | `common`, `uncommon`, `rare`, or `legendary`. |
| `weight`, `maxPerFloor` | positive safe integers | Required | Selection weight and placement cap. |
| `margin` | non-negative safe integer | Required | Required surrounding space. |
| `transforms.rotations` | sorted unique array | Required | One or more of 0, 90, 180, and 270. |
| `transforms.reflectHorizontal` | boolean | Defaults to false | Allow horizontal reflection. |
| `layout` | string array | Required | 1–100 rows, each at most 160 Unicode code points. |
| `legend` | symbol map | Required | Each symbol defines terrain and at most one entrance, light, or slot action. |

Terrain is `wall`, `floor`, `closed-door`, `pillar`, `stair-up`, `stair-down`, or `void`. A placement slot kind is `monster`, `item`, `trap`, `npc`, `fixture`, or `objective`. Slot IDs are vault-local slugs. Required slots must occur in the layout. Lights require a local suffix, one glyph, stable presentation token, RGB color, radius 1–32, strength 1–255, and optional enabled state (default true). Void terrain cannot contain lights or placement slots.

```yaml
schemaVersion: 2
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
schemaVersion: 2
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

## Closed behavior registry

- `behavior.approach-and-attack`: parameters `{}`. Approaches a hostile target and attacks when able.

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

Each content-kind section above contains a complete copyable `schemaVersion: 2` document. The bundled `content/` directory is also an executable reference and is validated in every repository test run. Copy the complete directory before customizing it; do not mount a partial overlay.
