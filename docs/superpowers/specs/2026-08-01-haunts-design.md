# Haunts — Design (bones part a: your own fallen heroes)

**Issue:** #116 (part a). **Date:** 2026-08-01. **Status:** approved.

## Goal

Make the tagline literal: the Deep remembers, and your deaths persist as haunts you will meet again. Echoes and Champions — the fallen-hero encounters that already spawn from Hall standings at their death depth — *become* haunts: they speak their record line when encountered, guard the full equipped gear their hero died with, and can be appeased with an offering instead of fought. One system, no third role; Hall, conquest, and artifact mechanics keep working unchanged.

The cross-player bones pool ("meet another registered player's haunt") is deliberately **out of scope** — it gets its own spec once this ships. Every shape this design adds (standings as the frozen run input, deathInventory on records) is what that pool will sample; nothing here forecloses it.

## Non-goals

- No cross-profile record sharing (part b).
- No new haunt role — Echoes/Champions are the haunts.
- No backpack in the death snapshot (equipped items only).
- No appeasement-based conquest: appeasing never retires a champion, grants no achievement, releases no artifact.
- No engine-side prose: spoken lines are host-rendered from record data, like the artifact provenance line.

## Records substrate (save v15 → v16, guest Hall store v3 → v4)

`HallRecord` and `FallenHeroStandingSnapshot` gain:

- `cause: RunConclusionCause | null` — already on the record (killerContentId, depth, turn, worldTime); now copied into the standing by `standingsFromRecords` so the run can speak it. Nullable for legacy records.
- `deathInventory: readonly RecordedHeirloomSnapshot[]` — an instance snapshot (contentId, enchantment, condition, charges, fuel, curse, qualityRank, displayName, glyph, color, originatingHallRecordId) of **every equipped item at death**, captured in `finalizeRun` beside the existing heirloom selection. The heirloom remains one distinguished member (`sourceItemId` matching); artifacts appear here exactly as they do in heirloom snapshots.

Migrations: save v16 rewrites every stored standing — legacy standings get `cause: null` and `deathInventory: [heirloom]` (the one item we do have). The v13→v14 heirloom-curse migration is the structural template; the frozen-schema discipline from that bump applies (freeze `legacyActiveRunV15Schema`; the shared standing sub-schema changes shape, so a frozen pre-haunt standing schema must be wired into every legacy entry version, exactly the Task-3 lesson from #121). Guest Hall store v4 defaults the same two fields on stored records. Server `record_json` is an opaque envelope — no DB migration.

Save-size note: at most 10 standings × a handful of equipped items each; acceptable, and `validateStandings` keeps the cap.

## The spoken record line

`champion.encountered` / `echo.encountered` already exist as PublicEvents and currently render nothing. The web event log gains a renderer: on first encounter the haunt speaks, in the `curse`-adjacent haunt tone:

- Champion with cause: `"Kaelen, the Deep's Champion — fell to a bone-gnawer at depth 7. The Deep remembers."`
- Echo with cause: `"Echo of Mira — fell to the dark at depth 4. The Deep remembers."`
- Cause-less legacy record: `"Echo of Mira. The Deep remembers."`

Built host-side from the standing (heroName, role, cause, deathDepth) with killer names resolved from the content pack, following `provenanceLine`'s pattern. The farewell line on appeasement: `"<name> is at peace. The Deep releases what it held."`

## Gear guarding

The death-reward machinery generalizes from one item to the set:

- **Champion-haunt defeated:** drops its entire `deathInventory` via a per-item `createRecordedHeirloom` loop (existing fallback degradation per item: a piece the current pack no longer defines becomes the fallback relic). The existing `rewardCreated` latch covers the whole set.
- **Echo-haunt defeated:** drops **one** piece of its deathInventory — chosen by a single loot-stream draw at reward time — plus the existing `loot-table.echo-spoils` roll. `validateEchoLootGraph`'s no-heirloom assertion relaxes to no-*full-set* (the single piece may be the heirloom).
- Placement, spawn depth (exact `deathDepth` match), retention rolls, encounter/defeat bookkeeping: all unchanged.

## Appeasement — the offering

A new engine command `offer` (command schema addition; envelope like other targeted commands):

- **Preconditions:** hero adjacent to a living, retained haunt population (champion or echo); the offered item is in the backpack; the run not concluded.
- **The need:** derived deterministically from the record — content v13 adds an `appeasement` block to the champion template mapping class tags to favored item categories (e.g. `arcanist: [scroll, potion]`, `warden: [light, fuel]`), plus one universal rule: a record whose `cause` is null or light-related accepts any `light` category item. The haunt's need is computable by both engine (validation) and client (UI hint) from the standing + template — no hidden state.
- **Accept:** offered item removed from the backpack (consumed — it goes with the dead), relationship override hero↔haunt set `neutral` (the surrendered-actor hook in `reactions.ts`), the haunt emits `haunt.appeased` (new DomainEvent → PublicEvent carrying hallRecordId), its population despawns via the existing removal path, and its **entire deathInventory** materializes on its cell (same per-item loop as the champion drop). `FallenHeroRunDecision` gains `appeased: boolean` (save v16 rides the same bump) — set true, and `defeated` stays false.
- **No conquest:** no achievement, no champion retirement, no `newlyConqueredChampionRecordIds` entry, no artifact-ledger release — the haunt returns next run. Fighting remains the permanent, greedy option.
- **Reject** (wrong category): command invalid with reason `offer.refused`, item kept, disposition unchanged (no aggro escalation), client renders `"The haunt does not want this."`
- **Randomness:** the offer itself consumes none; the only draw in the whole feature is the echo single-piece pick at defeat-reward time (loot stream).

## Wanderer interaction

Free by construction: Wanderer runs produce no records, so they never become haunts; Wanderer players still meet haunts from Classic records; appeasing/defeating a haunt in a Wanderer run writes nothing (finalize gating already guarantees it), so the haunt stands again for the next run — consistent with Wanderer's no-lifetime-consequences contract.

## Error handling

- deathInventory piece unresolvable in the current pack → per-item fallback relic (existing degradation), never a crash.
- Offer with no adjacent haunt / item missing / concluded run → standard invalid-action rejections.
- Legacy records (no cause, single-item inventory) fully playable — shorter line, smaller drop.

## Testing

- Save v16 + guest Hall v4 migrations (legacy standings gain `cause: null` + `[heirloom]`), round-trip byte-identity, frozen-schema chain for all legacy entry versions with genuine pre-haunt fixtures.
- `finalizeRun` captures equipped-only instance snapshots (curse/enchantment/artifact preserved; backpack excluded; heirloom distinguished).
- Spoken lines: champion/echo, with and without cause, killer-name resolution, farewell line.
- Champion full-set drop (incl. per-item fallback degradation); echo single-piece + spoils; latches once-only.
- Offer command: need derivation per class-tag mapping + light rule, accept path (consume, neutral override, despawn, full drop, `appeased` set, no conquest side-effects), reject path (item kept, no aggro), adjacency/ownership/conclusion validation.
- Determinism: offer consumes zero randomness (stream equality pin); echo piece pick on the loot stream; demo re-pins attributed (schemaVersion + standings shape only for demos without haunt encounters).
- Wanderer: appease/defeat writes nothing (existing finalize-gate pins extended).
