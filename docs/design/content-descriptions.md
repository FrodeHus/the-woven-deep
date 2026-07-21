# Content descriptions

**Status:** Shipped (items, monsters)

## What this is

Content entries had no authored free-text field: the web client's hover popovers and
inventory detail could only show a name and a mechanical category. This feature adds an
optional `description` to presented content (items, monsters), authors it for the
bundled item and monster roster, and surfaces it in the client alongside the facts the
client already knew how to show.

## The `description` field

`PresentedContentEntry` (`packages/content/src/model/common.ts`) — the shared base every
item, monster, trap, and NPC entry extends — gains:

```ts
readonly description?: string;
```

Optional, so every existing content file keeps compiling unchanged. The matching Zod
field lives in `presented` (`packages/content/src/compiler/schema/common.ts`):

```ts
export const contentDescription = z.string().trim().min(1).max(CONTENT_DESCRIPTION_MAX_LENGTH);
// ...
export const presented = { ...base, glyph, color, description: contentDescription.optional() };
```

`CONTENT_DESCRIPTION_MAX_LENGTH` (300) lives next to the interface in `model/common.ts`
as the single source for the bound. A description over 300 characters, or an empty/
whitespace-only one, is a compile-time `ContentCompileError` — fail loud, per the
project's content-validation rule, rather than silently truncating.

Authoring is optional per entry; the bundled `content/items/*.yaml` and
`content/monsters/*.yaml` roster all carry a one-to-two-sentence, dark-fantasy-flavored
`description` today. `trap` and `npc` entries share the same base type and so *can* carry
one too, but none currently do — the field only had to be added once, on the shared
`PresentedContentEntry`.

## Where it's read

The description is presentation-only. It is looked up by `contentId` straight from the
compiled `CompiledContentPack` the client already holds — it is never threaded through
the engine's gameplay projection or the save format. `apps/web/src/session/pack-queries.ts`
gained `monsterById`, alongside the existing `itemById`, as the one typed lookup both
consuming components use.

Two surfaces read it today:

- **`apps/web/src/ui/ThreatPopover.tsx`** (monster hover) — looks up the hovered actor's
  `contentId` via `monsterById` and renders the monster's `description`, if any, below
  the existing name/glyph/health-band/intent/disposition line. Nothing about *what*
  facts a hovered actor exposes changed; the description is additive.
- **`apps/web/src/ui/overlays/DetailPane.tsx`** (inventory detail) — once an item is
  identified (`item.contentId` present), looks up its content entry via `itemById` and
  shows its known facts (equipment slot, combat summary, light radius/strength, price,
  stack limit) followed by its `description`. An **unidentified** item shows neither: its
  projection never carries a `contentId` in the first place, so there is nothing to look
  up, and no shuffled/instance item's true identity leaks early.

A third surface — a map-hover popover for ground items (`AssetPopover`) — is being built
on the separate UI-redesign branch and will wire the same `itemById`/`description` lookup
in once that branch merges; it does not exist on this branch and is out of scope here.

## Determinism note

Adding `description` to bundled content changes the compiled content-pack hash (every
field on an entry participates in the pack's stable hash). That is an intentional,
benign content-hash *embed*: no demo reads `description`, and no behavioral event or
projection shape changed. The `*-demo-hashes.json` fixtures that pin the content hash
were regenerated deliberately alongside this change, per the project's rule that a hash
move must be reviewed and intentional, never silently regenerated.
