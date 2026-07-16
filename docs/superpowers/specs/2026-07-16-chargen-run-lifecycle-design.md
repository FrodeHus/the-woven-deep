# Character Generation and Run Lifecycle (Milestone 5B) Design

Approved design for the second sub-milestone of milestone 5 (decomposition in `docs/superpowers/specs/2026-07-15-guest-play-core-design.md`). It delivers the seven-step character generation flow, the title screen, the run-conclusion screen, and the guest Hall of Records — closing the loop from creating a hero to dying, seeing the record, and rolling the next one.

## Decisions

- Classes, backgrounds, and traits are mechanically real but modest: classes grant starting-equipment kit choices and identity tags; backgrounds grant one derived-stat modifier plus optional extra starting items; traits grant one derived-stat modifier each (pick 0–2). Everything reuses the existing `deriveActorStats` modifier pipeline — no flat attribute bonuses (per the master design) and no new combat mechanics. Later milestones deepen classes with abilities and spells.
- Two playable classes ship: Wayfarer and Lamplighter. Archivist and Warden are authored as locked entries — visible in the class step as silhouettes with names and unlock hints, unselectable — per the master design's rule. Unlock gating stays dormant until achievement wiring arrives.
- `createNewRun` starts deriving hero maximum health from the chosen attributes through the balance formulas, replacing 5A's hard-coded 20. The maxHealth coefficient is tuned so the default attribute block (10s) still yields 20. Consequence: hero stats can change combat outcomes, so 5A's pinned end-to-end walk is re-derived once with the existing harness.
- Chargen randomness is deterministic from a chargen seed: the client generates one seed (`crypto.getRandomValues`, or `?seed=` in tests), 3d6 rolls come from the engine's `deriveSeed`/`rollDie` primitives on it, and the same seed becomes the run seed at confirmation. No new RNG stream. The one permitted full reroll consumes the next draws from the same sequence, so a rolled character is reproducible from its seed.
- The client stays dependency-free. The 5A deferral of TanStack was revisited as promised: screens form a linear session flow, not URL-addressable destinations, and the wizard has one text input — a hand-rolled `ScreenState` union plus a pure wizard reducer covers it. Revisit routing at milestone 6 when profile/auth flows make URLs meaningful.

## Content schema v6 (`packages/content`)

Three new kinds, following the achievement-kind precedent file for file (model, compiler schema, registries where needed, cross-file validation, bundled YAML, admin docs, tests), bumping `CONTENT_SCHEMA_VERSION` to 6:

- `class`: `description`, `playable: boolean`, `silhouetteGlyph` + `color`, `unlockHint` (required on non-playable entries), `classTags` (non-empty; these flow into Hall records), and `kits` — two to three named kits, each a list of equipped entries (`contentId`, `slot`, optional `enabled`) and backpack entries (`contentId`, optional `quantity`). Cross-file validation: every kit item exists, is equippable in the named slot (or is a valid backpack item), and playable classes have at least two kits.
- `background`: `description`, `modifiers` (a partial record of derived-stat names to non-zero integers, validated against the balance formula names), optional `extraItems` (backpack entries).
- `trait`: `description` plus exactly one derived-stat modifier.
- Balance gains `pointBuy: { budget, costs }` where `costs` is an ordered table of `{ value, cost }` covering every value from `attributeMinimum` to `attributeMaximum` with non-decreasing (escalating) costs. Both attribute methods share the same bounds.

Bundled content: Wayfarer (blade kit: iron sword, wooden shield, pitch torch, rations; ranger kit: hunting bow, arrows, pitch torch, rations) and Lamplighter (lantern kit: brass lantern, lamp oil, iron sword, rations; torchbearer kit: two pitch torches, iron sword, extra rations), both playable; Archivist and Warden locked with hint text. Three backgrounds (caravan guard: `defense +1`; deep-miner: `search +1`, extra lamp oil; ratcatcher: `meleeAccuracy +1`, extra rations). Five traits, one modifier each. Exact values are authored content, tuned during implementation within the schema's bounds.

## Engine additions (`packages/engine`)

A pure chargen module (`src/chargen.ts`):

- `rollAttributes(seed)` — 3d6 per attribute in fixed order via `deriveSeed`/`rollDie`; returns the block and the next roll state. `rerollAttributes` consumes the following draws from the same sequence. Results clamp nothing: 3–18 naturally sits inside the balance bounds, and validation confirms.
- `pointBuyCost(attributes, balance)` — checked-integer total from the cost table; `pointBuyValid` enforces the budget and bounds.
- `validateHeroChoices({ pack, choices })` — class exists and is playable, kit belongs to the class, background/traits exist, trait count ≤ 2 with no duplicates, attributes within bounds and (for point buy) within budget, name and portrait glyph valid. Throws naming the violation; the UI should make these unrepresentable, so a throw is a client bug surfacing loudly.
- `heroFromChoices({ pack, choices })` → the extended `NewRunHero`: name, portrait glyph, attributes, `classId` + `classTags`, `backgroundId`, `traitIds`, the kit's equipped/backpack entries plus the background's extra items, and the merged derived-stat modifiers.

`NewRunHero` gains `classId`, `classTags`, `backgroundId`, `traitIds`, and `statModifiers`. The portrait glyph deliberately does NOT join `NewRunHero`: it is host enrichment, never engine truth. The client keeps it in a small session-state key beside the save (like the command counter) so Continue restores it, and attaches it to the stored record's enrichment at finalization. `createNewRun` derives `maxHealth` from the balance formulas over the chosen attributes with the hero's modifiers applied (coefficient tuned so all-10s stays 20) and stores the identity fields on the run's hero state as needed for finalization. Storing those fields is a save-schema bump: active-run schema v6 → v7, preserving the current strict schema as `legacyActiveRunV6Schema` with exactly one ordered migration (v4→v5→v6→v7; migrated saves default to empty class tags, no background/traits, and empty stat modifiers, preserving every v6 field byte-for-byte). The hero's permanent stat modifiers also thread into every runtime `deriveActorStats` call for the hero, so backgrounds and traits affect play, not just the preview. `finalizeRun`'s `classTags: []` placeholder fills from the hero; Hall records now carry real class tags, and the guest enrichment carries the portrait glyph.

Hero identity rules (the master design leaves them open, fixed here): names are 1–24 characters after trimming, letters, digits, spaces, apostrophes, and hyphens, NFC-normalized; the portrait glyph comes from a curated set defined in the client (`@` plus a small set of accent-colored variants) and is stored as enrichment, never engine truth.

## Web: wizard, screens, and lifecycle (`apps/web`)

- `session/wizard-reducer.ts` — pure, framework-free: `{ step, name, portraitGlyph, method, attributes, rollState, rerollUsed, classId, kitId, backgroundId, traitIds }` with actions per step; illegal transitions are unrepresentable (cannot advance past a step with an invalid selection; cannot select a locked class; cannot exceed the trait cap or point-buy budget). Selectors expose the live derived-stats preview via `deriveActorStats` so steps 3 and 7 show exactly what `createNewRun` will build.
- `App` owns `ScreenState`: `title → chargen → play → conclusion → hall`. Title offers Enter the Deep (new hero → chargen), Continue (only when a stored run decodes cleanly), and Hall of Records. All screens keyboard-first, reusing the dialog/focus conventions from 5A.
- Run conclusion: when the session snapshot carries a non-null conclusion, the app finalizes exactly once — `finalizeRun` with the repository's lifetime state, `appendRecord` + `applyDeltas` on the repository, then the conclusion screen from `projectRunConclusion`: cause of death with the killer's name, a final-moments recap (the last ~8 log lines), the itemized score table, notable metrics, heirloom, achievement grants, and "Recorded in the Hall — unverified, this session only." Actions: view Hall, new hero, title. Victory completion types render with the same screen when they become producible in milestone 7.
- Guest Hall: a sessionStorage-backed `RunRecordRepository` implementation behind the existing interface (own storage key, separate from the active run and the command counter), records enriched with the portrait glyph and a session-relative achieved marker — the 1-based run number within this session, rendered as "Run #N" (no wall-clock dates enter engine data). The Hall screen lists records with the master design's tier-then-score sort and outcome/class filters; each record expands to its score breakdown. Guest records are marked unverified and session-only.
- The `?seed=` hook seeds both chargen and the run; a test-only `?quickstart=` boots directly into play with the default hero so 5A's pinned walk stays stable. While touching the storage seams, the two legacy test fakes still using the pre-hotfix single-value storage signature are updated to the keyed interface (a dormant trap flagged in the hotfix review).

## Error handling

- Wizard state is in-memory; abandoning mid-flow costs nothing and returns to the title.
- `validateHeroChoices` is the engine backstop behind the reducer's unrepresentability; its throw is surfaced as a client-bug error screen, not silently absorbed.
- Repository storage failures reuse 5A's persistent-warning pattern: the run continues, records may be lost, the player is told which failure occurred.
- A stored run whose decode fails on Continue falls back to the title with the save-discarded notice; a repository blob that fails to parse is discarded with a visible notice while the active run survives (independent keys).
- Finalization is guarded exactly-once per run (the engine's `finalized` flag is the truth; the app never re-finalizes a restored, already-finalized run).

## Testing and exit demonstration

- Content: schema/parse/compile/docs suites per the achievement precedent, including kit cross-validation, point-buy table monotonicity, locked-class hint requirements, and v5 pack rejection.
- Engine: chargen unit + property tests — rolls always within bounds and deterministic per seed, reroll consumes a disjoint draw sequence, point-buy arithmetic checked-integer with exact budget edges, `heroFromChoices` output always passes `validateHeroChoices`, `createNewRun` with derived maxHealth round-trips the codec, all-10s hero still lands at 20 maxHealth; `finalizeRun` records carry the class tags.
- Web: wizard-reducer table tests per step (legal/illegal transitions, budget/trait caps, locked-class rejection); screen-flow component tests (title gating of Continue, conclusion rendering from a finalized fixture, Hall sorting/filtering, storage-failure notices); the repository implementation tested against the same behavioral suite as the in-memory one (append-only immutability, delta idempotence, standings) plus persistence round-trips.
- End-to-end: drive the full wizard deterministically (roll, reroll, switch to point buy, pick Lamplighter's lantern kit, background, two traits, confirm, arrive in the dungeon with the chosen loadout visible); a death loop on a seeded run engineered to die fast — conclusion screen assertions (cause, score table, recorded marker), into the Hall, back to a new hero; the 5A pinned walk re-derived once against the new hero stats and kept green via `?quickstart=`.
- Exit demonstration: `npm run guest:e2e` green including the new specs, plus every existing engine/content/demo gate.

## Out of scope for 5B

Class unlock evaluation from achievements (the entries and hints ship; gating activates when milestone 6/7 wires unlock state), abilities/spells per class, town and house (5C), inventory/codex/settings overlays and the accessibility/art passes (5D), server-side Hall verification (milestone 6), and the Final Chamber completion types (milestone 7) — the conclusion screen handles them structurally but only `died` is producible.
