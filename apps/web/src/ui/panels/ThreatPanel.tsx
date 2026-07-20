import type { JSX } from 'react';
import type { SessionSnapshot } from '../../session/guest-session.js';
import {
  actorsOf,
  groundItemsOf,
  type ActorView,
  type GroundItemView,
} from '../../session/projection-view.js';
import type { PanelProps } from './types.js';

export type ProjectedThreatActor = ActorView;

function threatActors(snapshot: SessionSnapshot): readonly ActorView[] {
  return actorsOf(snapshot.projection).filter((actor) => actor.disposition === 'hostile');
}

function groundItems(snapshot: SessionSnapshot): readonly GroundItemView[] {
  return groundItemsOf(snapshot.projection);
}

export function ThreatPanel({ snapshot }: PanelProps): JSX.Element {
  const hostiles = threatActors(snapshot);
  const items = groundItems(snapshot);
  const nothingNearby = hostiles.length === 0 && items.length === 0;
  return (
    <section
      aria-label="Threats"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm text-fg"
    >
      {nothingNearby && <p className="italic text-muted">Nothing nearby.</p>}
      {hostiles.length > 0 && (
        <ul className="flex flex-col gap-1">
          {hostiles.map((actor) => (
            <li key={actor.actorId}>
              <span aria-hidden="true">{actor.glyph}</span>
              {` ${actor.name ?? 'Something'} — ${actor.healthPresentation.band}`}
              {actor.intentPresentation ? ` (${actor.intentPresentation})` : ''}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <>
          <p className="text-xs text-muted">On the ground nearby</p>
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.itemId}>{item.name}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
