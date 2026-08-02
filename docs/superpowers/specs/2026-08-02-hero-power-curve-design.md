# Hero Power Curve — Design

**Source:** 2026-07-31 consistency-review triage ("hero power curve next big design"). **Date:** 2026-08-02. **Status:** approved.

## Goal

Close the gap between the Deep's difficulty curve (~13× monster HP, ~5× damage from depth 1 to 19) and the hero's innate power, which today is a flat line — all growth rides on gear. Three reinforcing, grind-proof axes:

1. **Tempering** — depth milestones grant attribute points: innate growth that only diving earns.
2. **Enchanting** — a merchant service and rare scroll finally produce enchantments in-run: the deep-game gold sink.
3. **Spell scaling + echo casting** — wits scales spell damage/heals, and fallen casters finally echo forward casting what they knew.

The no-hard-gates principle binds throughout: every axis is optional power, never a progress gate. Victory remains skill + loot; these are the loot's force multipliers.

## Non-goals

- No XP, no levels, no kill-grinding of any kind (the score's turn-decay line stays the anti-grind spine).
- No attribute growth beyond `attributeMaximum` (30) — the chargen cap is the lifetime cap.
- No spell ranks (duplicate tomes stay rejected); scaling is stat-derived only.
- No enchanting of artifacts, no re-rolling curses, no enchantment removal.
- No score-model changes.

## Component 1 — Tempering

**Milestones.** Balance gains `tempering: { depths: [3, 6, 9, 12, 15, 18] }`. The FIRST time `metrics.deepestDepth` reaches each authored depth, the hero banks one tempering point. Milestones are facts derived from metrics — zero randomness, no per-monster data. Reaching several milestones at once (theoretical) banks several points.

**Spending.** A new engine command `temper` (`{ attribute: AttributeName }`): requires a banked point; grants +1 to the chosen attribute, capped at `attributeMaximum` (a capped attribute is invalid to choose while alternatives exist; if ALL attributes are capped, points bank harmlessly forever). Costs no turn energy (a reflection, not an action) and consumes no randomness. Emits `hero.tempered` (public — the player's own act).

**The recompute.** Attribute mutation finally exists, so the stored `maxHealth`/`maxWeave` must follow the formulas: on temper, recompute both from the new attributes + modifiers; current health/weave scale proportionally in checked-integer math (quotient/remainder — e.g. health' = max(1, floor(health × newMax / oldMax))). This work also **fixes the inert-maxHealth-modifier bug**: `deriveRunActorStats`'s maxHealth/maxWeave outputs become authoritative wherever the stored fields are read today (HUD, heal caps, rest, below-half curse math), with equipment/artifact maxHealth modifiers becoming genuinely live. (Curse drawbacks remain forbidden from maxHealth — the #121 compile rule stands.)

**State (save bump).** `hero.tempering: { banked: number; spent: Readonly<Record<AttributeName, number>> }` — spent history kept so the UI can show the story and validation can pin `attributes = chargen base + spent` (chargen base becomes derivable; validation asserts consistency). Migration defaults zeroes.

**Client.** When a point banks, a log line ("The Deep tempers those who dare it.") and a non-blocking prompt affordance; the temper choice UI is a small console-styled overlay (chargen attribute-row styling), rebindable key + palette entry. Wanderer: checkpoint rewinds restore pre-checkpoint tempering wholesale (state rides the blob — free); re-reaching the milestone after a rewind does NOT re-grant (deepestDepth in metrics survives… it rewinds with the blob too, so it re-grants exactly when deepestDepth re-crosses — coherent and deliberate: the rewound hero re-earns it).

## Component 2 — Enchanting

**Service.** `merchant-service.enchant` — fourth member of the service enum (both copies + command enum), basePrice 80, faction tiers like identify. Target: any ordinary equipment item (weapon/armor/shield/ring/light) owned by the hero that is NOT an artifact and NOT cursed-revealed; per-service `targetItemIds` lists eligible items.

- **First enchant:** draws one positive modifier from an authored enchantment table (content: `enchantments` block — modifier pools per item category with magnitudes scaled by item rarity), on a NEW named RNG stream `enchanting` (derived from the run seed like all streams; consumed only by enchant draws — service and scroll).
- **Re-enchant:** replaces the existing enchantment with a fresh draw (gamble — may be worse), at double price. Authored rule, stated in the service copy.
- The resulting `ItemEnchantmentState` uses the existing shape; `unknownProperties`/identify interplay unchanged (a service-enchanted item is identified by construction).

**Scroll of tempering steel.** Rare deep scroll (`effect.item.enchant`, new effect id): enchants the first eligible item by `compareCodeUnits` order among equipped-then-backpack (mirroring the sundering scroll's targeting convention), same stream.

**Curse interplay.** The 2× curse weighting for enchanted items is a GENERATION-time rule and stays generation-only: service/scroll enchanting never triggers a curse roll. Stated in the spec so nobody "fixes" it into a retroactive gamble.

## Component 3 — Spell scaling + echo casting

**spellPower.** Balance `formulas` gains `spellPower: { base: 0, wits: 1 }` interpreted through a divisor knob `spellPowerDivisor: 4` — effective bonus = floor(max(0, wits − 10) / 4) — expressed within the existing linear-formula machinery plus the divisor (checked integers). Damage and heal effects resolved FROM A SPELL (cast command and scroll-cast path; not item triggers, not curses) add the caster's spellPower to their rolled amount. Monster/champion casters use the same derivation from their own stats.

**Echo casting.** `buildSnapshot` stops hardcoding `signatureAbilityIds: []`: it records the hero's `knownSpellIds` (capped to the champion template's `abilityLimit`, chosen by highest weave cost — the signature spells), so standings carry them and Champions/Echoes cast them through the existing ability machinery. Save-shape note: the field exists and is already migrated everywhere — this is a producer fix, not a schema change; old records simply have empty lists (haunts of pre-curve heroes cast nothing, correct).

## Versions

- **Save bump** (current +1): `hero.tempering` (frozen previous schema; migration defaults zeroes; the hero sub-schema changes shape — full frozen-schema discipline for every legacy entry version, per the established lesson).
- **Content bump** (current +1): `tempering` + `spellPower`/`spellPowerDivisor` balance knobs, `enchantments` table block, `merchant-service.enchant`, `effect.item.enchant`, the tempering-steel scroll, service authoring in town-merchants + faction serviceIds. Migration notes in the content-configuration doc.
- New RNG stream `enchanting` appended to the stream registry (stream-list change — verify the legacy RNG-entry freeze discipline in migrations, the v12-era frozen stream list precedent).

## Error handling

- Temper with no banked point / capped attribute → standard invalid-action rejections (new reasons `temper.unavailable`, `temper.capped`).
- Enchant on artifact/cursed/ineligible → service rejection per the trade machinery; scroll with no eligible target → no consumption + rejection (sundering precedent).
- All-capped attributes: points bank forever, UI shows them as "held by the Deep".

## Testing

- Milestone grant exactly-once per depth crossing incl. the Wanderer rewind re-grant semantics (deliberate, pinned); multi-milestone banking.
- Temper: validation (no point, capped, all-capped), recompute proportionality across health states (full, wounded, 1 HP floor), zero randomness, attributes = base + spent invariant.
- Inert-modifier fix: an equipment +maxHealth modifier now moves the bar/caps/below-half math (regression matrix across the readers).
- Enchanting: stream isolation (only enchant draws consume `enchanting`; demo digests for enchant-free runs unmoved beyond contentHash/schema), rarity-scaled pools, re-enchant replacement, artifact/cursed refusal, scroll targeting order.
- spellPower: formula through real cast + scroll resolution, monster-caster parity, zero effect on non-spell damage.
- Echo casting: snapshot capping by highest weave cost, standings round-trip, champion actually casting in an encounter test.
- Score untouched (pin); no-hard-gates untouched (descent invariant green).
- Save + content migrations with genuine legacy fixtures; attributed demo re-pins.
