# Feature backlog

Ideas noted for future consideration. Nothing here is committed scope; each item needs its own brainstorm → design → plan cycle before implementation. Recorded 2026-07-16.

## Endgame: refusal releases the ancient horror

Extends the Final Chamber endings (see the roadmap's milestone 7 amendment and `docs/superpowers/specs/2026-07-15-run-records-design.md`). If the hero refuses to take the Heart's place, the ancient horror is released and a major boss fight begins:

- Winning the fight is a huge victory worth a large score bonus — but the fight must be genuinely hard.
- Losing carries no special penalty beyond the record noting that this hero released the ancient horror and fell to it; the world now stands at stake.

Design note for milestone 7: today's model maps refusal to the `refused` completion type (bonus 400) with no fight. This idea likely means either a new completion type for slaying the released horror (with its own Hall tier placement) or an outcome flag on `refused` — decide when the Final Chamber milestone is designed, since completion types are a closed content-schema registry.

## Mini-quests

Support for small optional quests encountered during a descent (fetch, rescue, clear, deliver). Natural fit with the encounter/vault/NPC systems; needs a quest state model in the run and probably content kinds for quest definitions.

## Tilesets

Optional textured tile rendering replacing the ASCII map. The renderer's truth/decoration split and DOM-cell architecture were chosen for ASCII; a tileset mode would swap glyph spans for image cells while keeping the same projection/knowledge/light inputs. Keep the glyph path as the canonical fallback.

## Lifetime high-score list (registered players)

An additional standings list: accumulated score across runs per player profile, only for registered (server-authoritative) players. Builds on milestone 6 profiles plus the run-records `LifetimeState` — lifetime metrics already merge per profile; this adds a cross-profile ranking feed and UI.

## Crafting system

Item crafting from gathered materials. Touches content (recipes as a content kind), inventory, and probably merchant/economy balance.

## Auction house (cross-player)

Player-to-player item trading across profiles. Server-authoritative only; significant economy, persistence, and abuse-prevention surface. Depends on milestone 6 at minimum.

## AI-generated portraits

Replace glyph portraits with a curated set of pre-generated AI images the player chooses from at character creation. Note the existing constraint: Hall/lineage records store a host-side `portraitGlyph` enrichment field — a portrait-image ID would extend that closed enrichment vocabulary, which is a deliberate schema decision to revisit, not an incidental change.

## Smooth raytraced-style lighting (visibility polygons)

Presentation-layer upgrade to the light rendering: cast rays from each light source to wall corners, build a 2D visibility polygon, and draw it as a smooth gradient on a canvas/WebGL overlay behind the glyphs — soft penumbras, crisp diagonal shadow edges that slide across cells as the hero moves, colored light mixing. The engine already occludes light correctly (each source runs shadowcasting in `computeIllumination`), so this changes nothing about gameplay: the integer illumination field stays the authority on what counts as lit for perception, replays, and hashes, and the overlay may only render the same inputs more richly, never disagree with them. Achievable dependency-free with plain canvas; fits the "old-school ASCII + modern effects" direction and slots naturally next to the 5D art pass. Full GPU raytracing/global illumination was considered and rejected as overkill at tile resolution.

## Monster drop loot

Ordinary monsters currently drop nothing — loot tables attach only to bosses (`enhancedLootTableId`) and champions (`echoLootTableId`). A drop system needs a per-monster (or per-population) loot table field in content, defeat-drop wiring in the engine, and economy balancing so early-floor income doesn't trivialize merchant pricing. Surfaced during 5C when the town-loop e2e found nothing sellable at depth 1; 5C sidestepped it (the loop sells surplus starting gear) rather than smuggling in an unbalanced drop system.

## Post-campaign deeper levels

Once a player completes the 20-floor campaign, unlock depths below the standard range with higher difficulty. Monster content already carries `minDepth`/`maxDepth`, so deep-only monsters are cheap to author; needs an unlock gate (profile progression), depth-scaling balance, and probably its own standings tier or score treatment.
