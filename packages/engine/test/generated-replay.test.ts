import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  createGeneratedDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  heroPerception,
  projectFloor,
  refreshKnowledge,
  replayCommands as replayCommandsWithContext,
  stableJson,
  tileDefinition,
  type ActiveRun,
  type Direction,
  type GameCommand,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function direction(
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
): Direction {
  if (to.x === from.x + 1 && to.y === from.y) return 'east';
  if (to.x === from.x - 1 && to.y === from.y) return 'west';
  if (to.y === from.y + 1 && to.x === from.x) return 'south';
  if (to.y === from.y - 1 && to.x === from.x) return 'north';
  throw new Error('route points must be adjacent');
}

function commandsFor(run: ActiveRun): readonly GameCommand[] {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
  const route = analyzeConnectivity({
    width: floor.width,
    height: floor.height,
    tiles: floor.tiles,
    start: floor.stairUp!,
    target: floor.stairDown!,
  }).route;
  const walkableRoute = route.slice(0, 5);
  expect(walkableRoute).toHaveLength(5);
  for (const point of walkableRoute) {
    expect(tileDefinition(floor.tiles[point.y * floor.width + point.x]!).walkable).toBe(true);
  }
  const moves = walkableRoute.slice(1).map<GameCommand>((point, index) => ({
    type: 'move',
    commandId: `command.generated-${index + 1}`,
    expectedRevision: index,
    direction: direction(walkableRoute[index]!, point),
  }));
  const wait: GameCommand = {
    type: 'wait',
    commandId: 'command.generated-wait',
    expectedRevision: 4,
  };
  return [
    ...moves,
    wait,
    { ...moves[0]! },
    { type: 'wait', commandId: 'command.generated-stale', expectedRevision: 0 },
  ];
}

function observable(run: ActiveRun): string {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
  const actors = new Map(floor.entities.map((entity) => [entity.entityId, entity] as const));
  const actor = heroActor(run);
  const hero = heroPerception(run.hero, actor);
  actors.set(actor.actorId, actor);
  const perception = refreshKnowledge({ floor, hero, actors });
  return stableJson(projectFloor({ floor, hero, ...perception }));
}

describe('generated save and replay continuity', () => {
  it('builds a browser-safe generated demo run with separate diagnostics', () => {
    const fixture = createGeneratedDemoRun(pack);
    const floor = fixture.run.floors.find(
      (candidate) => candidate.floorId === 'floor.generated-01',
    )!;

    expect(floor.vaults.map((vault) => vault.vaultId)).toContain('vault.lampwright-cache');
    expect(heroActor(fixture.run)).toMatchObject({ floorId: floor.floorId, ...floor.stairUp });
    expect(floor.lights).toContainEqual({
      lightId: 'light.hero-demo',
      location: { type: 'actor', actorId: fixture.run.hero.actorId },
      color: [255, 179, 71],
      radius: 7,
      strength: 180,
      enabled: true,
      falloff: 'linear',
      vaultPlacementId: null,
      presentation: null,
    });
    expect(fixture.generated.floor.lights).not.toContainEqual(
      expect.objectContaining({ lightId: 'light.hero-demo' }),
    );
    expect(fixture.run.rng.generation).toEqual(fixture.allocation.nextGenerationState);
    expect(fixture.run.populations.length).toBeGreaterThan(0);
    expect(floor.lights.map((light) => light.lightId)).toEqual(
      [...floor.lights.map((light) => light.lightId)].sort(),
    );
    expect(fixture.run.floors.map((entry) => entry.floorId)).toEqual(
      [...fixture.run.floors.map((entry) => entry.floorId)].sort(),
    );
  });

  it('preserves exact generated terrain, light, knowledge, projection, and replay across save/reload', () => {
    const fixture = createGeneratedDemoRun(pack);
    const commands = commandsFor(fixture.run);
    const context = { content: pack };
    const continuous = replayCommandsWithContext(fixture.run, commands, context);
    const before = replayCommandsWithContext(fixture.run, commands.slice(0, 4), context);
    const restored = decodeActiveRun(encodeActiveRun(before.state));
    const after = replayCommandsWithContext(restored, commands.slice(4), context);
    const splitSteps = [...before.steps, ...after.steps];

    expect(encodeActiveRun(after.state)).toBe(encodeActiveRun(continuous.state));
    expect(stableJson(splitSteps)).toBe(stableJson(continuous.steps));
    const splitFloor = after.state.floors.find(
      (floor) => floor.floorId === after.state.activeFloorId,
    )!;
    const continuousFloor = continuous.state.floors.find(
      (floor) => floor.floorId === continuous.state.activeFloorId,
    )!;
    expect(stableJson(splitFloor.knowledge)).toBe(stableJson(continuousFloor.knowledge));
    expect(observable(after.state)).toBe(observable(continuous.state));
    expect(continuous.steps.slice(-2).map((step) => step.result.status)).toEqual([
      'applied',
      'rejected',
    ]);
    expect(continuous.steps.at(-1)!.result).toMatchObject({ reason: 'stale_revision' });
  });

  it('never serializes generation diagnostics or topology drafts', () => {
    const fixture = createGeneratedDemoRun(pack);
    const bytes = encodeActiveRun(fixture.run);
    expect(bytes).not.toMatch(/report|rejection|room|corridor/);
    expect(Object.keys(fixture)).toEqual(['run', 'generated', 'allocation']);
  });
});
