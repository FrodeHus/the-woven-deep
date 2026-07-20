# Locks & Lockpicking (G7)

Vault-only locked doors and locked chests, opened by a lockpick skill check against the
`disarm` derived stat. This milestone also builds the missing **production feature
spawner** it depends on, which incidentally makes the existing (demo-only) trap and door
features reachable in real gameplay.

## Why this is bigger than "add a lock"

Production floors have **no feature/container system today**. `ActiveRun.features` starts
empty and is only ever populated by the hand-authored demo scaffold
(`gameplay-fixture.ts`); real floor generation never creates a `DoorFeature`, `TrapFeature`,
or anything else. Doors in shipped play are **terrain** (`closed-door` in `terrain.ts`),
not features. `population-placement.ts` only *reads* `run.features`. There is also no
client affordance for feature interaction beyond "walk into a closed-door tile → auto
open-door command".

So locks-with-per-instance-difficulty require: a production spawner that turns authored
vault slots into feature instances, a lock check, a lockpick item, and a greenfield
client "pick lock" action. Each is scoped narrowly to what the feature needs.

## Locked decisions (from the user)

- **Vault-only.** Locked doors and locked chests are authored in vault legends, never on a
  required path. A locked door always has a guaranteed alternative (a findable key or an
  around route); a locked chest is optional loot.
- **Lockpick check mirrors trap disarm.** `rollDie(run.rng.effects, 20) + disarm` vs a
  per-instance `difficulty`. `disarm` is the existing agility+wits derived stat; derive it
  with `deriveActorStats` (not `deriveRunActorStats` — hunger must not shift lock difficulty,
  same as disarm).
- **Ordinary failure consumes one lockpick** (`consumeItemQuantity`), retry allowed while
  picks remain.
- **Critical failure (natural 1) permanently jams a locked CHEST** — its loot is lost
  forever (persist a `jammed` state). Locked **doors** keep the plain retry model — a door
  never becomes permanently impassable because a key is always a guaranteed alternative.
- **Lockpicks are a stackable consumable**, sourced from **both** loot drops and merchant
  stock.
- **Optional keys** open a door without a check.

## Model

### Feature model (`packages/engine/src/feature-model.ts`)

Extend the `DungeonFeature` union. `DoorFeature` already has a `'locked'` state; add the
lock payload, and add a new `ChestFeature`.

```
DoorFeature   { type:'door';  state:'open'|'closed'|'locked'; lock?: LockData }
ChestFeature  { type:'chest'; state:'locked'|'closed'|'looted'|'jammed';
                lock?: LockData; lootTableId: string | null; lootContentId: string | null }

LockData      { difficulty: number; keyContentId: string | null }
```

`LockData` is present when (and only when) the feature is/was locked; `keyContentId` is
door-only (chests take no keys). A door with `state:'locked'` carries `lock`; unlocking
flips it to `'closed'` and clears nothing (the `lock` record can remain for save-round-trip
symmetry — decide in the plan, but the drift guard forces schema/type agreement either way).

### Content & vault authoring (`packages/content`)

Add per-instance lock data to the vault authoring surface. Introduce a `door` and `chest`
placement kind (or extend the existing legend), each carrying:

- `difficulty: number` (the DC the `d20 + disarm` roll must meet or beat)
- doors: `locked: true`, optional `keyContentId`
- chests: `lootTableId` **or** `lootContentId` (what's inside), mirroring the item-slot
  loot duality already in `fillItemSlots`

`VAULT_PLACEMENT_KINDS` and the vault legend schema
(`packages/content/src/compiler/schema/vault.ts`) gain the new kind(s) and the
`difficulty`/`keyContentId`/loot fields, validated loud (difficulty in a sane range;
`keyContentId`/`lootTableId` must resolve). Follow the single-sourced `as const` vocabulary
rule. A key item and the lockpick item are ordinary content items.

Author the demo content: at least one locked chest and one locked door in a vault (and/or
the gameplay fixture) so the mechanic is exercised by a demo — this is the intentional
content change that legitimately regenerates the affected demo hashes.

### Lockpick item (`content/items/lockpick.yaml`)

Stackable consumable, modeled on `content/items/lamp-oil.yaml` (`stackLimit`, `price`,
`category`, `tags`). Category: `misc` (no dedicated tool category today; a new category is
optional and out of scope unless the merchant buy-back needs it). Tags let it also serve as
a `disarm-tool` if we later want it to double for traps — out of scope for G7, but the tag
is cheap to add.

### Save-schema (`packages/engine/src/save-schema/item.ts`)

Add the `chest` variant and the door `lock` payload to the `feature` discriminated union;
the `_FeatureDrift` `Expect<SchemaMatches<…>>` guard compiles-checks that the schema and
`DungeonFeature` agree. Add any structural cross-validation to `save-schema/run-record.ts`
(the chest's floor must exist; a `looted`/`jammed` chest holds no live loot).

## Behaviour

### Production feature spawner (the prerequisite)

Extend the vault-slot resolution path (sibling to `fillItemSlots` in
`packages/engine/src/population-placement.ts`) to convert authored **door** and **chest**
slots into `DoorFeature`/`ChestFeature` instances appended to `run.features`, at the slot's
world cell, with the authored `difficulty`/`keyContentId`/loot. Thread the same RNG stream
`fillItemSlots` uses (`encounters`) if any roll is needed; pure placement needs none. Only
authored locked features spawn — ordinary `closed-door` terrain is untouched, so existing
floors and their hashes are unaffected until demo content adds a locked feature.

### Lock check (`packages/engine/src/features.ts`)

New `pickLock` (one function handling both door and chest, or two thin wrappers over a
shared roll), mirroring `disarmTrap` (`features.ts:349`):

1. Validate (in `actions.ts`, before dispatch): actor adjacent to the feature, feature is
   `locked`, actor holds ≥1 lockpick (or, for a door, holds the `keyContentId`).
2. If the actor holds the door's key → unlock with no roll, no pick consumed (`door.unlocked`).
3. Else roll `rollDie(run.rng.effects, 20)`; `total = roll + deriveActorStats(actor).disarm`.
   - `total ≥ difficulty` → success: door `locked→closed` (`lock.picked`); chest
     `locked→looted`, materialise its loot as floor items at the chest cell via
     `createFloorLootFromTable`/`createFloorItem` on the loot RNG stream (`lock.picked` +
     the existing `loot.dropped` events).
   - `roll === 1` (critical) → chest `locked→jammed`, loot lost forever
     (`chest.jammed`); door → ordinary failure (no permanent state).
   - ordinary failure → consume one lockpick (`consumeItemQuantity`, `item.consumed`),
     emit `lock.pick-failed`; retry allowed while picks remain.

Thread RNG back with `withRngStream(run, 'effects', rolled.state)`. Throw on
already-validated invariants (engine convention), matching `disarmTrap`.

New `DomainEvent`s: `lock.picked`, `lock.pick-failed`, `door.unlocked` (key), `chest.jammed`
(+ reuse `item.consumed`, `loot.dropped`). Add them to the event vocabulary and any
projection/presentation that lists events.

### Client pick-lock action (`apps/web`)

Greenfield feature interaction. Add:

- a `pick-lock` `PlayerIntent` (`session/intents.ts`) and its `GameCommand` mapping
  (`session/command-builder.ts`), following the `open-door`/`refuel` shape;
- a projection helper (`session/projection-view.ts`) exposing an adjacent locked
  door/chest, so the UI can offer the action, plus a key binding
  (`ui/KeyRouter.ts`/`usePlayKeyDispatcher.ts`);
- engine side: a `PickLockAction` in `actions.ts` with a validation branch (mirroring the
  `disarm` branch) and a dispatcher entry in `action-dispatch.ts`.

A locked door should NOT auto-convert a move into a pick attempt (unlike open-door) — a
failed pick costs a pick, so it must be a deliberate action, not a bump.

## Determinism

The lock check draws from `run.rng.effects` (like disarm); loot materialisation from
`run.rng.loot`; spawner placement from `run.rng.encounters` if it rolls at all. No new RNG
stream. Adding locked demo content changes the reviewed demo hashes for the affected demos
(`gameplay`, and `dungeon`/`population` if a locked feature is authored into a generated
vault) — regenerate those fixtures as an intentional content change and eyeball the diff;
never regenerate to paper over an unintended behaviour change.

## Testing

- Engine: `pickLock` success/ordinary-fail/crit-fail-jam for chests; door
  unlock-by-key and unlock-by-pick; pick consumed on ordinary failure only; jammed chest
  yields no loot and cannot be reopened; replay/save round-trip of every new feature state.
- Content: vault legend with locked door/chest compiles; bad difficulty / unresolved
  key/loot id fails loud.
- Web: pick-lock intent → command; the action appears only when adjacent to a locked
  feature; a bump into a locked door does not spend a pick.
- Determinism: demo-hash replays green after the intentional regen.

## Out of scope (future)

- Making trap features / ordinary doors spawn in production beyond what the lock spawner
  needs (the spawner is built general enough to extend later).
- A dedicated tool item category / lockpick-as-trap-disarm-tool.
- Lock-related feats (a "master key" or "nimble fingers" perk) — the check already reads
  `disarm`, which aggregates hero effect sources, so a future perk plugs in via that stat.
