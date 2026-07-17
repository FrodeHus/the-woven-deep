import type { ActionId } from '../../session/settings.js';

/**
 * Every overlay the guest UI can present. `inventory` keeps routing through the pre-existing
 * `BackpackMenu`/`open-backpack` path for now (see `KeyRouter.ts`'s `OverlayActionId`, which
 * deliberately excludes it) -- a later guest-interface task absorbs it into this registry. It is
 * still listed here (and carries a real `OverlayDefinition`) because the registry is meant to be
 * the single source of truth for every overlay's title/scope/action, even before every id is
 * wired end-to-end.
 */
export type OverlayId = 'inventory' | 'character-sheet' | 'map-journal' | 'codex' | 'settings' | 'help';

export interface OverlayDefinition {
  readonly id: OverlayId;
  readonly title: string;
  readonly scope: 'play' | 'global';
  /** The keymap action that opens this overlay -- for help text/hints, never a key literal. */
  readonly action: ActionId;
}

/**
 * React-free by design: this module is consumed by both the (React) component layer and, in a
 * later task, the framework-free help-overlay content builder. Component lookup for what to
 * actually RENDER for a given id lives in `PlayScreen`/`App` (see their `overlayBody` helpers),
 * keeping this registry a plain data table.
 */
export const OVERLAY_REGISTRY: Readonly<Record<OverlayId, OverlayDefinition>> = {
  inventory: { id: 'inventory', title: 'Inventory', scope: 'play', action: 'inventory' },
  'character-sheet': { id: 'character-sheet', title: 'Character Sheet', scope: 'play', action: 'character-sheet' },
  'map-journal': { id: 'map-journal', title: 'Map & Journal', scope: 'play', action: 'map-journal' },
  codex: { id: 'codex', title: 'Codex', scope: 'global', action: 'codex' },
  settings: { id: 'settings', title: 'Settings', scope: 'global', action: 'settings' },
  help: { id: 'help', title: 'Help', scope: 'global', action: 'help' },
};

/**
 * Whether `definition` may open right now: `global`-scope overlays (codex/settings/help) are
 * always allowed (from the title screen or from play); `play`-scope overlays (inventory,
 * character sheet, map/journal) require an actual live run, i.e. the play screen with a session.
 *
 * Not part of the brief's literal produced interface, but exported (rather than kept private)
 * because it is the one piece of scope-gating logic `App` needs and it is otherwise untestable in
 * isolation from a full render -- see `overlay-infrastructure.test.tsx`.
 */
export function canOpenOverlay(definition: OverlayDefinition, isPlayActive: boolean): boolean {
  return definition.scope === 'global' || isPlayActive;
}
