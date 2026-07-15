import { describe, expect, it } from 'vitest';
import type { PublicEvent } from '@woven-deep/engine';
import { effectsForEvents, MAX_TRANSIENT_EFFECTS, type ActorPositions } from '../src/ui/effects-map.js';

const HERO = 'actor.hero';
const RAT = 'actor.rat';
const BEETLE = 'actor.beetle';

const positions: ActorPositions = new Map([
  [HERO, { x: 5, y: 5 }],
  [RAT, { x: 8, y: 5 }],
  [BEETLE, { x: 3, y: 2 }],
]);

describe('effectsForEvents', () => {
  it('maps actor.damaged to a hit-flash at the target cell', () => {
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: RAT, sourceActorId: HERO, amount: 4, health: 6 },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'event.1', kind: 'hit-flash', x: 8, y: 5 },
    ]);
  });

  it('maps hero.damaged to a hit-flash at the hero cell', () => {
    const events: PublicEvent[] = [
      { type: 'hero.damaged', amount: 3, damageType: 'physical' },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'hero.damaged-0', kind: 'hit-flash', x: 5, y: 5 },
    ]);
  });

  it('maps combat.observed to an attack-streak with attacker/target endpoints', () => {
    const events: PublicEvent[] = [
      { type: 'combat.observed', eventId: 'event.2', outcome: 'hit', attackerActorId: HERO, targetActorId: RAT },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'event.2', kind: 'attack-streak', x: 5, y: 5, toX: 8, toY: 5 },
    ]);
  });

  it('maps item.thrown to an attack-streak from the thrower to the landing point', () => {
    const events: PublicEvent[] = [
      { type: 'item.thrown', eventId: 'event.3', actorId: HERO, itemId: 'item.dart', quantity: 1, to: { x: 9, y: 9 } },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'event.3', kind: 'attack-streak', x: 5, y: 5, toX: 9, toY: 9 },
    ]);
  });

  it('maps actor.died to a death-burst at the actor cell', () => {
    const events: PublicEvent[] = [
      { type: 'actor.died', eventId: 'event.4', actorId: BEETLE, contentId: 'monster.beetle', killerActorId: HERO },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'event.4', kind: 'death-burst', x: 3, y: 2 },
    ]);
  });

  it('maps actor.death-observed to a death-burst at the actor cell', () => {
    const events: PublicEvent[] = [
      { type: 'actor.death-observed', eventId: 'event.5', actorId: BEETLE, contentId: 'monster.beetle' },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([
      { key: 'event.5', kind: 'death-burst', x: 3, y: 2 },
    ]);
  });

  it('returns nothing for unmapped events', () => {
    const events: PublicEvent[] = [
      { type: 'item.picked-up', eventId: 'event.6', actorId: HERO, itemId: 'item.gold', quantity: 1 },
      { type: 'rest.completed', eventId: 'event.7', stopReason: 'full-health', elapsed: 4, effectiveHealing: 2 },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([]);
  });

  it('drops nothing that resolves without a known position', () => {
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.8', actorId: 'actor.unknown', sourceActorId: HERO, amount: 1, health: 1 },
    ];
    expect(effectsForEvents(events, HERO, positions)).toEqual([]);
  });

  it('caps at MAX_TRANSIENT_EFFECTS, dropping the oldest first', () => {
    const events: PublicEvent[] = Array.from({ length: MAX_TRANSIENT_EFFECTS + 5 }, (_unused, index) => ({
      type: 'actor.damaged' as const, eventId: `event.${index}`, actorId: RAT, sourceActorId: HERO,
      amount: 1, health: 9,
    }));
    const mapped = effectsForEvents(events, HERO, positions);
    expect(mapped).toHaveLength(MAX_TRANSIENT_EFFECTS);
    // oldest (event.0 .. event.4) dropped; the surviving effects are the most recent ones.
    expect(mapped[0]).toEqual({ key: 'event.5', kind: 'hit-flash', x: 8, y: 5 });
    expect(mapped.at(-1)).toEqual({ key: `event.${MAX_TRANSIENT_EFFECTS + 4}`, kind: 'hit-flash', x: 8, y: 5 });
  });
});
