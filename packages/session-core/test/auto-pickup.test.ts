import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { GameplayProjection } from '@woven-deep/engine';
import { itemEntries } from '../src/pack-queries.js';
import { createAutoPickupPolicy, groundItemUnderHero } from '../src/auto-pickup.js';
import type { GroundItemView } from '../src/projection-view.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function item(overrides: Partial<GroundItemView>): GroundItemView {
  return {
    itemId: 'item.instance.1',
    name: 'Something',
    category: 'misc',
    quantity: 1,
    identified: true,
    x: 5,
    y: 5,
    ...overrides,
  } as GroundItemView;
}

function projectionWith(input: {
  backpack: number;
  capacity: number;
  groundItems?: readonly GroundItemView[];
}): GameplayProjection {
  return {
    hero: {
      x: 5,
      y: 5,
      backpack: Array.from({ length: input.backpack }, (_, index) => ({
        itemId: `item.owned.${index}`,
      })),
      backpackCapacity: input.capacity,
    },
    groundItems: input.groundItems ?? [],
  } as unknown as GameplayProjection;
}

describe('createAutoPickupPolicy', () => {
  it('always takes currency, even with consumables off and a full backpack', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: false });
    const projection = projectionWith({ backpack: 10, capacity: 10 });
    expect(policy(projection, item({ category: 'currency' }))).toBe(true);
  });

  it('takes the five consumable categories when the setting is on and the backpack has room', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 3, capacity: 10 });
    for (const category of ['food', 'potion', 'scroll', 'ammunition', 'fuel']) {
      expect(policy(projection, item({ category: category as GroundItemView['category'] }))).toBe(
        true,
      );
    }
  });

  it('declines consumables when the setting is off, and when the backpack is full', () => {
    const off = createAutoPickupPolicy({ pack, allowConsumables: false });
    const on = createAutoPickupPolicy({ pack, allowConsumables: true });
    expect(off(projectionWith({ backpack: 0, capacity: 10 }), item({ category: 'potion' }))).toBe(
      false,
    );
    expect(on(projectionWith({ backpack: 10, capacity: 10 }), item({ category: 'potion' }))).toBe(
      false,
    );
  });

  it('never takes equipment or misc, whatever the setting says', () => {
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 0, capacity: 10 });
    for (const category of ['weapon', 'armor', 'shield', 'light', 'ring', 'misc']) {
      expect(policy(projection, item({ category: category as GroundItemView['category'] }))).toBe(
        false,
      );
    }
  });

  it('never takes an artifact, whatever its category', () => {
    const artifact = itemEntries(pack).find((entry) => entry.artifact !== null);
    expect(artifact).toBeDefined();
    const policy = createAutoPickupPolicy({ pack, allowConsumables: true });
    const projection = projectionWith({ backpack: 0, capacity: 10 });
    expect(
      policy(
        projection,
        item({
          category: 'currency',
          contentId: artifact!.id as NonNullable<GroundItemView['contentId']>,
        }),
      ),
    ).toBe(false);
  });
});

describe('groundItemUnderHero', () => {
  it('finds the item on the hero cell and nothing otherwise', () => {
    const here = item({ itemId: 'item.here', x: 5, y: 5 });
    const there = item({ itemId: 'item.there', x: 6, y: 5 });
    expect(
      groundItemUnderHero(
        projectionWith({ backpack: 0, capacity: 10, groundItems: [there, here] }),
      ),
    ).toEqual(here);
    expect(
      groundItemUnderHero(projectionWith({ backpack: 0, capacity: 10, groundItems: [there] })),
    ).toBeUndefined();
  });
});
