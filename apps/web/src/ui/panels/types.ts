import type { SessionSnapshot } from '../../session/guest-session.js';
import { heroOf, type HeroView } from '../../session/projection-view.js';

export interface PanelProps {
  readonly snapshot: SessionSnapshot;
}

export type ProjectedHero = HeroView;

export function hero(snapshot: SessionSnapshot): HeroView {
  return heroOf(snapshot.projection);
}

/** Whether the hero carries no burning light at all, honestly derived from whatever is enabled in
 * an off-hand or main-hand slot with `enabled: true` — the projection has no single "light state"
 * field, so this mirrors the same "first enabled light source wins" rule `equippedLightSource`
 * (`light-sources.ts`, consumed by `IsoRenderer`) uses. */
export function heroLightIsOut(equipment: HeroView['equipment']): boolean {
  return !Object.values(equipment).some((item) => item !== null && item.enabled === true);
}

/** Text description of the hero's equipped light, from the same single rule {@link heroLightIsOut}
 * applies. */
export function lightStateText(equipment: HeroView['equipment']): string {
  return heroLightIsOut(equipment) ? 'Dark' : 'Lit';
}
