import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { Direction, GameCommand } from '../src/index.js';
import {
  createGameplayDemoRun,
  heroActor,
  isExplored,
  resolveCommand,
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
    const fallenGuard = {
      ...beetle,
      actorId: 'monster.training-beetle.former',
      health: 0,
      populationId: 'population.beetles.1',
      populationRoleId: 'guard',
    };
    return {
      ...fixture.run,
      actors: [
        ...fixture.run.actors.map((actor) =>
          actor.actorId === beetle.actorId
            ? {
                ...actor,
                populationId: 'population.beetles.1',
                populationRoleId: 'guard',
              }
            : actor,
        ),
        fallenGuard,
      ].sort((left, right) => left.actorId.localeCompare(right.actorId)),
      encounterDecisions: fixture.run.encounterDecisions.map((decision) =>
        decision.encounterId === 'encounter.beetle-patrol'
          ? {
              ...decision,
              eligible: true,
              reachedEligibleDepth: true,
              instancesCreated: decision.instancesCreated + 1,
            }
          : decision,
      ),
      populations: [
        ...fixture.run.populations,
        {
          populationId: 'population.beetles.1',
          encounterId: 'encounter.beetle-patrol',
          floorId: beetle.floorId,
          createdAt: 0,
          model: 'group',
          livingMemberIds: [beetle.actorId],
          formerMemberIds: [fallenGuard.actorId],
          leaderActorId: null,
          bonusActive: false,
          roleMembership: [
            { actorId: beetle.actorId, roleId: 'guard' },
            { actorId: fallenGuard.actorId, roleId: 'guard' },
          ],
          sharedKnowledge: [],
          leaderResponseApplied: false,
          leaderResponseExpiresAt: null,
        },
      ].sort((left, right) => (left.populationId < right.populationId ? -1 : 1)),
    };
  }

  it('builds the same valid gameplay run twice', () => {
    const first = createGameplayDemoRun(pack);
    const second = createGameplayDemoRun(pack);

    expect(stableJson(first.run)).toBe(stableJson(second.run));
    expect(validateActiveRun(first.run)).toEqual(first.run);
    expect(() => validateContentBoundRun(first.run, pack)).not.toThrow();
    expect(first.run.populations.length).toBeGreaterThan(0);
    expect(first.run.metrics.floorsEntered).toBe(1);
    expect(first.run.metrics.deepestDepth).toBe(
      first.run.floors.find((floor) => floor.floorId === first.run.activeFloorId)!.depth,
    );
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
    expect(
      Math.max(Math.abs(hero.x - beetle.x), Math.abs(hero.y - beetle.y)),
    ).toBeGreaterThanOrEqual(6);

    // 13 base demo items, the lockpick and iron key the hero carries to exercise the lock
    // mechanic, plus one item created from `vault.lampwright-cache`'s filled item slot
    // (`item-cache`, `loot-table.travelling-lampwright-stock`).
    expect(run.items).toHaveLength(16);
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
    expect(run.features.find((feature) => feature.featureId === ids.chest)).toMatchObject({
      type: 'chest',
      state: 'locked',
      lock: { difficulty: 12, keyContentId: null },
      lootTableId: 'loot-table.early-provisions',
      lootContentId: null,
    });
    expect(run.features.find((feature) => feature.featureId === ids.lockedDoor)).toMatchObject({
      type: 'door',
      state: 'locked',
      lock: { difficulty: 15, keyContentId: 'item.iron-key' },
    });
    expect(run.items.find((item) => item.itemId === ids.lockpick)).toMatchObject({
      contentId: 'item.lockpick',
      quantity: 3,
    });
    expect(run.items.find((item) => item.itemId === ids.key)).toMatchObject({
      contentId: 'item.iron-key',
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
    const group = badRole.populations.find(
      (population) => population.populationId === 'population.beetles.1',
    )!;
    (group as any).roleMembership[0].roleId = 'missing';
    expect(() => validateContentBoundRun(badRole, pack)).toThrow(/role missing is invalid/i);
  });

  it('drops findable loot on the floor when a wired early monster is defeated', () => {
    const fixture = createGameplayDemoRun(pack);
    const { ids } = fixture;
    const commandFactories: readonly ((
      state: ReturnType<typeof createGameplayDemoRun>['run'],
    ) => GameCommand)[] = [
      () => ({ type: 'open-door', featureId: ids.door }) as GameCommand,
      (state) => {
        const hero = state.actors.find((actor) => actor.actorId === ids.hero)!;
        const door = state.features.find((feature) => feature.featureId === ids.door)!;
        return { type: 'move', direction: directionTo(hero, door) } as GameCommand;
      },
      () => ({ type: 'search' }) as GameCommand,
      () => ({ type: 'disarm', featureId: ids.trap }) as GameCommand,
      () => ({ type: 'equip', itemId: ids.armor, slot: 'body' }) as GameCommand,
      () => ({ type: 'attack', targetActorId: ids.rat }) as GameCommand,
    ];

    let state = fixture.run;
    for (const [index, factory] of commandFactories.entries()) {
      const command = {
        ...factory(state),
        commandId: `command.loot-fixture-${index + 1}`,
        expectedRevision: state.revision,
      } as GameCommand;
      const resolution = resolveCommand(state, command, { content: pack });
      expect(resolution.result.status, stableJson(resolution.events)).toBe('applied');
      state = resolution.state;
    }

    const rat = state.actors.find((actor) => actor.actorId === ids.rat)!;
    expect(rat.health).toBe(0);
    const floorItemsAtDeathTile = state.items.filter(
      (item) =>
        item.location.type === 'floor' && item.location.x === rat.x && item.location.y === rat.y,
    );
    expect(floorItemsAtDeathTile.length).toBeGreaterThanOrEqual(1);
  });
});

function directionTo(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
): Direction {
  const directions: Record<string, Direction> = {
    '0:-1': 'north',
    '1:-1': 'northeast',
    '1:0': 'east',
    '1:1': 'southeast',
    '0:1': 'south',
    '-1:1': 'southwest',
    '-1:0': 'west',
    '-1:-1': 'northwest',
  };
  const direction = directions[`${Math.sign(to.x - from.x)}:${Math.sign(to.y - from.y)}`];
  if (direction === undefined) throw new Error('target is not adjacent to the hero');
  return direction;
}
