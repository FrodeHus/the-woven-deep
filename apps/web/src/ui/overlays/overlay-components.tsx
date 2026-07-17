import type { ComponentType, JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { StoredHallRecord } from '@woven-deep/engine';
import type { Sightings } from '../../session/codex.js';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { ResolvedKeymap, Settings } from '../../session/settings.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';
import { InventoryOverlay } from './InventoryOverlay.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';
import { MapJournalOverlay } from './MapJournalOverlay.js';
import { CodexOverlay } from './CodexOverlay.js';
import type { OverlayId } from './registry.js';

/**
 * Props passed to whatever component `OVERLAY_COMPONENTS` maps an `OverlayId` to. Both hosts
 * (`App.tsx`'s title-screen entry points and `PlayScreen.tsx`'s in-play entry points) pass the same
 * bag of fields regardless of which overlay is actually open -- each field is optional so a given
 * body can ignore whatever it doesn't need (e.g. `SettingsOverlay`, wired below, never touches
 * `snapshot`/`records`). Fields were widened one at a time, exactly when the overlay that needed
 * them landed, rather than all carried from the start.
 */
export interface OverlayBodyProps {
  readonly settings?: Settings;
  readonly onChangeSettings?: (next: Settings) => void;
  readonly onClearGuestSession?: () => void;
  readonly keymap?: ResolvedKeymap;
  /** The compiled content pack -- added for the help overlay (Task 4), which needs it to build the
   * glyph legend. Both hosts already have `pack` on hand for every render (`App`'s boot-fetched
   * state, `PlayScreen`'s own `pack` prop) regardless of which overlay is open or whether a run is
   * live, so it's forwarded here unconditionally the same way `keymap` already is -- rather than
   * threading it in only for `help`, which would make this bag vary by `OverlayId` after all. */
  readonly pack?: CompiledContentPack | undefined;
  /** The live session snapshot and dispatch -- added for the inventory overlay (Task 5), which
   * needs the hero's backpack/equipment projection and a way to issue `backpack` intents. Only
   * `PlayScreen` (a live run) ever passes these; `App`'s title-screen overlay host never does,
   * which is fine -- `inventory` is `play`-scope only (see `registry.ts`'s `canOpenOverlay`), so
   * `InventoryOverlayBody` is never actually reached without them. */
  readonly snapshot?: SessionSnapshot;
  readonly onDispatch?: (intent: PlayerIntent) => void;
  /** The Hall of Records and the unlock codex's sighting cache -- added for the codex overlay
   * (Task 8), which is `global`-scope (reachable from the title screen too, where `snapshot` above
   * is absent) and so needs its OWN discovery sources threaded past `snapshot`. Both hosts (`App`,
   * which owns the Hall `repository`/session storage directly, and `PlayScreen` via `GameRoot`,
   * which now forwards them) always pass these regardless of which overlay is open, the same
   * "cheap to always pass" convention `pack`/`keymap` already established. */
  readonly records?: readonly StoredHallRecord[];
  readonly sightings?: Sightings;
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `SettingsOverlay`'s own (fully required)
 * `SettingsOverlayProps`. The non-null assertions are safe in practice, not just convenient: both
 * hosts always pass `settings`/`onChangeSettings`/`onClearGuestSession`/`keymap` on every render
 * (see `App.tsx`'s `renderOverlayHost`/`GameRoot` and `PlayScreen.tsx`'s overlay-render block) --
 * they don't vary by which `OverlayId` is open. The fallback paragraph only exists so a future bug
 * in that wiring fails as a visible, dismissible overlay body (caught by `OverlayErrorBoundary`'s
 * sibling, the play surface, staying up) rather than a thrown exception.
 */
function SettingsOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { settings, onChangeSettings, onClearGuestSession, keymap } = props;
  if (!settings || !onChangeSettings || !onClearGuestSession || !keymap) {
    return <p>Settings are unavailable right now.</p>;
  }
  return (
    <SettingsOverlay
      settings={settings}
      onChange={onChangeSettings}
      onClearGuestSession={onClearGuestSession}
      keymap={keymap}
    />
  );
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `HelpOverlay`'s own (fully required)
 * `HelpOverlayProps`. Same non-null-assertion reasoning as `SettingsOverlayBody`: both hosts always
 * pass `keymap`/`pack` on every render, regardless of which overlay is open.
 */
function HelpOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { keymap, pack } = props;
  if (!keymap || !pack) {
    return <p>Help is unavailable right now.</p>;
  }
  return <HelpOverlay keymap={keymap} pack={pack} />;
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `InventoryOverlay`'s own (fully required)
 * `InventoryOverlayProps`. Same non-null-assertion reasoning as the other two real bodies above --
 * `PlayScreen` always passes `snapshot`/`onDispatch` on every render (see `PlayScreen.tsx`'s
 * overlay-render block), regardless of which overlay is open.
 */
function InventoryOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { snapshot, onDispatch } = props;
  if (!snapshot || !onDispatch) {
    return <p>Your backpack is unavailable right now.</p>;
  }
  return <InventoryOverlay snapshot={snapshot} onDispatch={onDispatch} />;
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `CharacterSheetOverlay`'s own (fully required)
 * `CharacterSheetOverlayProps`. Same non-null-assertion reasoning as `InventoryOverlayBody` --
 * `PlayScreen` always passes `snapshot` on every render regardless of which overlay is open; unlike
 * inventory, this overlay never dispatches anything, so `onDispatch` isn't threaded through.
 */
function CharacterSheetOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { snapshot } = props;
  if (!snapshot) {
    return <p>Your character sheet is unavailable right now.</p>;
  }
  return <CharacterSheetOverlay snapshot={snapshot} />;
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `MapJournalOverlay`'s own (fully required)
 * `MapJournalOverlayProps`. Same non-null-assertion reasoning as `CharacterSheetOverlayBody` --
 * `PlayScreen` always passes `snapshot` on every render regardless of which overlay is open; this
 * overlay never dispatches anything either.
 */
function MapJournalOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { snapshot } = props;
  if (!snapshot) {
    return <p>The map and journal are unavailable right now.</p>;
  }
  return <MapJournalOverlay snapshot={snapshot} />;
}

/**
 * Adapts the widened `OverlayBodyProps` bag down to `CodexOverlay`'s own (fully required)
 * `CodexOverlayProps`. Unlike every other real body above, `snapshot` here is genuinely OPTIONAL --
 * `codex` is `global`-scope (reachable from the title screen, with no live run), so `undefined`
 * (never passed) is a normal, expected case, not a wiring bug: `CodexOverlay`/`deriveCodexState`
 * both accept a `null` snapshot on purpose. `records`/`sightings`/`pack` are always passed by both
 * hosts regardless of overlay id (see the doc comment on `OverlayBodyProps`), so only THEIR absence
 * (a wiring bug, same as every other body's non-null assertions) falls back to the placeholder.
 */
function CodexOverlayBody(props: OverlayBodyProps): JSX.Element {
  const { records, sightings, pack, snapshot } = props;
  if (!records || !sightings || !pack) return <p>The codex is unavailable right now.</p>;
  return <CodexOverlay records={records} snapshot={snapshot ?? null} sightings={sightings} pack={pack} />;
}

/**
 * The single shared lookup from `OverlayId` to the component that renders its body -- previously
 * duplicated as an identical `overlayBody` switch in both `App.tsx` and `PlayScreen.tsx`. Every id
 * is now real: `settings` (Task 3), `help` (Task 4), `inventory` (Task 5, absorbing the
 * pre-existing `BackpackMenu`), `character-sheet` (Task 6), `map-journal` (Task 7), and `codex`
 * (Task 8, the last placeholder).
 *
 * Deliberately its own module (not folded into `registry.ts`): `registry.ts` stays React-free (it
 * is also consumed by a framework-free help-overlay content builder), while this module is the
 * React-specific component lookup both hosts share.
 */
export const OVERLAY_COMPONENTS: Readonly<Record<OverlayId, ComponentType<OverlayBodyProps>>> = {
  inventory: InventoryOverlayBody,
  'character-sheet': CharacterSheetOverlayBody,
  'map-journal': MapJournalOverlayBody,
  codex: CodexOverlayBody,
  settings: SettingsOverlayBody,
  help: HelpOverlayBody,
};
