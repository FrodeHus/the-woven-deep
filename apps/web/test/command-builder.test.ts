import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState } from '@woven-deep/engine';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { buildIntent } from '../src/session/command-builder.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function heroPosition(projection: GameplayProjection): { x: number; y: number } {
  const hero = projection.hero as unknown as { x: number; y: number };
  return { x: hero.x, y: hero.y };
}

function withActorEast(projection: GameplayProjection, disposition: 'hostile' | 'neutral' | 'friendly'): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    actors: [
      ...projection.actors,
      { actorId: 'actor.target', x: x + 1, y, disposition, health: 10, maxHealth: 10 },
    ],
  };
}

function withClosedDoorEast(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    features: [
      ...projection.features,
      { featureId: 'feature.door-1', type: 'door', state: 'closed', x: x + 1, y },
    ],
  };
}

function withGroundItemUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    groundItems: [
      ...projection.groundItems,
      { itemId: 'item.on-floor', contentId: 'item.iron-sword', name: 'Iron sword', quantity: 1, x, y },
    ],
  };
}

function withStairDownUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    floor: {
      ...projection.floor,
      cells: projection.floor.cells.map((cell) => (cell.x === x && cell.y === y ? { ...cell, tileId: 5 as const } : cell)),
    },
  };
}

describe('buildIntent', () => {
  it('builds a move command for an empty walkable target', () => {
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection: baseProjection,
      commandId: 'command.guest-000001',
      expectedRevision: 0,
    });
    expect(built).toEqual({
      kind: 'command',
      command: { type: 'move', direction: 'east', commandId: 'command.guest-000001', expectedRevision: 0 },
    });
  });

  it('builds an attack when a hostile actor occupies the target cell', () => {
    const projection = withActorEast(baseProjection, 'hostile');
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.guest-000002',
      expectedRevision: 1,
    });
    expect(built).toEqual({
      kind: 'command',
      command: { type: 'attack', targetActorId: 'actor.target', commandId: 'command.guest-000002', expectedRevision: 1 },
    });
  });

  it('builds open-door when a visible closed door occupies the target cell', () => {
    const projection = withClosedDoorEast(baseProjection);
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.guest-000003',
      expectedRevision: 2,
    });
    expect(built).toEqual({
      kind: 'command',
      command: { type: 'open-door', featureId: 'feature.door-1', commandId: 'command.guest-000003', expectedRevision: 2 },
    });
  });

  it('builds pickup for the top ground item under the hero with its full quantity', () => {
    const projection = withGroundItemUnderHero(baseProjection);
    const built = buildIntent({
      intent: { type: 'pickup' },
      projection,
      commandId: 'command.guest-000004',
      expectedRevision: 3,
    });
    expect(built).toEqual({
      kind: 'command',
      command: { type: 'pickup', itemId: 'item.on-floor', quantity: 1, commandId: 'command.guest-000004', expectedRevision: 3 },
    });
  });

  it('rejects pickup with a message when nothing lies under the hero', () => {
    const built = buildIntent({
      intent: { type: 'pickup' },
      projection: baseProjection,
      commandId: 'command.guest-000005',
      expectedRevision: 4,
    });
    expect(built.kind).toBe('rejected');
    expect((built as { message: string }).message).toMatch(/nothing here/i);
  });

  it('builds rest until healed with the survival cap', () => {
    const built = buildIntent({
      intent: { type: 'rest' },
      projection: baseProjection,
      commandId: 'command.guest-000006',
      expectedRevision: 5,
    });
    expect(built).toEqual({
      kind: 'command',
      command: { type: 'rest', until: 'healed', maximumDuration: 500, commandId: 'command.guest-000006', expectedRevision: 5 },
    });
  });

  it('returns descend marker only when the hero stands on the stair-down cell, else rejects', () => {
    const onStairs = withStairDownUnderHero(baseProjection);
    const built = buildIntent({
      intent: { type: 'descend' },
      projection: onStairs,
      commandId: 'command.guest-000007',
      expectedRevision: 6,
    });
    expect(built).toEqual({ kind: 'descend' });

    const notOnStairs = buildIntent({
      intent: { type: 'descend' },
      projection: baseProjection,
      commandId: 'command.guest-000008',
      expectedRevision: 6,
    });
    expect(notOnStairs.kind).toBe('rejected');
  });

  it('builds equip with the definition slot, use-item with null target, drop quantity 1, toggle-light flipping enabled', () => {
    const backpack = baseProjection.hero as unknown as { backpack: readonly Readonly<Record<string, unknown>>[] };
    const ration = backpack.backpack.find((item) => item.contentId === 'item.travel-ration')!;

    const use = buildIntent({
      intent: { type: 'backpack', action: 'use', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000009',
      expectedRevision: 7,
    });
    expect(use).toEqual({
      kind: 'command',
      command: { type: 'use-item', itemId: ration.itemId, target: null, commandId: 'command.guest-000009', expectedRevision: 7 },
    });

    const drop = buildIntent({
      intent: { type: 'backpack', action: 'drop', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000010',
      expectedRevision: 8,
    });
    expect(drop).toEqual({
      kind: 'command',
      command: { type: 'drop', itemId: ration.itemId, quantity: 1, commandId: 'command.guest-000010', expectedRevision: 8 },
    });

    const equippedTorch = baseProjection.hero as unknown as { equipment: Readonly<Record<string, Readonly<Record<string, unknown>> | null>> };
    const torch = equippedTorch.equipment['off-hand']!;
    const toggle = buildIntent({
      intent: { type: 'backpack', action: 'toggle-light', itemId: torch.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000011',
      expectedRevision: 9,
      pack,
    });
    expect(toggle).toEqual({
      kind: 'command',
      command: {
        type: 'toggle-light', itemId: torch.itemId, enabled: false,
        commandId: 'command.guest-000011', expectedRevision: 9,
      },
    });

    const bow = { itemId: 'item.on-floor-bow', contentId: 'item.hunting-bow', name: 'Hunting bow', quantity: 1, identified: true };
    const projectionWithBow: GameplayProjection = {
      ...baseProjection,
      hero: { ...baseProjection.hero, backpack: [...backpack.backpack, bow] },
    };
    const equip = buildIntent({
      intent: { type: 'backpack', action: 'equip', itemId: bow.itemId },
      projection: projectionWithBow,
      commandId: 'command.guest-000012',
      expectedRevision: 10,
      pack,
    });
    expect(equip).toEqual({
      kind: 'command',
      command: { type: 'equip', itemId: bow.itemId, slot: 'main-hand', commandId: 'command.guest-000012', expectedRevision: 10 },
    });
  });

  it('rejects equip of a non-equipment item with the item name in the message', () => {
    const backpack = baseProjection.hero as unknown as { backpack: readonly Readonly<Record<string, unknown>>[] };
    const ration = backpack.backpack.find((item) => item.contentId === 'item.travel-ration')!;
    const built = buildIntent({
      intent: { type: 'backpack', action: 'equip', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000013',
      expectedRevision: 11,
      pack,
    });
    expect(built.kind).toBe('rejected');
    expect((built as { message: string }).message).toMatch(/travel ration/i);
  });
});
