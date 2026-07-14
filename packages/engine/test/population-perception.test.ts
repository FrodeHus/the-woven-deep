import { describe, expect, it } from 'vitest';
import {
  emptyActorBehaviorState, mergeLastKnownTargets, soundTargetObservation,
  updateActorMemory, visibleTargetObservations,
} from '../src/index.js';

describe('population perception and saved memory', () => {
  it('records only directly visible, illuminated targets', () => {
    const observations = visibleTargetObservations({
      observerActorId: 'monster.watcher', floorId: 'floor.one', width: 3,
      visibilityWords: [0b111], illuminationIntensity: [1, 0, 1], observedAt: 10,
      actors: [
        { actorId: 'hero.visible', x: 2, y: 0 },
        { actorId: 'monster.dark', x: 1, y: 0 },
        { actorId: 'monster.watcher', x: 0, y: 0 },
      ],
    });
    expect(observations).toEqual([{
      targetActorId: 'hero.visible', floorId: 'floor.one', x: 2, y: 0, observedAt: 10,
      source: 'sight', observerActorId: 'monster.watcher',
    }]);
  });

  it('records perceivable sound and investigates its last known cell', () => {
    const observation = soundTargetObservation({
      observerActorId: 'monster.listener', targetActorId: 'hero.one', floorId: 'floor.one',
      x: 4, y: 2, observedAt: 20,
    });
    const state = updateActorMemory({ state: emptyActorBehaviorState(), observations: [observation], investigationDuration: 100 });
    expect(state.lastKnownTargets).toEqual([observation]);
    expect(state.investigation).toEqual({ floorId: 'floor.one', x: 4, y: 2, startedAt: 20, expiresAt: 120 });
  });

  it('keeps newest observations and resolves equal-time conflicts by observer ID', () => {
    const base = { targetActorId: 'hero.one', floorId: 'floor.one', source: 'group' as const };
    const memories = mergeLastKnownTargets([], [
      { ...base, x: 3, y: 3, observedAt: 10, observerActorId: 'monster.z' },
      { ...base, x: 2, y: 2, observedAt: 11, observerActorId: 'monster.z' },
      { ...base, x: 1, y: 1, observedAt: 11, observerActorId: 'monster.a' },
    ]);
    expect(memories).toEqual([{ ...base, x: 1, y: 1, observedAt: 11, observerActorId: 'monster.a' }]);
  });

  it('does not track a target that later moves unseen', () => {
    const seen = soundTargetObservation({ observerActorId: 'monster.one', targetActorId: 'hero.one',
      floorId: 'floor.one', x: 2, y: 2, observedAt: 5 });
    const first = updateActorMemory({ state: emptyActorBehaviorState(), observations: [seen], investigationDuration: null });
    const later = updateActorMemory({ state: first, observations: [], investigationDuration: null });
    expect(later).toEqual(first);
    expect(later.lastKnownTargets[0]).toMatchObject({ x: 2, y: 2, observedAt: 5 });
  });
});
