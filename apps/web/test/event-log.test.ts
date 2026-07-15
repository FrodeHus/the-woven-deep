import { describe, expect, it } from 'vitest';
import type { PublicEvent } from '@woven-deep/engine';
import { LOG_CAPACITY, foldEventsIntoLog } from '../src/session/event-log.js';

describe('foldEventsIntoLog', () => {
  it('renders combat, item, light, and survival events as readable lines', () => {
    const events: readonly PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: 'monster.hidden', sourceActorId: 'hero.demo', amount: 3, health: 17 },
      { type: 'item.picked-up', eventId: 'event.2', actorId: 'hero.demo', itemId: 'item.sword', quantity: 1 },
      { type: 'fuel.warning', eventId: 'event.3', itemId: 'item.torch', threshold: 200, fuel: 200 },
      { type: 'hunger.stage-changed', eventId: 'event.4', actorId: 'hero.demo', previousStage: 'sated', stage: 'hungry', reserve: 3000 },
    ];
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log.map((line) => line.tone)).toEqual(['combat', 'info', 'warning', 'warning']);
    expect(folded.log[0]?.text).toMatch(/damage/i);
    expect(folded.nextId).toBe(5);
    expect(folded.log.map((line) => line.id)).toEqual([1, 2, 3, 4]);
  });

  it('covers every listed event type with a non-null rendering', () => {
    const events: readonly PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'e', actorId: 'a', sourceActorId: 'b', amount: 1, health: 5 },
      { type: 'actor.died', eventId: 'e', actorId: 'a', contentId: 'monster.rat', killerActorId: 'hero.demo' },
      { type: 'hero.damaged', amount: 4, damageType: 'physical' },
      { type: 'combat.observed', eventId: 'e', outcome: 'hit', attackerActorId: 'a', targetActorId: 'b', attackerName: 'Rat', targetName: 'Wayfarer' },
      { type: 'item.picked-up', eventId: 'e', actorId: 'a', itemId: 'item.x', quantity: 1 },
      { type: 'item.equipped', eventId: 'e', actorId: 'a', itemId: 'item.x', slot: 'main-hand' },
      { type: 'item.consumed', eventId: 'e', actorId: 'a', itemId: 'item.x', quantity: 1 },
      { type: 'item.light-extinguished', eventId: 'e', itemId: 'item.torch' },
      { type: 'fuel.warning', eventId: 'e', itemId: 'item.torch', threshold: 200, fuel: 200 },
      { type: 'hunger.stage-changed', eventId: 'e', actorId: 'a', previousStage: 'sated', stage: 'hungry', reserve: 3000 },
      { type: 'rest.completed', eventId: 'e', stopReason: 'full-health', elapsed: 400, effectiveHealing: 12 },
      { type: 'feature.revealed', eventId: 'e', actorId: 'a', featureId: 'feature.trap' },
      { type: 'door.opened', eventId: 'e', actorId: 'a', featureId: 'feature.door' },
      { type: 'trap.triggered', eventId: 'e', actorId: 'a', featureId: 'feature.trap' },
      { type: 'sound.heard', category: 'combat', direction: 'east', distanceBand: 'near' },
      { type: 'action.invalid', eventId: 'e', commandId: 'command.1', reason: 'blocked.wall' },
      { type: 'run.concluded', eventId: 'e', completionType: 'died', cause: { type: 'death' } as never },
    ];
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log).toHaveLength(events.length);
    const [restLine] = folded.log.filter((line) => /stop resting/i.test(line.text));
    expect(restLine?.text).toMatch(/full-health/);
    const [invalidLine] = folded.log.filter((line) => /cannot be done/i.test(line.text));
    expect(invalidLine?.tone).toBe('system');
    expect(invalidLine?.text).toMatch(/blocked\.wall/);
    const [concludedLine] = folded.log.filter((line) => /run has concluded/i.test(line.text));
    expect(concludedLine?.tone).toBe('system');
  });

  it('caps the log at LOG_CAPACITY dropping oldest first and keeps ids monotonic', () => {
    const waits: readonly PublicEvent[] = Array.from({ length: 250 }, (_unused, index) => ({
      type: 'action.invalid' as const, eventId: `event.${index}`, commandId: `command.${index}`,
      reason: 'action.unavailable' as const,
    }));
    const folded = foldEventsIntoLog([], waits, 1);
    expect(folded.log).toHaveLength(LOG_CAPACITY);
    expect(folded.nextId).toBe(251);
    expect(folded.log[0]?.id).toBe(51);
    expect(folded.log[folded.log.length - 1]?.id).toBe(250);
  });

  it('maps unknown event types to nothing rather than throwing', () => {
    const events = [{ type: 'some.future-event', eventId: 'e' }] as unknown as readonly PublicEvent[];
    expect(() => foldEventsIntoLog([], events, 1)).not.toThrow();
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log).toEqual([]);
    expect(folded.nextId).toBe(1);
  });
});
