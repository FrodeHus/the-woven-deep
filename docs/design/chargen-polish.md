# Chargen polish

Two small deferred chargen UX fixes. Web-only, no engine/content/determinism impact. (The
other two items once listed under "Deferred chargen polish" — `STAT_LABELS` consolidation
and pack-selector consolidation — were already completed during the architecture epic /
ChargenConsole rebuild.)

## 1. At-cap trait disabled marker (distinct from locked)

`OptionRow` (`apps/web/src/ui/screens/chargen/OptionRow.tsx`) has only a `locked?: boolean`
prop, and `TraitsStep` overloads it for the "2/2 traits already picked" case, so an unpicked
trait at the cap renders identically to a trait that is permanently locked behind an unlock
hint (`⊘`, dashed border, greyed) — conflating two different meanings.

- Add a distinct **`disabled?: boolean`** prop to `OptionRow`: an item that is currently
  unselectable (a cap is reached) but not permanently locked. It blocks click/keydown like
  `locked`, but renders differently from the locked-forever treatment (no unlock-hint
  affordance; a cap-context reason instead) and sets `aria-disabled` with that reason.
  `locked` keeps its meaning (never selectable here, with an unlock hint).
- `TraitsStep` passes `disabled: !selected && atCap` (where `atCap = traitIds.length >= 2`)
  instead of `locked`. At-cap unpicked traits now read as "unavailable right now (2/2
  picked)", visually and for screen readers, not as "locked".

## 2. Portrait per-glyph tint

`PORTRAIT_GLYPHS` (`apps/web/src/session/wizard-reducer.ts`) defines five glyph ids with
distinct intended accents (`@`, `@·gold`, `@·ember`, `@·mist`, `@·moss`), but the picker
(`IdentityStep`) renders every option as a plain `@` with no hue, and `HeroRecord` strips the
accent and uses one fixed `text-accent` colour — so the five portraits are visually
identical. (A per-glyph colour map existed before the ChargenConsole rewrite and was dropped
in it.)

- Reintroduce a single-sourced `glyph id → colour` map (keyed by the `PORTRAIT_GLYPHS` ids,
  living next to that constant so the two can't drift), and apply it: in `IdentityStep`'s
  picker each portrait option is tinted its own colour; in `HeroRecord` the portrait tile is
  tinted by the selected glyph. Reuse `OptionRow`'s existing `glyphColor` prop where it fits.
  The base `@` (no accent) keeps the default accent colour.

## Testing

Behaviour-focused RTL: an at-cap unpicked trait is `aria-disabled` and does not toggle on
click, and is distinguishable from a `locked` row (different marker/reason, no unlock hint);
each portrait option renders its own colour and the selected glyph's colour flows to the hero
record. No engine/content tests, no demo-hash impact.
