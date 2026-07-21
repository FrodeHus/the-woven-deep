# AssetPopover — descriptions + known facts

Completes the content-descriptions UI surface: the play-view hover popover for a cell's
asset (a ground item, or a stair/door tile) currently shows only a title + a one-word
detail. This wires in the authored `description` and the item's known facts (name +
Damage/Armor/Light/Worth), identification-gated — matching what the inventory `DetailPane`
already shows, so hovering an item on the ground tells you the same known facts as opening it.

Grounded in what exists: items/monsters carry an authored `description?` on
`PresentedContentEntry`; the projection omits an item's `contentId` until it is
identified/known, so `contentId` presence is the identification signal (same gate
`DetailPane`/`ThreatPopover` use). Tiles/features have NO content-pack backing (no tile
content kind, no description) — stairs/doors keep their honest hardcoded copy; there is
nothing to author for them.

## Changes

1. **Extract a shared `itemKnownFacts` helper.** `DetailPane` inlines the Damage/Armor/Light/
   Worth fact logic in JSX. Factor it into a reusable
   `itemKnownFacts(content: ItemContentEntry): readonly { label: string; value: string }[]`
   (Damage via `formatDice(combat.damage)`; Armor when `combat.armor > 0`; Light when
   `light?.radius`; Worth from `price`) in a shared module (`apps/web/src/session/item-facts.ts`).
   Refactor `DetailPane` to consume it — behavior-preserving (same rows, same order, same
   labels). This is the DRY the exploration flagged.
2. **Carry `contentId` to the hover popover.** Add `contentId?: string` to `HoverAsset`
   (`useCellHover.ts`) and populate it from the ground item's `item.contentId` in
   `itemAssetAtCell` (already identification-gated upstream by the engine — `undefined` for
   unidentified). Tile assets leave it `undefined`.
3. **Give `AssetPopover` a `pack` prop** (mirroring `ThreatPopover`), passed from
   `PlayScreen`.
4. **Render description + facts in `AssetPopover`.** When `asset.contentId` resolves via
   `itemById(pack, asset.contentId)`: show the authored `description` (if present) and the
   `itemKnownFacts` rows beneath the existing title/detail. When `contentId` is undefined
   (unidentified item, or a tile), render exactly as today (title + detail only) — no
   description, no facts. Keep the name (title) always.

## Constraints
- Gate on `contentId !== undefined` (NOT `identified` alone) — the wire projection omits
  `contentId` for unknown items.
- Reuse theme tokens; keep the popover's existing positioning/clamping behavior and props
  otherwise unchanged.
- Behavior-preserving for `DetailPane` (the helper extraction must not change its output).

## Tests
- New `apps/web/test/asset-popover.test.tsx` mirroring `threat-popover.test.tsx`: an
  identified item shows its description + facts (Damage/Worth); an unidentified item (no
  `contentId`) shows title/detail only, no description/facts; a stair/door tile shows the
  honest hardcoded copy and no facts.
- Keep the existing web suite green (esp. `threat-popover.test.tsx`, any DetailPane usage).
