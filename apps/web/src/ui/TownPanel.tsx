import type { JSX } from 'react';
import type { SessionSnapshot } from '../session/guest-session.js';

interface ProjectedHero {
  readonly x: number;
  readonly y: number;
}

interface ProjectedMerchantActor {
  readonly actorId: string;
  readonly name?: string;
  readonly factionName?: string;
  readonly reputationTier?: string;
  readonly tradeAvailable?: boolean;
  readonly x: number;
  readonly y: number;
}

interface ProjectedPlacementSlot {
  readonly slotId: string;
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}

function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Merchant actors carry `factionName` only via `visibleMerchantState` (see the engine's
 * `projection.ts`), so its presence -- rather than any population-model tag lost in translation
 * -- is the honest signal that an actor is a merchant. */
function merchantActors(projection: SessionSnapshot['projection']): readonly ProjectedMerchantActor[] {
  return (projection.actors as unknown as readonly ProjectedMerchantActor[])
    .filter((actor) => typeof actor.factionName === 'string');
}

export interface TownPanelProps {
  readonly snapshot: SessionSnapshot;
}

/**
 * The town's replacement for `ThreatPanel`: nothing here is ever hostile, so instead this lists
 * the three permanent merchants (name, faction, reputation, trade availability) and a proximity
 * hint for the house door -- both derived honestly from what the projection already exposes
 * (`actors` for merchant positions, the new `slots` field for the house door), never from any
 * hidden run state.
 */
export function TownPanel({ snapshot }: TownPanelProps): JSX.Element {
  const { projection } = snapshot;
  const hero = projection.hero as unknown as ProjectedHero;
  const merchants = merchantActors(projection);
  const houseDoor = (projection.slots as unknown as readonly ProjectedPlacementSlot[])
    .find((slot) => slot.tags.includes('house-door'));
  const houseAdjacent = houseDoor !== undefined
    && chebyshevDistance(hero.x, hero.y, houseDoor.x, houseDoor.y) === 1;

  return (
    <section aria-label="Town" className="town-panel">
      {merchants.length === 0 && <p className="placeholder">No merchants nearby.</p>}
      {merchants.length > 0 && (
        <ul className="town-merchant-list">
          {merchants.map((merchant) => {
            const adjacent = chebyshevDistance(hero.x, hero.y, merchant.x, merchant.y) === 1;
            const canTrade = adjacent && merchant.tradeAvailable !== false;
            return (
              <li key={merchant.actorId} className={adjacent ? 'town-merchant town-merchant--nearby' : 'town-merchant'}>
                <span>{merchant.name ?? merchant.factionName}</span>
                {merchant.reputationTier !== undefined && <span className="town-merchant-reputation">{merchant.reputationTier}</span>}
                {merchant.tradeAvailable === false && <span className="town-merchant-unavailable">unavailable</span>}
                {canTrade && <span className="town-merchant-trade-hint">press Shift+T to trade</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className={houseAdjacent ? 'town-house-hint town-house-hint--nearby' : 'town-house-hint'}>
        {houseAdjacent ? 'The house is nearby — press Shift+H to open it.' : 'The house'}
      </p>
    </section>
  );
}
