import type { ComponentType, JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PlayerIntent } from '../../session/intents.js';
import type { ResolvedKeymap, Settings } from '../../session/settings.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';
import { InventoryOverlay } from './InventoryOverlay.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';
import type { OverlayId } from './registry.js';

/**
 * Props passed to whatever component `OVERLAY_COMPONENTS` maps an `OverlayId` to. Both hosts
 * (`App.tsx`'s title-screen entry points and `PlayScreen.tsx`'s in-play entry points) pass the same
 * bag of fields regardless of which overlay is actually open -- each field is optional so a
 * placeholder body (still `ComingSoon` for four of the six ids) can ignore all of them, and a real
 * body (like `SettingsOverlay`, wired below) picks out only what it needs. Later guest-interface
 * tasks widen this further (e.g. a `snapshot`/`pack` for the codex) exactly when a new overlay
 * needs it, rather than carrying unused fields for everyone from the start.
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
}

function ComingSoon(): JSX.Element {
  return <p>Coming in a later task</p>;
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
 * The single shared lookup from `OverlayId` to the component that renders its body -- previously
 * duplicated as an identical `overlayBody` switch in both `App.tsx` and `PlayScreen.tsx`. Two ids
 * (`map-journal`, `codex`) are still the placeholder component; `settings` (Task 3), `help`
 * (Task 4), `inventory` (Task 5, absorbing the pre-existing `BackpackMenu`), and `character-sheet`
 * (Task 6) are real. Later guest-interface tasks replace the remaining entries here with real
 * components, and both hosts pick up each change automatically.
 *
 * Deliberately its own module (not folded into `registry.ts`): `registry.ts` stays React-free (it
 * is also consumed by a framework-free help-overlay content builder in a later task), while this
 * module is the React-specific component lookup both hosts share.
 */
export const OVERLAY_COMPONENTS: Readonly<Record<OverlayId, ComponentType<OverlayBodyProps>>> = {
  inventory: InventoryOverlayBody,
  'character-sheet': CharacterSheetOverlayBody,
  'map-journal': ComingSoon,
  codex: ComingSoon,
  settings: SettingsOverlayBody,
  help: HelpOverlayBody,
};
