# Lore reveal — Codex Lore tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Author lore on monsters + items, reveal it on discovery with a subtle log note, and read it in a new Lore tab of the Codex.

**Architecture:** A new optional `lore?` content field (longer than `description`); the reveal + surface are client-only, riding the existing session-scoped `Sightings`/`deriveCodexState` discovery substrate. See `docs/design/lore-codex.md`.

**Tech Stack:** content YAML→Zod; React 19 / Tailwind v4; Vitest.

## Global Constraints

- `lore?` is OPTIONAL + omitted-when-empty → entries without it are byte-identical.
- Determinism: the ONLY hash movement is content-hash-embed from authoring lore (Task 2), the benign class (contentHash-derived save fields; NO behaviour/projection hash moves). Client tasks (3, 4) are determinism-free. Verify.
- Reuse theme tokens; preserve the existing Codex behaviour/tests; DRY/YAGNI/TDD.
- Lore is spoiler-light, in-voice dark-fantasy flavor — not mechanical stats.

## Task 1: `lore?` content field + schema

**Files:** `packages/content/src/model/common.ts` (`PresentedContentEntry` + `CONTENT_LORE_MAX_LENGTH`), the compiler schema for presented entries + fail-loud validation (mirror `contentDescription`/`CONTENT_DESCRIPTION_MAX_LENGTH`). Test: `packages/content/test/`.

- [ ] Add `readonly lore?: string` to `PresentedContentEntry` (base for monster/item/npc/trap). Add `CONTENT_LORE_MAX_LENGTH = 1200`.
- [ ] Schema: an optional `lore` string, trimmed, non-empty when present, ≤ `CONTENT_LORE_MAX_LENGTH`, fail-loud over the cap — exactly mirroring how `contentDescription`/`description` is validated. Omitted when absent.
- [ ] Tests: an entry with `lore` compiles and exposes it; an entry over the cap fails with a clear message; an entry without `lore` compiles with `lore: undefined` (unchanged).
- [ ] Commit.

## Task 2: Author monster + item lore + fixture regen

**Files:** `content/monsters/*.yaml` (the roster) + `content/items/*.yaml` (notable items); regen `packages/engine/test/fixtures/*-demo-hashes.json`.

- [ ] Author `lore` (in-voice, spoiler-light, ≤1200 chars, distinct per entry) on the existing monsters (the full roster) and a solid set of items (weapons/armor/consumables/light sources — the ones a player meets early + the named/notable ones). Use the existing `description` fields + world tone (the Deep, the Weave, lampwrights, the Heart) as the voice reference. Not every item needs lore, but cover the meaningful set.
- [ ] Build content; run the engine suite. Regenerate the content-hash-embed demo fixtures (gameplay/merchant/population/run-records/endgame) via the demo scripts' regenerate mechanism (same as the trait-taxonomy/Loomcaller regen).
- [ ] **Determinism check:** confirm only contentHash-derived save-class fields moved (save/events/record/heart/saveHash) and NO projection/behaviour hash moved (lore is display text, never touched by the demo hero's behaviour). engine/dungeon demos unchanged. Report the moved fields.
- [ ] Tests: a sampling of authored monsters/items carry non-empty `lore`; all 7 demos VERIFY OK.
- [ ] Commit (content + fixtures together).

## Task 3: Codex Lore tab (deriveCodexState + CodexOverlay)

**Files:** `apps/web/src/session/codex-derive.ts` (expose `lore` per discovered entry), `apps/web/src/ui/overlays/CodexOverlay.tsx` (`CATEGORY_ORDER` + a `lore` category), the CodexEntry type. Test: `CodexOverlay.test.tsx` + a codex-derive test.

- [ ] Extend `deriveCodexState`: for each DISCOVERED monster/item entry, resolve its `lore` from the pack and include it on the derived entry (only for discovered entries — spoiler-free). Add a derived "lore" collection = discovered monster + item entries that HAVE authored lore.
- [ ] `CodexOverlay`: add a `lore` category to `CATEGORY_ORDER`; the Lore tab lists the discovered lore-bearing entries (name + `[revealed]`), grouped monsters then items; selecting one shows the full lore text in the detail pane (reuse the existing `DetailPane` pattern). Undiscovered / lore-less entries are absent from the Lore tab. Theme tokens; preserve existing Codex tabs/behaviour.
- [ ] Tests: with a discovered lore-bearing monster + item, the Lore tab lists both and shows the lore text in the detail; an undiscovered lore-bearing entry is absent; a discovered lore-LESS entry is absent from the Lore tab (but still in its own category tab). Existing Codex tests stay green.
- [ ] Commit.

## Task 4: First-reveal log note

**Files:** `apps/web/src/session/codex-storage.ts` (`accumulateSightings`) or wherever new sightings are detected + the log is appended; the log/session plumbing. Test: a codex-storage/session test.

- [ ] When `accumulateSightings` adds a NEW monster id (first sighting) or item id (first find/identify) whose content entry HAS authored `lore`, push a subtle first-reveal line to the adventure log ("The threads whisper of {name}." — author a short, consistent template; keep it in-voice). Fire ONCE per entry (guarded by the existing not-previously-seen dedup). No note for lore-less entries or on re-sighting.
- [ ] Wire the log append through the same path other client log lines use (find how system/discovery log lines are appended to `LogPanel`'s source).
- [ ] Tests: newly sighting a lore-bearing monster appends exactly one reveal line; a lore-LESS monster appends none; re-sighting appends none; an item newly identified with lore appends one.
- [ ] Commit.

## Task 5: Whole-surface verification

- [ ] `npm run verify` exit 0 (typecheck, lint, format:check, depcruise, knip, all suites).
- [ ] All 7 demos VERIFY OK; only contentHash-derived fixture fields moved (Task 2); no behaviour/projection hash moved.
- [ ] Format fixups if any; commit.

## Self-review

- Coverage: lore field (T1), authored lore + determinism (T2), Codex Lore tab (T3), reveal note (T4), gate (T5) — matches the design + the 3 user decisions (Codex Lore tab, monsters+items, subtle reveal note).
- Determinism: only T2 moves hashes (content-hash-embed); T3/T4 are client-only.
- Scope: session-scoped persistence (rides existing Sightings); no lore-fragment mechanic, no floor-flavor, no class/faction lore — all out of scope.
