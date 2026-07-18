import { describe, expect, it } from 'vitest';
import {
  createDemoContentPack, createDemoRun, resolveRest, restStopReason,
  resolveCommand,
  type RestObservation,
} from '../src/index.js';

function observation(overrides: Partial<RestObservation> = {}): RestObservation {
  return {
    fullHealth: false,
    maximumDurationReached: false,
    visibleDanger: false,
    awareHostile: false,
    damaged: false,
    forcedMovement: false,
    meaningfulSound: false,
    hungerWarning: false,
    fuelWarning: false,
    interruptingConditionChanged: false,
    decisionRequired: false,
    heroDead: false,
    ...overrides,
  };
}

describe('interruptible rest', () => {
  it.each([
    ['full-health', { fullHealth: true }],
    ['maximum-duration', { maximumDurationReached: true }],
    ['visible-danger', { visibleDanger: true }],
    ['aware-hostile', { awareHostile: true }],
    ['damage', { damaged: true }],
    ['damage', { forcedMovement: true }],
    ['meaningful-sound', { meaningfulSound: true }],
    ['hunger-warning', { hungerWarning: true }],
    ['fuel-warning', { fuelWarning: true }],
    ['condition-change', { interruptingConditionChanged: true }],
    ['decision-required', { decisionRequired: true }],
    ['hero-death', { heroDead: true }],
  ] as const)('stops for %s', (reason, changes) => {
    expect(restStopReason(observation(changes))).toBe(reason);
  });

  it('uses the documented stop priority when several interruptions happen together', () => {
    expect(restStopReason(observation({ visibleDanger: true, damaged: true, heroDead: true })))
      .toBe('visible-danger');
  });

  it('stops immediately when healing is requested at full health', () => {
    const state = createDemoRun();
    const result = resolveRest({
      state, content: createDemoContentPack(), eventId: 'command.rest',
      until: 'healed', maximumDuration: 500,
    });
    expect(result.stopReason).toBe('full-health');
    expect(result.elapsed).toBe(0);
    expect(result.state).toBe(state);
  });

  it('uses ordinary world steps and stops at the requested duration', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, health: 10 };
    const result = resolveRest({
      state: { ...base, actors: [hero] }, content: createDemoContentPack(), eventId: 'command.rest',
      until: 'interrupted', maximumDuration: 3,
    });
    expect(result.stopReason).toBe('maximum-duration');
    expect(result.elapsed).toBe(3);
    expect(result.events.filter((event) => event.type === 'hero.waited')).toHaveLength(3);
  });

  it('stops before waiting when a hostile creature is visible', () => {
    const base = createDemoRun();
    const enemy = { ...base.actors[0]!, actorId: 'monster.visible', contentId: 'monster.visible',
      playerControlled: false, disposition: 'hostile' as const, x: 2, y: 1 };
    const result = resolveRest({ state: { ...base, actors: [base.actors[0]!, enemy] },
      content: createDemoContentPack(), eventId: 'command.rest', until: 'interrupted', maximumDuration: 10 });
    expect(result.stopReason).toBe('visible-danger');
    expect(result.elapsed).toBe(0);
  });

  it('stops for an aware hostile even when darkness hides it', () => {
    const base = createDemoRun();
    const enemy = { ...base.actors[0]!, actorId: 'monster.aware', contentId: 'monster.aware',
      playerControlled: false, disposition: 'hostile' as const, x: 3, y: 1,
      awareActorIds: [base.hero.actorId] };
    const floor = { ...base.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 } };
    const result = resolveRest({ state: { ...base, floors: [floor], actors: [base.actors[0]!, enemy] },
      content: createDemoContentPack(), eventId: 'command.rest', until: 'interrupted', maximumDuration: 10 });
    expect(result.stopReason).toBe('aware-hostile');
  });

  it('recovers only through survival intervals and reports effective healing', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, health: base.actors[0]!.maxHealth - 1 };
    const result = resolveRest({ state: { ...base, actors: [hero] }, content: createDemoContentPack(),
      eventId: 'command.rest', until: 'healed', maximumDuration: 600 });
    expect(result.stopReason).toBe('full-health');
    expect(result.elapsed).toBe(500);
    expect(result.effectiveHealing).toBe(1);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'actor.healed', amount: 1 }));
  });

  it('reaches full health within the duration cap once recoveryAmount matches the fixed content value', () => {
    const base = createDemoRun();
    const demoContent = createDemoContentPack();
    const content = { ...demoContent, entries: demoContent.entries.map((entry) =>
      entry.kind === 'balance' ? { ...entry, recoveryAmount: 10 } : entry) };
    const hero = { ...base.actors[0]!, health: Math.floor(base.actors[0]!.maxHealth / 2) };
    const result = resolveRest({ state: { ...base, actors: [hero] }, content,
      eventId: 'command.rest', until: 'healed', maximumDuration: 5000 });
    expect(result.stopReason).toBe('full-health');
    expect(result.elapsed).toBeLessThan(5000);
    expect(result.effectiveHealing).toBe(base.actors[0]!.maxHealth - hero.health);
  });

  it('rejects non-positive and server-capped command durations', () => {
    const state = createDemoRun();
    const context = { content: createDemoContentPack() };
    for (const maximumDuration of [0, 5001]) {
      const result = resolveCommand(state, { type: 'rest', commandId: `command.rest.${maximumDuration}`,
        expectedRevision: 0, until: 'interrupted', maximumDuration }, context);
      expect(result.result).toMatchObject({ status: 'invalid', reason: 'action.unavailable' });
    }
  });

  it('never crosses the duration bound when a complete wait would take longer', () => {
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, health: 10, speed: 25 };
    const result = resolveRest({ state: { ...base, actors: [hero] }, content: createDemoContentPack(),
      eventId: 'command.rest', until: 'interrupted', maximumDuration: 3 });
    expect(result.stopReason).toBe('maximum-duration');
    expect(result.elapsed).toBeLessThanOrEqual(3);
    expect(result.events.some((event) => event.type === 'hero.waited')).toBe(false);
  });

  it('enforces the loaded duration cap when called directly', () => {
    expect(() => resolveRest({ state: createDemoRun(), content: createDemoContentPack(),
      eventId: 'command.rest', until: 'interrupted', maximumDuration: 5001 })).toThrow(/balance limit/i);
  });

  it('does not treat an ordinary condition as an interruption trait', () => {
    const content = createDemoContentPack();
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, health: 10, conditions: [{
      conditionId: 'condition.disengaged', sourceActorId: null, appliedAt: 0, expiresAt: 100, stacks: 1,
    }] };
    const result = resolveRest({ state: { ...base, actors: [hero] }, content,
      eventId: 'command.rest', until: 'interrupted', maximumDuration: 1 });
    expect(result.stopReason).toBe('maximum-duration');
  });

  it('detects a differently named condition through interrupts-rest alone', () => {
    const content = createDemoContentPack();
    const base = createDemoRun();
    const hero = { ...base.actors[0]!, health: 10, conditions: [{
      conditionId: 'condition.restless', sourceActorId: null, appliedAt: 0, expiresAt: 100, stacks: 1,
    }] };
    const result = resolveRest({ state: { ...base, actors: [hero] }, content,
      eventId: 'command.rest', until: 'interrupted', maximumDuration: 10 });
    expect(result.stopReason).toBe('condition-change');
    expect(result.elapsed).toBe(0);
  });
});
