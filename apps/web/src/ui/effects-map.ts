import type { OpaqueId, PublicEvent } from '@woven-deep/engine';

export interface TransientEffect {
  readonly key: string;
  readonly kind: 'hit-flash' | 'attack-streak' | 'death-burst';
  readonly x: number;
  readonly y: number;
  readonly toX?: number;
  readonly toY?: number;
}

export const MAX_TRANSIENT_EFFECTS = 12;

export type ActorPositions = ReadonlyMap<OpaqueId, Readonly<{ x: number; y: number }>>;

/**
 * Maps one snapshot's hero-visible public events to transient world-coordinate effects.
 *
 * NOTE on the `positions` parameter: `PublicEvent` itself carries no position for most combat
 * kinds (`actor.damaged`, `combat.observed`, `actor.died`, and their partial-visibility variants
 * expose only actor identifiers, never x/y — confirmed against `packages/engine/src/model.ts`).
 * Only `ItemThrownEvent` embeds a point (`to`). Since `TransientEffect` must report world
 * coordinates, this mapping needs a last-known actor/hero position lookup that the caller
 * maintains across renders (actors that just died are already gone from the current
 * `GameplayProjection`, so their death position must come from a snapshot taken before they were
 * removed). `EffectsLayer` owns that lookup and passes it in here; this is a disclosed deviation
 * from the brief's literal two-argument signature, made because the two-argument form cannot
 * satisfy "hit-flash at the target cell" / "death-burst" for any event that lacks an embedded
 * point.
 */
export function effectsForEvents(
  events: readonly PublicEvent[], heroId: OpaqueId, positions: ActorPositions = new Map(),
): readonly TransientEffect[] {
  const effects: TransientEffect[] = [];

  const at = (actorId: OpaqueId): Readonly<{ x: number; y: number }> | undefined => positions.get(actorId);

  events.forEach((event, index) => {
    const key = `${event.type}-${index}`;
    switch (event.type) {
      case 'hero.damaged': {
        const origin = at(heroId);
        if (origin) effects.push({ key, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.damaged': {
        const origin = at(event.actorId);
        if (origin) effects.push({ key: event.eventId, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.damage-observed': {
        const origin = at(event.actorId);
        if (origin) effects.push({ key: event.eventId, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'combat.observed': {
        const from = at(event.attackerActorId);
        const to = at(event.targetActorId);
        if (from && to) {
          effects.push({ key: event.eventId, kind: 'attack-streak', x: from.x, y: from.y, toX: to.x, toY: to.y });
        }
        break;
      }
      case 'item.thrown': {
        const from = at(event.actorId);
        if (from) {
          effects.push({
            key: event.eventId, kind: 'attack-streak',
            x: from.x, y: from.y, toX: event.to.x, toY: event.to.y,
          });
        }
        break;
      }
      case 'actor.died': {
        const origin = at(event.actorId);
        if (origin) effects.push({ key: event.eventId, kind: 'death-burst', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.death-observed': {
        const origin = at(event.actorId);
        if (origin) effects.push({ key: event.eventId, kind: 'death-burst', x: origin.x, y: origin.y });
        break;
      }
      default:
        break;
    }
  });

  return effects.length > MAX_TRANSIENT_EFFECTS ? effects.slice(-MAX_TRANSIENT_EFFECTS) : effects;
}
