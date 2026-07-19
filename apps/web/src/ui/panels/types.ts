import type { SessionSnapshot } from '../../session/guest-session.js';
import { heroOf, type HeroView } from '../../session/projection-view.js';

export interface PanelProps {
  readonly snapshot: SessionSnapshot;
}

export type ProjectedHero = HeroView;

export function hero(snapshot: SessionSnapshot): HeroView {
  return heroOf(snapshot.projection);
}

/** Text description of the hero's equipped light, honestly derived from whatever is enabled in an
 * off-hand or main-hand slot with `enabled: true` — the projection has no single "light state"
 * field, so this mirrors the same "first enabled light source wins" rule `EffectsLayer` uses. */
export function lightStateText(equipment: HeroView['equipment']): string {
  const lit = Object.values(equipment).some((item) => item !== null && item.enabled === true);
  return lit ? 'Lit' : 'Dark';
}
