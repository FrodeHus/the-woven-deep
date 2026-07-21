# Lore reveal — a Codex Lore tab

Authored lore that the player uncovers through play, surfaced in the Codex. Today the Codex
(`CodexOverlay`) already gates discovered/undiscovered entries (class/item/spell/monster) from
the session-scoped discovery substrate (`Sightings` = seen monsters + found/identified items,
+ Hall records, combined by `deriveCodexState`). This feature authors real lore, reveals it on
discovery, and reads it in a new **Lore** tab of the Codex.

## Decisions (from the user)

- **Surface: a Lore tab in the Codex** — not a separate overlay. Reuse the Codex's discovery
  gating + detail pane.
- **Scope: monsters + items** carry authored lore, revealed via the existing Sightings
  substrate (monster on first sighting; item on find/identify).
- **Reveal moment: a subtle first-reveal note** in the adventure log the first time an entry's
  lore is uncovered ("The threads whisper of the Cave Rat…").

## Content

- New **optional** `lore?: string` on `PresentedContentEntry` (`packages/content/src/model/
  common.ts`) — a LONGER field than the 300-char `description` (cap ~1200 chars, its own
  `CONTENT_LORE_MAX_LENGTH` + fail-loud validation, mirroring `contentDescription`). Kept
  SEPARATE from `description` so descriptions stay short for hover popovers and lore is the
  deeper reading text. Optional + omitted-when-empty, so entries without lore are unchanged.
- Author `lore` on the existing **monsters** (the 30-monster roster) and a solid set of
  **items**. Not every entry needs it (optional), but author a meaningful, in-voice set —
  dark-fantasy, spoiler-light, evocative. (Authoring the full monster roster + notable items.)
- Determinism: adding `lore` text is a content change → the content-hash-embed demo fixtures
  move by their contentHash-derived save-class fields only (the same benign class as
  descriptions/trait-tags). Regenerate them; confirm no behaviour/projection hash moves.

## Reveal trigger + note (client)

- The reveal rides the EXISTING `Sightings` accumulation (`apps/web/src/session/codex-storage.ts`
  `accumulateSightings`): a monster id newly added to `Sightings.monsterIds`, or an item id
  newly added to `Sightings.itemIds`, is a "new discovery." When a newly-discovered entry HAS
  authored `lore` (look it up via `monsterById`/`itemById`), push a subtle first-reveal line to
  the adventure log (the existing log surface `LogPanel` reads): e.g. "The threads whisper of
  {name}." Fire once per entry (guarded by the not-previously-seen check that already dedups
  Sightings). No note for entries without lore (no spam).
- This is client-only (the log line is a client log entry, not an engine event) → no
  determinism impact.

## The Codex Lore tab (client)

- Add a `lore` category to `CodexOverlay` (`CATEGORY_ORDER`), listing DISCOVERED monster + item
  entries that have authored `lore`, most-recent-first or grouped (monsters, then items). Each
  row shows the entry name + a `[revealed]` marker; selecting it shows the full lore text in the
  detail pane (reuse the existing Codex `DetailPane` pattern). Undiscovered / lore-less entries
  do not appear in the Lore tab (it is a collection of what you've genuinely uncovered).
- Extend `deriveCodexState` (`codex-derive.ts`) to expose, per discovered monster/item, its
  `lore` (resolved from the pack) so the tab can render it. Keep it spoiler-free: only
  discovered entries' lore is included.
- The Codex is already registered (`registry.ts`, key `x`); the Lore tab is a new category
  inside it — no new overlay/keybinding.

## Persistence

Rides the existing **session-scoped** `Sightings` + Hall substrate (same lifetime as the Codex
today; `sessionStorage`). True cross-run/account lore collection waits on the deferred profile
store (milestone 6) — out of scope here, matching the Codex's current limitation. Noted, not
built.

## Testing

- **Content:** the `lore` field compiles (optional, capped, fail-loud over the cap); authored
  monsters/items carry lore; entries without it are unchanged.
- **Client:** `deriveCodexState` exposes lore only for discovered entries; the Lore tab lists
  discovered lore-bearing monsters/items and shows the text in the detail pane; undiscovered /
  lore-less entries are absent. The first-reveal log line fires once when a lore-bearing entry
  is newly sighted/identified, and NOT for lore-less entries or on re-sighting.
- **Determinism:** demos VERIFY OK; only contentHash-derived fixture fields moved (from the
  lore authoring); no behaviour/projection hash moved.

## Out of scope

Lore fragments as a trackable collectible mechanic, floor/vault-entry flavor narration,
class/faction lore, and cross-run/account lore persistence — all deferred (see the exploration
flags + the profile-store milestone). This feature is: a `lore` content field + authored
monster/item lore + the Codex Lore tab + the first-reveal log note.
