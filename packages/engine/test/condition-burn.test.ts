import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, ConditionContentEntry } from '@woven-deep/content';
import {
  advanceConditions,
  createDemoRun,
  stableJson,
  tickConditions,
  type ActorState,
} from '../src/index.js';

let basePack: CompiledContentPack;
let pack: CompiledContentPack;

const burningCondition: ConditionContentEntry = {
  kind: 'condition',
  id: 'condition.burning',
  name: 'Burning',
  tags: [],
  description: 'Taking fire damage each tick.',
  color: '#e05a2b',
  duration: { mode: 'timed', default: 3, maximum: 5 },
  stacking: { mode: 'replace', maximumStacks: 1 },
  modifiersPerStack: {},
  traits: [],
  tickEffects: [
    {
      effectId: 'effect.damage',
      parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } },
      requiresLivingTarget: true,
    },
  ],
};

beforeAll(async () => {
  basePack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  pack = { ...basePack, entries: [...basePack.entries, burningCondition] };
});

function burningActor(id: string, expiresAt: number): ActorState {
  const run = createDemoRun();
  return {
    ...run.actors[0]!,
    actorId: id,
    playerControlled: false,
    health: 10,
    maxHealth: 10,
    conditions: [
      {
        conditionId: 'condition.burning',
        sourceActorId: 'hero.demo',
        appliedAt: 0,
        expiresAt,
        stacks: 1,
      },
    ],
  };
}

const noMitigation = () => ({ armor: 0, resistance: 0, immune: false });

describe('condition burn tick', () => {
  it('deals 1d1 fire tick damage to the bearer each step', () => {
    const run = createDemoRun();
    const actor = burningActor('m.burned', 3);
    const result = tickConditions({
      actors: [actor],
      content: pack,
      effectsState: run.rng.effects,
      worldTime: 1,
      eventId: 'command.tick',
      survival: run.survival,
      survivalActorId: run.hero.actorId,
      mitigationFor: noMitigation,
    });
    const bearer = result.actors.find((candidate) => candidate.actorId === 'm.burned')!;
    expect(bearer.health).toBe(9);
  });

  it('still expires on its timed schedule via advanceConditions after the tick', () => {
    const run = createDemoRun();
    const actor = burningActor('m.timed', 2);
    let actors: readonly ActorState[] = [actor];
    let effectsState = run.rng.effects;
    for (let worldTime = 1; worldTime <= 2; worldTime += 1) {
      const tick = tickConditions({
        actors,
        content: pack,
        effectsState,
        worldTime,
        eventId: 'command.tick',
        survival: run.survival,
        survivalActorId: run.hero.actorId,
        mitigationFor: noMitigation,
      });
      actors = tick.actors;
      effectsState = tick.effectsState;
      const expiry = advanceConditions({ actors, worldTime, eventId: 'command.tick' });
      actors = expiry.actors;
    }
    const bearer = actors.find((candidate) => candidate.actorId === 'm.timed')!;
    expect(bearer.conditions).toEqual([]);
    expect(bearer.health).toBe(8); // two ticks of 1 fire damage before expiry
  });

  it('deals tick damage in a stable, order-independent way (determinism)', () => {
    const run = createDemoRun();
    const a = tickConditions({
      actors: [burningActor('m.a', 3), burningActor('m.b', 3)],
      content: pack,
      effectsState: run.rng.effects,
      worldTime: 1,
      eventId: 'command.tick',
      survival: run.survival,
      survivalActorId: run.hero.actorId,
      mitigationFor: noMitigation,
    });
    const b = tickConditions({
      actors: [burningActor('m.b', 3), burningActor('m.a', 3)],
      content: pack,
      effectsState: run.rng.effects,
      worldTime: 1,
      eventId: 'command.tick',
      survival: run.survival,
      survivalActorId: run.hero.actorId,
      mitigationFor: noMitigation,
    });
    expect(stableJson(a.effectsState)).toBe(stableJson(b.effectsState));
    const ha = Object.fromEntries(a.actors.map((x) => [x.actorId, x.health]));
    const hb = Object.fromEntries(b.actors.map((x) => [x.actorId, x.health]));
    expect(ha).toEqual(hb);
    expect(ha['m.a']).toBeLessThan(10);
    expect(ha['m.b']).toBeLessThan(10);
  });
});
