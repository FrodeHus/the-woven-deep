import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import { beforeAll } from 'vitest';
import { createDemoRun, resolveEffectSweep, stableJson, type ActorState } from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function threeTargets(): { caster: ActorState; targets: ActorState[] } {
  const run = createDemoRun();
  const caster = { ...run.actors[0]!, actorId: 'hero', contentId: 'monster.cave-rat', x: 1, y: 1 };
  const mk = (id: string, x: number): ActorState => ({
    ...caster,
    actorId: id,
    contentId: 'monster.cave-rat',
    playerControlled: false,
    x,
    y: 1,
    health: 20,
    maxHealth: 20,
    disposition: 'hostile',
  });
  return { caster, targets: [mk('rat.c', 4), mk('rat.a', 2), mk('rat.b', 3)] };
}

const damage = [
  {
    effectId: 'effect.damage' as const,
    parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 0 } },
    requiresLivingTarget: true,
  },
];

function sweep(order: ActorState[]) {
  const { caster } = threeTargets();
  const run = createDemoRun();
  return resolveEffectSweep({
    effects: damage,
    actors: [caster, ...order],
    content: pack,
    sourceActorId: caster.actorId,
    casterActorId: caster.actorId,
    includeCaster: false,
    targetActorIds: order.map((a) => a.actorId),
    effectsState: run.rng.effects,
    worldTime: 0,
    eventId: 'command.sweep',
    forceMoveDirection: { x: 1, y: 0 },
    operations: {},
    survival: run.survival,
    survivalActorId: caster.actorId,
  });
}

describe('resolveEffectSweep', () => {
  it('is identical regardless of actor-array ordering and threads RNG forward', () => {
    const { targets } = threeTargets();
    const a = sweep([targets[0]!, targets[1]!, targets[2]!]);
    const b = sweep([targets[2]!, targets[0]!, targets[1]!]);
    expect(stableJson(a.effectsState)).toBe(stableJson(b.effectsState));
    const healthByA = Object.fromEntries(a.actors.map((x) => [x.actorId, x.health]));
    const healthByB = Object.fromEntries(b.actors.map((x) => [x.actorId, x.health]));
    expect(healthByA).toEqual(healthByB);
  });

  it('excludes the caster by default', () => {
    const { caster, targets } = threeTargets();
    const run = createDemoRun();
    const result = resolveEffectSweep({
      effects: damage,
      actors: [caster, ...targets],
      content: pack,
      sourceActorId: caster.actorId,
      casterActorId: caster.actorId,
      includeCaster: false,
      targetActorIds: [caster.actorId, ...targets.map((t) => t.actorId)],
      effectsState: run.rng.effects,
      worldTime: 0,
      eventId: 'command.sweep',
      forceMoveDirection: { x: 1, y: 0 },
      operations: {},
      survival: run.survival,
      survivalActorId: caster.actorId,
    });
    const casterAfter = result.actors.find((x) => x.actorId === caster.actorId)!;
    expect(casterAfter.health).toBe(caster.health);
  });
});
