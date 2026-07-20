# Future: Backlog and Ideas

Upcoming features and deferred polish, kept short — enough to remember the intent, not a
full spec. When one of these gets designed for real, it gets its own spec under
`docs/superpowers/specs/` and a summary lands in the relevant doc in this directory.

## Recently shipped

- **G5 — findable items.** Monster on-death loot via loot tables, and vault item-slots
  resolved into real ground items. Shipped.
- **G7 — locks and lockpicking.** Vault-only locked doors and locked chests, opened by a
  lockpick skill check against the `disarm` derived stat; ordinary failure consumes a
  stackable lockpick, a natural-1 permanently jams a chest, and optional keys open doors
  without a check. This milestone also built the production feature spawner (authored
  vault door/chest slots become real `DungeonFeature`s) and the client pick-lock action.
  See `locks-and-lockpicking.md`. Shipped.

## Light-out feats — shipped

All three ship as chargen-selectable `trait` content (see `light-out-feats.md`):

- **Born in the Dark** — darkvision. `modifiers: { lightOutRevealRadius: 3 }` → reveal
  radius 4.
- **Living Compass** — `modifiers: { lightOutMemoryPersists: 1 }`; the remembered map stays
  visible while dark. Still doesn't commit newly dark-fumbled terrain — it only unhides
  prior memory.
- **Dungeon Sense** — commits discovered terrain to the remembered map regardless of light
  on/off, the one feat that overrides the "dark discoveries are never committed" rule. Added
  the third knob `lightOutCommitsMemory` and wired it into the knowledge-commit path.

## Deferred chargen polish

- **Portrait per-glyph tint.** Currently portraits share one accent treatment;
  per-glyph tinting is deferred.
- **At-cap trait `⊘` disabled marker.** Needs an `OptionRow` `disabled` prop distinct
  from `locked` (locked = never selectable with an unlock hint; disabled = currently
  unselectable because a cap is reached, e.g. 2/2 traits already picked).
- **Consolidate `STAT_LABELS`.** The derived-stat label maps are currently duplicated
  across `CharacterSheetOverlay`, `HeroRecord`, and the chargen steps. Should become one
  shared map.
- **Pack-selector consolidation.** Deferred cleanup of duplicated selector logic across
  chargen steps.

## Other deferred items surfaced during design

- **Stack splitting and quick slots** (inventory) — the engine has no such commands;
  noted during 5D-1 as real engine work, not UI work.
- **Return-journey reinforcement checks and artifact hazards** — the master design
  originally attached these to a Heart return journey; deferred to the future Final
  Chamber / endings milestone, and possibly moot depending on how that milestone's
  Heart-as-person redesign (`run-records.md`) shapes the return trip.
- **Attackable town NPCs**, reputation fallout, and town-death records — deliberately
  deferred in 5C alongside the town truce mechanic.
- **More than one strongbox tier** (house capacity upgrades) — 5C shipped exactly one.
- **The champion `killerContentId` records-path leak** — a known records-semantics
  wrinkle noted during 5D-2, revisit with milestone 6/7 record work.
- **Real content display-name/lore fields** — several presentation surfaces
  (inventory detail, Help) currently humanize raw content/effect IDs into labels rather
  than reading authored display text; a future content-schema milestone should add real
  fields.
- **Visibility-polygon lighting** — shipped in 5D-2 as the `smooth` lighting mode; noted
  here only as historical context that it was originally a backlog item promoted forward.

## Playtest bugs (2026-07 triage) — resolved

The four bugs from the 2026-07-15 / 2026-07-18 playtests (the two lists were the same
issues) are all fixed on `main`:

- **Oil refill** — the client never built a `refuel` command, so lamp oil fell through to
  `use-item`; wired the refuel intent/command + inventory action button.
- **Healing** — `recoveryAmount` was `1`, which floored to 0 HP/interval at the hungry
  stage; raised to `10`.
- **Sparse spawns** — early-encounter `maximumInstancesPerRun` caps weren't rescaled after
  floors grew 4×; raised them (and the 30-monster roster + G5 loot shipped alongside).
- **Edge-of-map wall** — the outer border ring was seeded with the void tile instead of the
  wall tile, so FOV revealed blank space at the map edge; seed the wall tile.
