# NPC dialogue — topic-based conversation with light consequences (Issue #79) — design spec

**Status:** design (brainstormed with the user 2026-07-26). Implements postponed issue **#79**, whose
prior design (`docs/design/npc-dialogue.md` on branch `feat/npc-dialogue`) is superseded by this spec
after a codebase-validation pass corrected six drift points. Branch `feat/npc-dialogue-build` off `main`
(fc803eb = Merge PR #90). Depends on **#78** (lore reveal + Codex Lore tab), merged.

Talk to an NPC — the travelling lampwright first — through an authored, topic-based branching
conversation with three light consequences: nudging faction reputation (one-time), revealing a Codex
lore entry, or opening trade. Today NPCs can only be traded with or fought; there is no talk path.

**Note on the lampwright:** validation confirmed she is a **rare, temporary dungeon encounter**
(`content/encounters/travelling-lampwright.yaml`: `runAppearanceChance: 0.25`, depths 1–10, a 3000–5000
world-time lifetime, `permanent: false`), NOT a town fixture. The user chose to keep her regardless
(honoring #79): dialogue is a bonus when encountered. Reachability rarity does not affect correctness —
the determinism tests exercise the mechanism directly; a permanent town merchant can be the second
dialogue NPC in a later pass.

## What exists (validated against `main`; six corrections folded in)

- **Reputation (`packages/engine/src/commerce.ts`).** `changeReputation({ run, faction, delta, reason,
  eventId })` (`commerce.ts:129-166`) returns `{ state, event }`; `reputationTier(value, faction)`
  (`commerce.ts:118-127`); `run.reputations: readonly FactionReputation[]` (`model.ts:157`), kept
  sorted/deduped (`sortedReputations`) and lazily materialized (`ensureFactionReputation`). Consumed
  today ONLY by commerce/merchants. ⚙️ **Correction 1:** the `reason` union is `'commerce' |
  'aggression' | 'death'` (`commerce.ts:134`, `events-model.ts:628`) — a `'dialogue'` reason must be
  ADDED in both. The lampwright faction exists: `npc-faction.lampwrights`
  (`content/npc-factions/lampwrights.yaml`), referenced by the NPC (`travelling-lampwright.yaml:9`).
- **Trade command precedent (`trade.ts`, `reducer.ts`).** `merchantSession()` (`trade.ts:103-153`)
  validates: population/actor linked, not dead/departed, lifecycle `available`, relationship not
  hostile, same floor + Chebyshev-adjacent, perceived, tier `acceptsTrade`. The intent→command→reducer
  pipeline: client `{ type: 'trade-open' }` intent (`intents.ts:50`) → `command-builder.ts:383-396`
  resolves adjacency (`adjacentMerchant`) → `TradeOpenCommand` (`commands-model.ts:109-112`) → the
  reducer short-circuits trade commands BEFORE the world-step path via `isTradeCommand` +
  `validateTradeCommand` (`reducer.ts:204-238`; `actions.ts` refuses them). This is the exact precedent
  the `talk`/`dialogue-consequence` engine path mirrors.
- **One-time flags + omit-when-empty save.** ⚙️ **Correction 2:** `MerchantPopulation`'s one-time flags
  (`merchant-model.ts:39-42`) are plain REQUIRED booleans (`save-schema/merchant.ts:23-26`), NOT
  omit-when-empty. The genuine omit-when-empty precedent is `Hero.knownSpellIds?`
  (`model.ts:90`, `save-schema/population.ts:44` `.readonly().optional()`, spread only when non-empty at
  `new-run.ts:282-283`). The new per-population guard follows THAT pattern so non-dialogue populations
  stay byte-identical.
- **Codex / lore reveal (#78).** ⚙️ **Correction 3:** there is NO existing call to reveal an arbitrary
  contentId. The Codex Lore tab derives from monster/item categories that are `discovered` (via
  `Sightings`) AND have authored `lore` (`codex-derive.ts:207-244`); `Sightings` is mutated ONLY by the
  perception-driven `accumulateSightings(prev, projection)` (`codex-storage.ts:279-302`). The first-
  reveal log line exists — `newLoreReveals`/`revealLine` ("The threads whisper of …",
  `codex-storage.ts:307-341`), emitted via `GuestSession.syncSightings` (`guest-session.ts:481-488`).
  So `reveal-lore` needs a SMALL NEW client function that directly inserts a contentId into the
  `Sightings` set (e.g. `monsterIds`/`itemIds`) and emits the reveal line — new plumbing, not reuse.
- **Client overlay/intent/keybinding wiring.** ⚙️ **Correction 4:** TradeScreen is NOT an
  `OverlayId`/registry member — it is a `projection.trade`-driven screen rendered directly by
  `PlayScreen` (`PlayScreen.tsx:357-361`) because trade IS authoritative engine state. Dialogue is
  mostly client, so its screen follows the **client-managed overlay pattern** (`overlays/registry.ts`
  `OverlayId` — inventory/character-sheet/spellbook/codex/settings/help), NOT trade's projection path.
  The `talk` action reuses the same wiring points the `trade` action uses: `ActionId`/`ACTION_IDS`/
  `ACTION_LABELS`/`DEFAULT_BINDINGS` (`session/settings.ts`), the KeyRouter action→intent switch
  (`KeyRouter.ts:97-98`), the command-palette `INTENT_ENTRIES` + gated `intentActions`
  (`CommandPalette.tsx:32-42,107-115`), and the modal gate in `usePlayKeyDispatcher.ts`.
- **NPC content model.** `NpcContentEntry` (`packages/content/src/model/npc.ts:9-25`) has no dialogue
  field; ⚙️ **Correction 5:** `dialogueId?` is genuinely new surface (add to the model + zod schema
  `compiler/schema/npc.ts:35-52`). Cross-ref validation mirrors `referencedKindIssue`
  (`compiler/validation/npc.ts:13-21`, used for `factionId`).

## Design

### 1. Content — a new `dialogue` content kind + NPC `dialogueId`

A new content kind keyed by id (its own reviewable/reusable unit, like loot-tables/vaults):

```
kind: dialogue
id: dialogue.travelling-lampwright
greeting: <the NPC's opening line>
topics:
  - { id, prompt, response, reveals?: [topicId...], consequence?: <union>, once?: bool }
```

`DialogueConsequence` is a closed, validated union:
- `{ kind: 'reputation', factionId, amount }` — engine, one-time.
- `{ kind: 'reveal-lore', contentId }` — client (reveals that entry's Codex lore).
- `{ kind: 'open-trade' }` — reuses `trade-open`.

`NpcContentEntry` gains `dialogueId?: ContentId`. Compiler validation (mirroring `referencedKindIssue`):
`dialogueId` resolves to a `dialogue`; each topic's `reveals` target ids exist in the SAME dialogue;
`reputation.factionId` resolves to an `npc-faction`; `reveal-lore.contentId` resolves to a lore-bearing
entry (a `monster` or `item` with non-null `lore`); topic ids are unique within a dialogue. The
lampwright links `dialogueId: dialogue.travelling-lampwright` and authors her conversation: a greeting +
topics for the lamps (flavor), the Heart (guarded lore-light hint), the fallen (`reveal-lore` of a
fallen-champion/echo lore entry), a warm line ("I'll keep your lamps lit." → `reputation`, `once`),
"what are you selling?" (`open-trade`), and Leave.

### 2. Client — a client-managed `DialogueScreen` overlay + `talk` action

Add `'dialogue'` to `OverlayId` (a client-managed overlay like inventory/codex — NOT projection-driven).
A `talk` `ActionId` + keybinding + command-palette entry, gated (advisory) to "an adjacent
dialogue-bearing NPC is present" — the client scans the projection's visible actors for one whose
content entry has a `dialogueId` and is Chebyshev-adjacent (mirroring how `tradeIsAvailable` gates the
trade action). Opening + the entire tree walk is **pure client session state** (zero determinism
weight): show the greeting + currently-available topics; choosing a topic shows its `response`, unlocks
its `reveals` topics, marks `once` topics used, and fires the consequence. Consequence dispatch:
- `reveal-lore` → the new client function inserts `contentId` into the `Sightings` set and emits the
  first-reveal log line (so the entry's Codex lore becomes readable even if never sighted). Pure client.
- `open-trade` → dispatch the existing `trade-open` intent; close the dialogue overlay (trade's
  projection-driven screen takes over).
- `reputation` → dispatch the new `dialogue-consequence` engine command (§3).
`Leave` closes the overlay. The overlay is Escape-closable and participates in the modal gate like other
overlays.

### 3. Engine — only the reputation consequence (deterministic, saved)

A new `dialogue-consequence` command carrying ONLY the target NPC actor id + the topic id (plus the
usual `commandId`/`expectedRevision`). ⚙️ **Anti-cheat:** the command does NOT carry the faction or
amount — the engine RE-DERIVES the consequence authoritatively from content (`npcActorId` → population →
NPC entry → `dialogueId` → dialogue → the named topic → its `consequence`, which must be `kind:
'reputation'`), so a client cannot spoof an arbitrary faction/amount. Validated exactly like
`merchantSession()` (adjacent to THAT npc, non-hostile, perceived, same floor) via an `isDialogueCommand`
short-circuit in the reducer mirroring `isTradeCommand`/`validateTradeCommand` (dialogue-consequence is
modal + revision-only, like trade). On success it:
- calls `changeReputation({ run, faction, delta: amount, reason: 'dialogue', eventId })` using the
  content-derived faction/amount — with `'dialogue'` newly added to the reason union (`commerce.ts` +
  `events-model.ts`);
- records the applied consequence id in a per-NPC-population `dialogueConsequencesApplied?: readonly
  OpaqueId[]` (omit-when-empty, `Hero.knownSpellIds` pattern) so re-firing the SAME one-time consequence
  is a validated no-op (the command validates the id is not already applied).

reveal-lore, open-trade, and the whole conversation tree never enter the engine. The only new engine
state is the applied-set + the reputation change — both precedented.

### 4. Determinism, testing, scope

- **Determinism (hard invariant).** The new `dialogue` content + the lampwright's `dialogueId` shift the
  pack content hash → content-hash-embed demo fixtures bump (benign, all 8 demos, same as prior content
  milestones). The `dialogue-consequence` command + the omit-when-empty `dialogueConsequencesApplied`
  field are behavior-neutral until a consequence fires — the demo hero never talks, so demos are
  byte-identical except the content hash, and non-dialogue populations serialize identically (field
  omitted). The cross-process parity harness stays green. The reputation command is server-authoritative
  (re-validates adjacency/non-hostile/perceived + the one-time guard) — no new client-trust surface.
- **Testing.**
  - Content: the `dialogue` kind compiles under STRICT; validation resolves `dialogueId`, `factionId`,
    `reveal-lore.contentId` (to a lore-bearing entry), and topic `reveals` targets; rejects a dangling
    reference; the lampwright links a valid `dialogueId`.
  - Engine: `dialogue-consequence` applies the reputation change once (validated adjacency/non-hostile/
    perceived), using the content-derived faction/amount; the one-time guard makes a second application
    a no-op, and the save round-trips the applied-set — with a non-dialogue save byte-identical (field
    omitted). The `'dialogue'` reputation reason threads through `ReputationChangedEvent`. **Anti-cheat
    tests:** a command naming a topic id absent from the NPC's dialogue, or a topic whose consequence is
    not `reputation` (open-trade/reveal-lore/none), is rejected — the engine never trusts a
    client-supplied faction/amount.
  - Client: `talk` opens the overlay only when adjacent to a dialogue-bearing NPC; the tree walk shows
    greeting + topics, a chosen topic shows its response + unlocks `reveals` + marks `once` used;
    `reveal-lore` adds the entry to the Codex lore + emits the reveal line; `open-trade` opens trade;
    `Leave`/Escape closes; the palette/keybinding are gated to availability.
  - Determinism: all 8 demos regenerated (content-hash-embed only) + parity green.
- **Out of scope.** Dialogue for the town merchants and other NPCs; full quest trees / cross-visit
  gated content; dialogue branching on run history beyond the one-time consequence; **reputation-tier-
  gated topics** (`minTier` — a nice future extension, deferred to keep the first cut tight); portrait/
  voice art beyond the existing glyph; making the lampwright reliably reachable (encounter tuning is a
  separate concern).

## Scope boundary

#79 delivers the topic-based conversation framework (a new `dialogue` content kind + `dialogueId` on
NPCs), the travelling lampwright's authored conversation, a client-managed `DialogueScreen` + `talk`
action, and the three light consequences — with only the one-time reputation nudge crossing into the
deterministic engine (one new command + one omit-when-empty save field + a new reputation reason). No
new gameplay systems beyond dialogue; no server-authority changes beyond the validated consequence
command.
