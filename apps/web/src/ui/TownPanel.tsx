import type { JSX } from 'react';
import type { SessionSnapshot } from '../session/guest-session.js';
import { chebyshev, heroOf, merchantActors } from '../session/projection-view.js';
import { chordKey, type ResolvedKeymap } from '../session/settings.js';

export interface TownPanelProps {
  readonly snapshot: SessionSnapshot;
  /** The resolved keymap, plumbed down from `PlayScreen` exactly like every overlay body -- the
   * trade/house key hints below render from `keymap.byAction` (via `chordKey`) rather than a
   * hardcoded chord, since both actions are rebindable `ActionId`s. */
  readonly keymap: ResolvedKeymap;
}

/**
 * The town's replacement for `ThreatPanel`: nothing here is ever hostile, so instead this lists
 * the three permanent merchants (name, faction, reputation, trade availability) and a proximity
 * hint for the house door -- both derived honestly from what the projection already exposes
 * (`actors` for merchant positions, the new `slots` field for the house door), never from any
 * hidden run state.
 */
export function TownPanel({ snapshot, keymap }: TownPanelProps): JSX.Element {
  const { projection } = snapshot;
  const tradeChord = chordKey(keymap.byAction.trade);
  const houseChord = chordKey(keymap.byAction.house);
  const descendChord = chordKey(keymap.byAction.descend);
  const hero = heroOf(projection);
  const merchants = merchantActors(projection);
  const houseDoor = projection.slots.find((slot) => slot.tags.includes('house-door'));
  const houseAdjacent = houseDoor !== undefined && chebyshev(hero, houseDoor) === 1;
  const returnDepth = projection.returnAnchorDepth;

  return (
    <section aria-label="Town" className="town-panel">
      {merchants.length === 0 && <p className="placeholder">No merchants nearby.</p>}
      {merchants.length > 0 && (
        <ul className="town-merchant-list">
          {merchants.map((merchant) => {
            const adjacent = chebyshev(hero, merchant) === 1;
            const canTrade = adjacent && merchant.tradeAvailable !== false;
            return (
              <li
                key={merchant.actorId}
                className={adjacent ? 'town-merchant town-merchant--nearby' : 'town-merchant'}
              >
                <span>{merchant.name ?? merchant.factionName}</span>
                {merchant.reputationTier !== undefined && (
                  <span className="town-merchant-reputation">{merchant.reputationTier}</span>
                )}
                {merchant.tradeAvailable === false && (
                  <span className="town-merchant-unavailable">unavailable</span>
                )}
                {canTrade && (
                  <span className="town-merchant-trade-hint">{`press ${tradeChord} to trade`}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {returnDepth !== undefined && (
        <p className="town-return-hint">
          {`Return to depth ${returnDepth} — press ${descendChord} at the stair.`}
        </p>
      )}
      <p className={houseAdjacent ? 'town-house-hint town-house-hint--nearby' : 'town-house-hint'}>
        {houseAdjacent ? `The house is nearby — press ${houseChord} to open it.` : 'The house'}
      </p>
    </section>
  );
}
