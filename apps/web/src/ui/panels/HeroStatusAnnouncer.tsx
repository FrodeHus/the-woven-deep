import { useEffect, useRef, useState, type JSX } from 'react';
import type { SessionSnapshot } from '../../session/guest-session.js';
import {
  floorAnnouncement,
  heroAnnouncements,
  type FloorAnnounceSnapshot,
  type HeroAnnounceSnapshot,
} from '../hero-announce.js';
import { hero, type PanelProps, type ProjectedHero } from './types.js';

function announceSnapshot(heroData: ProjectedHero): HeroAnnounceSnapshot {
  return {
    health: heroData.health,
    maxHealth: heroData.maxHealth,
    hungerStage: heroData.hungerStage,
    conditions: heroData.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      name: condition.name,
    })),
  };
}

function floorSnapshot(snapshot: SessionSnapshot): FloorAnnounceSnapshot {
  const { floor } = snapshot.projection;
  return { floorId: floor.floorId, depth: floor.depth, town: floor.town };
}

/**
 * A visually-hidden `role="status"` / `aria-live="polite"` region that speaks ONLY the hero's own
 * significant transitions -- health crossing 50%/25%, a hunger stage change, a condition gained or
 * faded (see `heroAnnouncements`) -- plus genuine floor transitions (see `floorAnnouncement`).
 * Mounts once and stays mounted for the whole play session, holding the previous hero and floor
 * snapshots in refs; the first snapshot of each only establishes its baseline and announces
 * nothing, so entering the screen (or restoring a save already deep in the dungeon) is silent.
 */
export function HeroStatusAnnouncer({ snapshot }: PanelProps): JSX.Element {
  const current = announceSnapshot(hero(snapshot));
  const currentFloor = floorSnapshot(snapshot);
  const prevRef = useRef<HeroAnnounceSnapshot | null>(null);
  const prevFloorRef = useRef<FloorAnnounceSnapshot | null>(null);
  const [message, setMessage] = useState('');

  const conditionKey = current.conditions.map((condition) => condition.conditionId).join(',');
  useEffect(() => {
    const prev = prevRef.current;
    const prevFloor = prevFloorRef.current;
    prevRef.current = current;
    prevFloorRef.current = currentFloor;

    const messages = prev === null ? [] : heroAnnouncements(prev, current);
    const floorMessage = floorAnnouncement(prevFloor, currentFloor);
    if (floorMessage !== null) messages.push(floorMessage);

    // Non-empty guard: pushing '' would clear the region; only overwrite it when there is something
    // new to say, so a repeated identical message is re-announced by toggling through a space.
    if (messages.length === 0) return;
    const next = messages.join(' ');
    setMessage((previous) => (previous === next ? `${next} ` : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.health, current.maxHealth, current.hungerStage, conditionKey, currentFloor.floorId]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-label="Hero status">
      {message}
    </div>
  );
}
