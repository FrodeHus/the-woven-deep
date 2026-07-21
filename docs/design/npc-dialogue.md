# NPC dialogue — topic-based conversation with light consequences

Talk to an NPC (the travelling lampwright first) through an authored, topic-based branching
conversation. Some choices have light consequences: nudging faction reputation, revealing a
Codex lore entry, or opening trade. Today NPCs can only be traded with or fought — there is no
talk/interact path, no conversational content, and reputation is read only by commerce. This is
green-field (the earlier "Dialogue screen mockup" does not exist).

## Decisions (from the user)

- **Light consequences:** choices can nudge Lampwright reputation (one-time), reveal a lore
  entry in the Codex, or open trade — not just flavor.
- **Topic-based branching:** an opening line, then a set of topics the player asks about; each
  topic has an authored response and may reveal further topics.
- **First NPC: the travelling lampwright** (`npc.travelling-lampwright`). Other NPCs stay
  trade-only for now.

## Architecture — the engine/client boundary (the key design call)

Dialogue is mostly a CLIENT-authored conversation, with only the run-state consequences going
through the engine (so determinism + save stay clean, mirroring how trade is the authoritative
state path while its screen is client UI).

- **Authored dialogue content (new).** A new optional `dialogue` on the NPC entry (or a linked
  `dialogue` content kind — see below): `{ greeting: string, topics: DialogueTopic[] }` where
  `DialogueTopic = { id, prompt (the player's option label), response (the NPC's line),
  reveals?: topicId[] (topics unlocked by asking this), consequence?: DialogueConsequence,
  once?: boolean }`. `DialogueConsequence` is a closed, validated union:
  - `{ kind: 'reputation', factionId, amount }` — engine, one-time.
  - `{ kind: 'reveal-lore', contentId }` — client (adds the entry to the lore/Sightings set so
    its Codex lore becomes readable; ties to the lore feature #78).
  - `{ kind: 'open-trade' }` — reuses the existing `trade-open` path.
  Content-compiler validation resolves `factionId`/`contentId`/topic `reveals` targets (mirror
  the existing cross-ref validators). Choose a new `dialogue` CONTENT KIND (keyed by id,
  referenced from the NPC via `dialogueId?`) over inlining on the NPC, so a conversation is its
  own reviewable/reusable unit and the NPC entry stays lean — matching how loot-tables/vaults
  are separate kinds.
- **Client conversation (the bulk).** A `talk` `PlayerIntent` + a `DialogueScreen` overlay
  (new, modeled on the trade/house/decision overlays — its own intent, not a widened
  DecisionPrompt). On talk-open the client walks the authored tree: shows the greeting + the
  currently-available topics; choosing a topic shows the response, applies `reveals` (unlock
  more topics, client state), and fires the consequence. `reveal-lore` is pure client (add the
  contentId to the lore-reveal set — reuse the #78 Sightings/known-lore path — and drop the
  first-reveal log line). Topic-traversal + one-visit topic state is client/session (no
  determinism weight — it changes nothing in the run).
- **Engine consequences (deterministic, saved).** Only the `reputation` (and future
  state-changing) consequence is an engine command: a new `dialogue-consequence` command (or
  `talk-choose`) validated like `merchantSession()` (adjacent to THAT npc, non-hostile,
  perceived) that applies `changeReputation` deterministically and sets a ONE-TIME flag on the
  NPC's population so re-talking can't farm it — the direct precedent is `MerchantPopulation`'s
  one-time flags (`aggressionPenaltyApplied`, …). Save-schema: add a per-NPC-population
  `dialogueConsequencesApplied: readonly consequenceId[]` (or a set of applied one-time topic
  ids), omitted-when-empty so non-dialogue saves stay byte-identical. `open-trade` dispatches
  the existing `trade-open`.

This keeps determinism tight: the ONLY new engine state is the one-time-applied set + the
reputation change (both already precedented). The conversation itself and lore-reveal are
client presentation. Determinism impact: the new `dialogue` content + the lampwright's
`dialogueId` are a content change → content-hash-embed fixture bump (benign). The engine command
+ save field are behavior-neutral until a dialogue consequence actually fires (which the demo
hero never does).

## Reputation + lore ties

- Reputation: reuses `changeReputation`/`FactionReputation`/`reputationTier` (`commerce.ts`).
  A one-time reputation nudge is the first non-commerce consumer of reputation. Optionally, the
  NPC's greeting/available topics can VARY by current reputation tier (a nice extension — the
  lampwright warmer when trusted); keep the first cut simple (tier-gating optional per topic
  via a `minTier?`), decide during the plan.
- Lore reveal: reuses the #78 lore-reveal path (add to the client lore/Sightings set + the
  first-reveal log line), so a lampwright topic ("Tell me of the fallen") reveals that entry's
  Codex lore even if the player never sighted it.

## The lampwright's conversation (authored, first cut)

An opening line + topics like: the lamps (what she sells / why light matters), the Heart (a
guarded, lore-light hint), the fallen (reveals a fallen-champion / echo lore entry), a warm
choice that nudges reputation once ("I'll keep your lamps lit."), and "what are you selling?"
(opens trade), plus Leave. In-voice, spoiler-light, consistent with her flavor (fire-resistant
Lampwright-faction light-keeper). Exact copy authored in the content task.

## Surface + input

- New `DialogueScreen` overlay (registry + a `talk` keybinding + palette "Talk" entry), opened
  by a `talk` intent when adjacent to a dialogue-bearing NPC (validation mirrors `trade-open`'s
  "no merchant nearby" → "no one to talk to nearby"). Click-to-talk on the NPC cell can also
  trigger it (optional; the redesign's click-ops precedent). Reuse theme tokens; a portrait +
  the NPC line + a list of topic options + Leave, following the TradeScreen dialog pattern.

## Testing

- Content: the `dialogue` kind compiles; validation resolves faction/lore/topic-reveal targets;
  the lampwright links a valid `dialogueId`.
- Engine: the `dialogue-consequence` command applies a reputation change once (validated
  adjacency/non-hostile), the one-time flag prevents a second application, save round-trips the
  applied-set (omit-when-empty → non-dialogue saves byte-identical); demos VERIFY OK
  (content-hash-embed only).
- Client: talk-open walks the tree (greeting + topics), choosing a topic shows the response +
  reveals + fires the consequence; reveal-lore adds the entry to the Codex lore + log line;
  open-trade opens trade; Leave closes; the overlay is gated to adjacency.
- Determinism: only content-hash-embed fixture fields move; the engine command/save field are
  behavior-neutral for the demo hero.

## Out of scope (future)

Dialogue for the town merchants + other NPCs, full quest trees / cross-visit gated content,
dialogue that branches on run history beyond reputation tier, and voice/portrait art beyond the
existing glyph. This builds the topic-based-conversation framework + the lampwright's
conversation + the three light consequences.
