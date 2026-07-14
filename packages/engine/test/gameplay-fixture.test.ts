import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createGameplayDemoRun,
  heroActor,
  isExplored,
  stableJson,
  tileDefinition,
  tileIndex,
  validateActiveRun,
  validateContentBoundRun,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('seeded gameplay fixture', () => {
  function withBeetlePopulation(): ReturnType<typeof createGameplayDemoRun>['run'] {
    const fixture = createGameplayDemoRun(pack);
    const beetle = fixture.run.actors.find((actor) => actor.actorId === fixture.ids.beetle)!;
    return {
      ...fixture.run,
      actors: fixture.run.actors.map((actor) => actor.actorId === beetle.actorId ? {
        ...actor, populationId: 'population.beetles.1', populationRoleId: 'guard',
      } : actor),
      encounterDecisions: [{
        encounterId: 'encounter.beetle-patrol', baseProbability: 0.65, protectionBonus: 0.08,
        effectiveProbability: 0.73, eligible: true, reachedEligibleDepth: true,
        encountered: false, instancesCreated: 1,
      }],
      populations: [{
        populationId: 'population.beetles.1', encounterId: 'encounter.beetle-patrol',
        floorId: beetle.floorId, createdAt: 0, model: 'group',
        livingMemberIds: [beetle.actorId], formerMemberIds: [], leaderActorId: null,
        bonusActive: false, roleMembership: [{ actorId: beetle.actorId, roleId: 'guard' }],
        sharedKnowledge: [], leaderResponseApplied: false,
      }],
    };
  }

  it('builds the same valid gameplay run twice', () => {
    const first = createGameplayDemoRun(pack);
    const second = createGameplayDemoRun(pack);

    expect(stableJson(first.run)).toBe(stableJson(second.run));
    expect(validateActiveRun(first.run)).toEqual(first.run);
    expect(() => validateContentBoundRun(first.run, pack)).not.toThrow();
    expect(first.ids).toMatchObject({
      hero: 'hero.gameplay-demo',
      rat: 'monster.cave-rat.1',
      beetle: 'monster.training-beetle.1',
    });
  });

  it('places a lit hero, monsters, proof items, and hidden dungeon features', () => {
    const fixture = createGameplayDemoRun(pack);
    const { run, ids } = fixture;
    const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
    const hero = heroActor(run);
    const rat = run.actors.find((actor) => actor.actorId === ids.rat)!;
    const beetle = run.actors.find((actor) => actor.actorId === ids.beetle)!;
    const heroIndex = tileIndex(floor, hero.x, hero.y)!;
    const ratIndex = tileIndex(floor, rat.x, rat.y)!;

    expect(floor.vaults.map((vault) => vault.vaultId)).toContain('vault.lampwright-cache');
    expect(tileDefinition(floor.tiles[heroIndex]!).walkable).toBe(true);
    expect(isExplored(floor.knowledge, ratIndex)).toBe(true);
    expect(Math.max(Math.abs(hero.x - rat.x), Math.abs(hero.y - rat.y))).toBeGreaterThanOrEqual(3);
    expect(Math.max(Math.abs(hero.x - beetle.x), Math.abs(hero.y - beetle.y))).toBeGreaterThanOrEqual(6);

    expect(run.items).toHaveLength(13);
    expect(run.items.find((item) => item.itemId === ids.lantern)).toMatchObject({
      contentId: 'item.brass-lantern',
      fuel: 1800,
      enabled: true,
      location: { type: 'equipped', actorId: ids.hero, slot: 'off-hand' },
    });
    expect(hero.equipment).toMatchObject({ 'main-hand': ids.sword, 'off-hand': ids.lantern });

    expect(run.features.find((feature) => feature.featureId === ids.door)).toMatchObject({
      type: 'door',
      state: 'closed',
    });
    expect(run.features.find((feature) => feature.featureId === ids.trap)).toMatchObject({
      type: 'trap',
      contentId: 'trap.rusty-dart',
      state: 'armed',
      discovery: { discoveredByActorIds: [] },
    });
    expect(run.features.find((feature) => feature.featureId === ids.secret)).toMatchObject({
      type: 'secret',
      state: 'hidden',
      discovery: { discoveredByActorIds: [] },
    });
  });

  it('validates encounter probabilities and population role content references', () => {
    const run = withBeetlePopulation();
    expect(validateActiveRun(run)).toEqual(run);
    expect(() => validateContentBoundRun(run, pack)).not.toThrow();

    const badProbability = structuredClone(run);
    (badProbability.encounterDecisions[0] as any).effectiveProbability = 0.74;
    expect(() => validateContentBoundRun(badProbability, pack)).toThrow(/decision.*definition/i);

    const badRole = structuredClone(run);
    (badRole.populations[0] as any).roleMembership[0].roleId = 'missing';
    expect(() => validateContentBoundRun(badRole, pack)).toThrow(/role missing is invalid/i);
  });
});
