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

## Amendments (2026-08-02, during implementation)

Each was an under-specification found while mapping the spec onto the code, or a review-settled correction.

1. **"Authoritative derived maxima" is implemented as a synchronization pass, not as a rewrite of every reader.** The pure save-schema invariant `health <= maxHealth` (`save-schema/run-record.ts:452-455`) is content-free and cannot consult `deriveRunActorStats`. If readers used derived values while the stored field stayed stale, a `+maxHealth` item would immediately produce an unsavable run. So `synchronizeDerivedMaxima` recomputes and stores the hero's `maxHealth`/`maxWeave` at the end of every command; every existing reader (`projection.ts:808`, `effects.ts:160`, `survival.ts:331`/`:362`, `rest.ts:50`/`:167`/`:265`, `curse-triggers.ts:77`) then reads an authoritative value with no change of its own.
2. **The sync applies to the HERO ACTOR ONLY.** `content-bound-validation.ts:138` pins a champion/echo actor's `maxHealth` to its normalized template health; syncing those actors would break that invariant on the next validation. Monsters carry no equipment and no hero modifiers, so they have nothing to sync.
3. **A dropping maximum clamps current health/weave down, floor 1 for health.** The spec specifies proportional rescaling on temper (a rising max) but is silent on unequipping a `+maxHealth` item. Clamping down is required — the save invariant demands it — and the floor-1 rule mirrors the temper rescale so a stat swap can never kill the hero.
4. **`spellPower` joins `DERIVED_STAT_NAMES`.** Balance `formulas` are validated and derived per derived-stat name, so expressing spellPower "within the existing linear-formula machinery" means adding it to the closed derived-stat vocabulary (a content change). Equipment and enchantments may therefore grant `+spellPower` for free, which is a feature; curse drawbacks may too, which is consistent with every other stat (only `maxHealth` is forbidden to curses).
5. **The `−10` baseline rides the formula's `base`, not a second knob.** The spec's `floor(max(0, wits − 10) / 4)` is authored as `spellPower: { base: -10, wits: 1 }` plus `spellPowerDivisor: 4`. The linear machinery produces `wits − 10`; the divisor and the zero-floor are applied once, outside it. No `spellPowerBaseline` knob is introduced.
6. **The enchantment table is a closed content KIND, plus a balance block.** `ItemEnchantmentState.enchantmentId` needs a registry-validated id exactly as `ItemCurseState.curseId` does, and #121 already established the pattern for that: a new closed kind. So content v14 adds `kind: 'enchantment'` (pools expressed as per-entry `categories` + `modifiers` + `weight`) and a `balance.enchanting` block for the per-rarity magnitude scaling. This is the spec's "enchantments block" expressed the way this codebase expresses tables.
7. **`temper` is a revision-only command, not a `GameAction`.** The spec says it costs no turn energy — "a reflection, not an action". So it is dispatched in the reducer's modal-command family (beside trade/dialogue/house), before the world branch: no world step, no turn, no energy, no randomness, revision +1.
8. **The chargen attribute base is derived, never stored.** `attributes = base + spent` is enforced as `attributes[a] - spent[a]` landing inside `[attributeMinimum, attributeMaximum]` for every attribute, plus `attributes[a] <= attributeMaximum`. Storing the base would create a second source of truth for a value the run already implies.
9. **spellPower is passed at the spell seams, never inferred inside `resolveEffectSequence`.** `EffectSequenceInput.spellPower?: number` defaults to 0, so item triggers, curse triggers, condition ticks, boss phases, features, and swarm effects get zero by omission — structurally satisfying "not item triggers, not curses" rather than relying on a runtime check. The seams that pass it are the shared item-spell helpers (`actions.ts`'s `validateItemSpellUse`, `action-dispatch.ts`'s `resolveItemSpell`) and the `cast` command's validation/commit pair (`actions.ts`'s `validatePlayerAction`, `action-dispatch.ts`'s `cast` resolver) — `abilityIds` casting (champion/echo) never resolves through a machinery of its own (see amendment 12): monster/champion parity is achieved because `spellPowerFor` derives identically from any actor's own stats, not because a fifth seam exists.
10. **Echo-casting ties break by `compareCodeUnits(spellId)`.** "Highest weave cost" alone is not a total order, and standings must be deterministic.
11. **Re-enchant price is the service's authored `basePrice` doubled**, computed at plan time, with the same faction-tier treatment identify already receives. The spec says "double price" without saying which price; the base is the only one the trade machinery has.

Additional review-driven amendments, folded in during Task 14:

12. **Spec factual error, haunts-amendment-1 precedent: "Champions/Echoes cast them through the existing ability machinery" assumed casting machinery that does not exist.** `behavior.ts` never reads `abilityIds`; casting is hero-only in this codebase, and no monster-side cast resolver was built or was in scope for this plan. What shipped is truthful RECORDING: `signatureAbilityIds` (highest weave cost first, `compareCodeUnits(spellId)` tie-break, sliced to the template's `abilityLimit`, then re-sorted into strictly-increasing id order because the save schema's `validateOrderedIds` requires it of both `standing.signatureAbilityIds` and a placed haunt's `abilityIds`) is captured, validated, and projected — but no champion or echo actually casts a spell at runtime yet. Runtime champion/echo casting is a tracked follow-up, not a silent scope cut: the data is already correct and waiting for a consumer. **Delivered:** the consumer is `championCastAction` (`champion-casting.ts`), a weave-budgeted ranged cast for `target.actor`/`target.self` spells resolving through the existing caster-agnostic `cast` resolver — designed in `2026-08-04-champion-casting-design.md`. The aimed and area targeting kinds remain out of scope.
13. **The echo's ability-subset prefix slice keeps the alphabetically-first spell, not the highest-signature one, among the champion's already-capped list.** `championAbilityIds` (from `signatureAbilityIds`, which is stored in ascending code-unit order per amendment 12) is sliced to `template.abilityLimit`; an echo then takes `championAbilityIds.slice(0, echoAbilityLimit)` — a prefix of an alphabetically-sorted list, not a re-sort by cost. So the echo's ability subset is not guaranteed to be the champion's most expensive remaining spells, just its alphabetically-earliest ones. Deferred to the same runtime-casting follow-up as amendment 12, since the subset is presentational data with no caster to exercise it yet. **Fixed ahead of that follow-up (PR #218):** both narrowing sites — the champion re-cap under a lowered `abilityLimit` and the echo subset — now re-rank by weave cost with the `compareCodeUnits` tie-break before slicing, then re-sort by id to preserve the strictly-increasing invariant.
14. **Tempering back-fill is ratified as a lump sum, derived by subtraction, never a stored crossing set.** `grantTemperingMilestones` computes `owed = reachedDepths.length − (banked + Σspent)` against `metrics.deepestDepth` — there is no per-depth "already crossed" ledger. A save migrated mid-run (or a Wanderer rewind that lowers `deepestDepth`) therefore back-fills every already-crossed-but-unbanked milestone as one lump sum the next time a floor-entry transition runs the grant, and is rewind-safe by construction: the same subtraction against a lower `deepestDepth` correctly re-earns exactly what was re-crossed, no more.
15. **spellPower lands at exactly four seams, with AoE and multi-effect scaling rules that are easy to get backwards.** The four call sites are the cast command's commit (`action-dispatch.ts`'s `cast` resolver) and its validation twin (`actions.ts`'s `validatePlayerAction`), and the shared item-spell helper's commit (`action-dispatch.ts`'s `resolveItemSpell`) and its validation twin (`actions.ts`'s `validateItemSpellUse`) — each pair derives `spellPower` once, from the same pre-deduction state, so the dry run and the commit can never scale differently. `resolveEffectSweep` (AoE) applies the FULL bonus to each target independently (it spreads the same `spellPower` into `resolveEffectSequence` once per target, never divided across the sweep). A multi-effect spell's every `effect.damage`/`effect.heal` gets the full bonus too (per-effect scaling, not a total pool). The scaled roll (`rolled.value + spellPower`) is what lands in `AttackHitEvent.rolledDamage`, mirroring the weapon flat-bonus precedent in `combat.ts` — mitigation still applies afterward, to the scaled number. DoT ticks, condition ticks, and curse triggers never receive `spellPower` (they never populate `EffectSequenceInput.spellPower`, so it defaults to 0) — deliberately unscaled, per amendment 9.
16. **spellPower's divisor design is a content-balance fact worth stating plainly for enchantment authors.** `spellPowerFor` returns `floor(max(0, wits − 10) / spellPowerDivisor)`. At the shipped `spellPowerDivisor: 4`, a lone `spellPower: +1` modifier (e.g. from a single enchantment) is a no-op for a wits-10 caster: raw is `wits − 10 = 0`, and `0 + 1 = 1`, `floor(1 / 4) = 0` either way — only crossing a divisor-4 boundary in the RAW value (i.e. `wits − 10`, not the modifier alone) actually buys a point of damage. An enchantment author stacking `+spellPower` modifiers should expect them to be inert individually and only pay off in multiples of the divisor; this is authored behavior, not a bug, and is recorded here so nobody "fixes" a single-point spellPower enchantment into doing something it was never going to do at the shipped divisor.

## Server-admin doc check (Task 14)

`docs/server-admin/content-configuration.md` already documents everything this plan's Step 3 asked to confirm: the `enchantment` content kind (schema table + full field reference + example), the balance `tempering`/`spellPowerDivisor`/`enchanting` knobs, the required `formulas.spellPower` entry, `merchant-service.enchant` (registry, faction service IDs, town Armorer authoring), `effect.item.enchant`, and the content-schema v13→v14 migration note (`"Content schema version 14 adds the enchantment content kind, the balance tempering, spellPowerDivisor, and enchanting knobs, ..."`). No edit was needed.

Checked separately: whether the docs carry a save-schema v16→v17 migration note. They do not, and this is consistent with the doc's own established scope — `content-configuration.md` documents exactly one save-schema bump anywhere in its text (the v5 "Runs persist with save schema version 5..." note, left over from an early milestone when content and save versions moved together) and has not gained a companion note for any of the many save-schema bumps since (v6 through v17). Per `CLAUDE.md`'s own guidance ("these version numbers go stale — when in doubt, trust `SAVE_SCHEMA_VERSION` in the source"), save-schema history is not a doc this project maintains going forward; no new note was added, to avoid resurrecting a pattern the project already abandoned.
