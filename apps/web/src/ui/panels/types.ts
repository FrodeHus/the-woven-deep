import type { SessionSnapshot } from '../../session/guest-session.js';

export interface PanelProps {
  readonly snapshot: SessionSnapshot;
}

export interface ProjectedEquippedItem { readonly itemId: string; readonly name: string }

export interface ProjectedBackpackItem { readonly itemId: string; readonly name: string }

export interface ProjectedCondition {
  readonly conditionId: string; readonly name: string; readonly color: string;
  readonly stacks: number; readonly remaining: number | null;
}

export interface ProjectedHero {
  readonly name: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly hungerStage: string;
  readonly conditions: readonly ProjectedCondition[];
  readonly equipment: Readonly<Record<string, ProjectedEquippedItem | null>>;
  readonly backpack: readonly ProjectedBackpackItem[];
  readonly backpackCapacity: number;
}

export function hero(snapshot: SessionSnapshot): ProjectedHero {
  return snapshot.projection.hero as unknown as ProjectedHero;
}

/** Text description of the hero's equipped light, honestly derived from whatever is enabled in an
 * off-hand or main-hand slot with `enabled: true` — the projection has no single "light state"
 * field, so this mirrors the same "first enabled light source wins" rule `EffectsLayer` uses. */
export function lightStateText(equipment: ProjectedHero['equipment']): string {
  const lit = Object.values(equipment).some((item) =>
    item !== null && (item as unknown as { enabled?: boolean }).enabled === true);
  return lit ? 'Lit' : 'Dark';
}
