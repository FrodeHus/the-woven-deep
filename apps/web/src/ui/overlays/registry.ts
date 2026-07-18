import type { ActionId } from '../../session/settings.js';

/**
 * Every overlay the guest UI can present. `inventory` shares this same registry with the other
 * overlay ids -- `i` routes exactly like the other five overlay-open keys (see `KeyRouter.ts`'s
 * `OverlayActionId`).
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
 * actually RENDER for a given id lives in `OverlayHost.tsx`'s `renderBody`, keeping this registry
 * itself a plain data table.
 */
export const OVERLAY_REGISTRY: Readonly<Record<OverlayId, OverlayDefinition>> = {
  // Title (and therefore the dialog's accessible name/`<h2>`) is "Backpack", not "Inventory" --
  // the pinned e2e walks assert `getByRole('dialog', { name: 'Backpack' | /backpack/i })`
  // verbatim. The keymap ACTION label (settings/help rows) stays "Inventory"
  // (`ACTION_LABELS.inventory` in settings.ts) -- that's a separate, unaffected string.
  inventory: { id: 'inventory', title: 'Backpack', scope: 'play', action: 'inventory' },
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
