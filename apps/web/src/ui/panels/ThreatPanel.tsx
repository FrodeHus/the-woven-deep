import type { JSX } from 'react';
import type { SessionSnapshot } from '../../session/guest-session.js';
import type { PanelProps } from './types.js';

export interface ProjectedThreatActor {
  readonly actorId: string;
  readonly name?: string;
  readonly glyph?: string;
  readonly disposition: string;
  readonly healthPresentation: { readonly band: string };
  readonly intentPresentation?: string;
}

interface ProjectedGroundItem {
  readonly itemId: string;
  readonly name: string;
}

function threatActors(snapshot: SessionSnapshot): readonly ProjectedThreatActor[] {
  return (snapshot.projection.actors as unknown as readonly ProjectedThreatActor[])
    .filter((actor) => actor.disposition === 'hostile');
}

function groundItems(snapshot: SessionSnapshot): readonly ProjectedGroundItem[] {
  return snapshot.projection.groundItems as unknown as readonly ProjectedGroundItem[];
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
            {items.map((item) => <li key={item.itemId}>{item.name}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
