import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createPopulationDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  runPopulationDemo,
  populationDemoCommands,
  populationDemoScenario,
  resolvePopulationDemoCommand,
  validatePopulationInvariants,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('population encounter seeded invariants', () => {
  it('holds after every applied command in 128 distinct seeded simulations with shrinking', async () => {
    const finalSaves = new Set<string>();
    const scenarioSeeds = new Set<number>();
    const forbidden = new Set([
      'lastKnownTargets',
      'sharedKnowledge',
      'goal',
      'rng',
      'gateRoll',
      'sourceContentHash',
    ]);
    const assertHiddenSafe = (value: unknown, path = 'public'): void => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => assertHiddenSafe(entry, `${path}.${index}`));
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        expect(forbidden.has(key), `${path}.${key} exposes hidden state`).toBe(false);
        assertHiddenSafe(entry, `${path}.${key}`);
      }
    };
    const execute = (seed: number) => {
      const scenario = populationDemoScenario(seed);
      let state = createPopulationDemoRun(pack, seed);
      let previousTime = state.worldTime;
      let crossedPhases: readonly string[] = [];
      for (const [index, input] of populationDemoCommands(state, scenario).entries()) {
        if ((scenario.reloadMask & (1 << index)) !== 0)
          state = decodeActiveRun(encodeActiveRun(state));
        const resolved = resolvePopulationDemoCommand(state, input, pack);
        expect(resolved.result.status, `seed ${seed} command ${index}`).toBe('applied');
        expect(resolved.state.worldTime).toBeGreaterThanOrEqual(previousTime);
        validatePopulationInvariants(resolved.state, pack);
        assertHiddenSafe(resolved.publicEvents);
        assertHiddenSafe(resolved.projection);
        if (input.boundary === 'before-group-relay') {
          const relays = resolved.authoritativeEvents.filter(
            (event) => event.type === 'group.awareness-shared',
          );
          const group = resolved.state.populations.find(
            (population) => population.model === 'group',
          )!;
          expect(relays.length).toBeGreaterThan(0);
          expect(new Set(relays.map((event) => event.actorId)).size).toBeLessThan(
            group.roleMembership.length,
          );
          expect(relays.every((event) => group.livingMemberIds.includes(event.actorId))).toBe(true);
        }
        if (input.boundary === 'before-leader-death') {
          expect(
            resolved.authoritativeEvents.some((event) => event.type === 'swarm.cap-reached'),
          ).toBe(true);
        }
        const boss = resolved.state.populations.find((population) => population.model === 'boss')!;
        expect(boss.crossedPhaseIds.slice(0, crossedPhases.length)).toEqual(crossedPhases);
        crossedPhases = boss.crossedPhaseIds;
        previousTime = resolved.state.worldTime;
        state = resolved.state;
      }
      return encodeActiveRun(state);
    };
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 0, max: 0xffff_ffff }), {
          minLength: 128,
          maxLength: 128,
        }),
        async (seeds) => {
          // Each simulation is CPU-bound; yield to the event loop after every one so a slow
          // runner never blocks the worker long enough to starve Vitest's RPC heartbeat.
          for (const seed of seeds) {
            scenarioSeeds.add(seed);
            finalSaves.add(execute(seed));
            await new Promise<void>((resolveSeed) => setImmediate(resolveSeed));
          }
        },
      ),
      { seed: 0x4b31_2026, numRuns: 1 },
    );
    expect(scenarioSeeds.size).toBe(128);
    expect(finalSaves.size).toBeGreaterThan(100);
  }, 360_000);

  it('regression: inactive floors do not accumulate missed swarm births', () => {
    const result = runPopulationDemo(pack);
    const swarm = result.state.populations.find((population) => population.model === 'swarm')!;
    expect(swarm.spawnedCount).toBeGreaterThan(0);
    expect(swarm.spawnedCount).toBeLessThanOrEqual(8);
  });

  it('regression: terminal rewards are singletons with no Echo heirloom', () => {
    const result = runPopulationDemo(pack);
    const champion = result.state.populations.find(
      (population) => population.model === 'champion',
    )!;
    const echo = result.state.populations.find((population) => population.model === 'echo')!;
    expect(champion).toMatchObject({ defeated: true, rewardCreated: true });
    expect(echo).toMatchObject({ defeated: true, lootCreated: true });
    expect(result.state.items.filter((item) => item.heirloom !== undefined)).toHaveLength(1);
    expect(
      result.state.items.filter((item) => item.itemId.includes(echo.populationId)),
    ).not.toContainEqual(expect.objectContaining({ heirloom: expect.anything() }));
  });

  it('regression: living population placements cannot jointly sever the mandatory stair route', () => {
    const initial = createPopulationDemoRun(pack);
    const boss = initial.populations.find((population) => population.model === 'boss')!;
    const bossActor = initial.actors.find((actor) => actor.actorId === boss.actorId)!;
    const blockingCell = { x: 5, y: 6 };
    const blocked = {
      ...initial,
      actors: initial.actors.map((actor) =>
        actor.actorId === bossActor.actorId ? { ...actor, ...blockingCell } : actor,
      ),
      floors: initial.floors.map((floor) =>
        floor.floorId === boss.floorId
          ? {
              ...floor,
              entities: floor.entities.map((entity) =>
                entity.entityId === bossActor.actorId ? { ...entity, ...blockingCell } : entity,
              ),
            }
          : floor,
      ),
    };
    expect(() => validatePopulationInvariants(blocked, pack)).toThrow(
      /required route is disconnected/,
    );
  });
});
