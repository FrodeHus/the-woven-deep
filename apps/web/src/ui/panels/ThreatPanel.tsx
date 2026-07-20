import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import {
  actorsOf,
  adjacentLockedFeature,
  groundItemsOf,
  heroCanAttemptPick,
  heroOf,
  type ActorView,
  type FeatureView,
  type GroundItemView,
} from '../../session/projection-view.js';
import { chordKey, type ResolvedKeymap } from '../../session/settings.js';
import type { PanelProps } from './types.js';

export interface ThreatPanelProps extends PanelProps {
  readonly keymap: ResolvedKeymap;
  readonly pack: CompiledContentPack;
}

function threatActors(snapshot: SessionSnapshot): readonly ActorView[] {
  return actorsOf(snapshot.projection).filter((actor) => actor.disposition === 'hostile');
}

function groundItems(snapshot: SessionSnapshot): readonly GroundItemView[] {
  return groundItemsOf(snapshot.projection);
}

function lockedFeatureNearby(snapshot: SessionSnapshot): FeatureView | undefined {
  return adjacentLockedFeature(snapshot.projection);
}

export function ThreatPanel({ snapshot, keymap, pack }: ThreatPanelProps): JSX.Element {
  const hostiles = threatActors(snapshot);
  const items = groundItems(snapshot);
  const locked = lockedFeatureNearby(snapshot);
  const canAttemptPick =
    locked !== undefined && heroCanAttemptPick(heroOf(snapshot.projection), pack);
  const pickChord = chordKey(keymap.byAction['pick-lock']);
  const nothingNearby = hostiles.length === 0 && items.length === 0 && locked === undefined;
  return (
    <section
      aria-label="Threats"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm text-fg"
    >
      {nothingNearby && <p className="italic text-muted">Nothing nearby.</p>}
      {locked !== undefined && (
        <p
          className={
            canAttemptPick ? 'threat-lock-hint threat-lock-hint--ready' : 'threat-lock-hint'
          }
        >
          {canAttemptPick
            ? `A locked ${locked.type} is here — press ${pickChord} to pick it.`
            : `A locked ${locked.type} is here, but you have no key or lockpick.`}
        </p>
      )}
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
