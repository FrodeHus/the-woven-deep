# Cursed Items — Design

**Issue:** #121. **Date:** 2026-07-31. **Status:** approved.

## Goal

Deepen the identification gamble: some equipment is cursed — a passive drawback, a triggered sting, or both — welded on when equipped unidentified, with the identify service as counter-play and remove-curse (merchant service + rare scroll) as relief. Curses are fun-first: they create decisions and stories, never gate progress ([[design-principle-no-hard-gates]] binds — curses must never touch doors, keys, stairs, or any win-path mechanic).

## Non-goals

- No cursed consumables (potions/scrolls keep their existing shuffled-pool gamble untouched).
- No cursed artifacts (artifacts have authored drawbacks already; `artifact !== null` items are never rolled).
- No curse crafting/transfer, no blessed items, no curse stacking (one curse per item).
- No new trigger beyond the closed set of three.

## Content (schema v11 → v12)

New content kind `curse` — a closed registry, authored in YAML under `content/curses/`:

```yaml
kind: curse
id: curse.hungering-edge
name: Hungering Edge
revealText: "The blade drinks deep — and will not let go."
drawbackModifiers: { maxHealth: -3 }          # optional; keys compile-validated against DERIVED_STAT_NAMES
trigger:                                       # optional; at least one of drawbackModifiers/trigger required
  on: on-kill                                  # closed vocabulary: on-kill | on-hurt-below-half | on-floor-enter
  effectId: effect.weave.drain                 # must be an existing EFFECT_IDS member
  chanceBps: 5000                              # optional, default 10000 (always)
```

Compile validation:
- `on` is exactly one of the three literals — the vocabulary is closed at the schema level; extending it is a schema bump.
- `effectId` must exist in `EFFECT_IDS`; unknown ids fail compilation.
- `drawbackModifiers` keys validated against `DERIVED_STAT_NAMES`, values negative safe integers. **The same validation is added to the artifact block's `drawbackModifiers`** (closing the existing gap).
- Each curse must declare `drawbackModifiers`, `trigger`, or both.

Eligible categories: `weapon`, `armor`, `shield`, `ring`, `light`. Base equipment items in those categories move to `identification.mode: instance` (with appearance pools where sensible) so the unidentified gamble actually exists. Items with an `artifact` block are excluded regardless of category.

Balance knobs in `content/balance/core-gameplay.yaml`:

```yaml
curses:
  chanceBps: { shallow: 1000, mid: 2000, deep: 3500 }   # per eligible generated item, by the same depth bands as encounterDensity
  enchantedMultiplierBps: 20000                          # enchanted items roll at 2x, capped at 5000 bps
  capBps: 5000
```

## Engine

### State (save v13 → v14)

`ItemInstance.curse?: { curseId: string; revealed: boolean }` — mirrored in `save-schema/item.ts` (the drift assertion forces the pair), in the fallen-champion item snapshot schema, and in heirloom metadata paths. Freeze `legacyActiveRunV13Schema`; add one ordered migration v13→v14 (field defaults to absent). No hidden-field leak: projection exposes curse name/drawbacks only when `revealed`; until then unidentified cursed items look exactly like unidentified clean ones (`unknownProperties` already covers "may have hidden properties").

### Generation

At loot/population item creation, each eligible instance rolls once from the existing loot-placement stream: banded `chanceBps`, doubled (capped `capBps`) when the item carries a positive enchantment — the devil's bargain is engineered. Curse identity is drawn uniformly from the compiled curse registry on the same stream. Zero eligible items ⇒ zero draws (stream discipline as with artifact offers).

### Modifiers

Curse `drawbackModifiers` apply in `equipmentModifiers` on the **enchantment-side path only** — never folded into `base`, which leaks through `publicModifiers` before identification. Equipped items only, like enchantments.

### Sticky + reveal

- Equipping a cursed item sets `revealed: true` and emits `curse.revealed` (new DomainEvent → PublicEvent carrying the authored `revealText`).
- While a revealed cursed item is equipped: `unequipItem` AND `equipmentPlan`'s displacement loop refuse with new failure reason `item.cursed` (added to the equipment failure union and `InvalidActionReason`); drop of equipped cursed items is likewise refused; merchants refuse to buy revealed cursed items (`merchantAcceptsItem`).
- Per-instance identification (identify service, or any existing identify path) sets `revealed: true` WITHOUT equipping — the counter-play. Backpack-revealed cursed items can be dropped/left freely; only equipping welds.
- A trigger firing also reveals (covers the edge where an item was equipped while a future path might allow unrevealed equipping).

### Triggers

A pure post-pass in `resolveCommand`'s reducer scans the command's emitted `DomainEvent`s once, after normal resolution:

| Trigger | Fires when |
| --- | --- |
| `on-kill` | an `actor.died` event whose killer is the hero |
| `on-hurt-below-half` | a `hero.damaged`/`actor.damaged`(hero) event where health crossed from ≥ half to < half maxHealth |
| `on-floor-enter` | the new `floor.entered` DomainEvent (emitted in all three floor-transition paths — generated, stored, Final Chamber — beside the existing per-floor recharge bookkeeping) |

For each equipped cursed item whose trigger matches: roll `chanceBps` (effects stream), then resolve `effectId` through the normal effect machinery (its own randomness stays in the effects stream). One evaluation per command; a single event can trigger multiple distinct equipped curses but each curse at most once per command. Concluded runs never trigger (post-pass runs only on accepted commands).

### Remove-curse

- `merchant-service.remove-curse` — third member of `MERCHANT_SERVICE_IDS` (both enum copies + the command schema literal becomes an enum of the three). `planService`/`resolveTradeCommand` branches: target must be a revealed cursed item owned by the hero; removal deletes `curse` entirely, keeps the item, its enchantment, and its identification state; equipped items become unequippable again. Priced above identify (authored `basePrice: 30` in town-merchants.yaml, faction tiers like identify). Trade projection gains **per-service** `targetItemIds` (fixing the current identify-only assumption).
- **Scroll of sundering** — new shuffled-pool scroll with new `effect.curse.remove`: removes the curse from one revealed cursed item (targeting mirrors existing item-targeted effects). Rare (deep-weighted loot tables).

### Heirlooms & champions

A cursed item selected as heirloom travels **cursed and revealed** — the Hall knows its history; the recovering hero sees the curse before touching it. Champion inventory snapshots preserve the curse field; materialization compatibility checks accept it.

## Client (apps/web)

- `curse.revealed` log line (authored `revealText`, distinct tone) + item sheet shows curse name and drawbacks once revealed; a subtle "cursed" marker on equipment slots.
- `item.cursed` rejection surfaces the existing invalid-action log path ("It will not come free.").
- Remove-curse appears in the trade Services tab via the per-service target list — no bespoke UI.

## Error handling

- Compile: unknown trigger literal, unknown effectId, positive/unknown drawback keys, curse with neither block — all fail `content:validate`.
- Runtime: remove-curse on a non-cursed/unrevealed target → command rejected with existing trade rejection shape; scroll on invalid target → no consumption, rejection message.
- Save: decoding a v14 blob with unknown curseId (content drift) follows the existing content-bound validation policy for stale references.

## Testing

- Content: compile validation matrix; artifact drawback-key validation now enforced.
- Engine: generation determinism + banded rates + enchanted doubling (statistical over seeds, exact per-seed pins); sticky on both unequip paths; displacement refusal; merchant sell refusal; reveal via equip/identify/trigger; each trigger's crossing semantics (esp. below-half edge: exact-half, multiple hits in one command, healing back above and crossing again); stream isolation (curse rolls from loot-placement, trigger rolls from effects — demo hashes for unrelated commands unchanged); remove-curse service + scroll end-to-end; heirloom/champion round-trip; v13→v14 migration; byte-identical save/reload replay with cursed items equipped.
- Invariant: descent-lock-free stays green (curses cannot touch traversal by construction — no curse effect may target doors/terrain; enforce by restricting curse `effectId` to a compile-time allowlist that excludes terrain-mutating effects if any exist).
