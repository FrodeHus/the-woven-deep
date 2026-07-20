import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  pickLock,
  validatePlayerAction,
  rollDie,
  type ActiveRun,
  type ChestFeature,
  type DoorFeature,
  type ItemInstance,
} from '../src/index.js';

function itemDefinition(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: '(',
    color: '#c0c0c0',
    tags: [],
    category: 'misc',
    stackLimit: 5,
    price: 3,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const LOCKPICK = itemDefinition('item.lockpick', { tags: ['tool', 'lockpick'] });
const KEY = itemDefinition('item.brass-key');
const TREASURE = itemDefinition('item.treasure', { glyph: '*', color: '#ffd700' });

function content(): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, LOCKPICK, KEY, TREASURE] };
}

function lockpickItem(quantity = 3): ItemInstance {
  return {
    itemId: 'item.lockpick.1',
    contentId: 'item.lockpick',
    quantity,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
  };
}

function keyItem(): ItemInstance {
  return {
    itemId: 'item.brass-key.1',
    contentId: 'item.brass-key',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
  };
}

// A locked door replaces the interior wall pillar at (3,2); its coverTileId matches that wall
// tile so the run survives the save-schema's door/terrain agreement check.
function lockedDoor(keyContentId: string | null = null): DoorFeature {
  return {
    featureId: 'door.locked',
    type: 'door',
    floorId: 'floor.demo',
    x: 3,
    y: 2,
    contentId: null,
    coverTileId: 0,
    state: 'locked',
    lock: { difficulty: 12, keyContentId },
  };
}

// A locked chest sits on the walkable floor cell (2,2); once looted the cell stays walkable so
// its dropped loot passes the walkability cross-validation.
function lockedChest(
  overrides: Partial<Pick<ChestFeature, 'lootTableId' | 'lootContentId'>> = {},
  difficulty = 12,
): ChestFeature {
  return {
    featureId: 'chest.locked',
    type: 'chest',
    floorId: 'floor.demo',
    x: 2,
    y: 2,
    contentId: null,
    coverTileId: 1,
    state: 'locked',
    lock: { difficulty, keyContentId: null },
    lootTableId: null,
    lootContentId: 'item.treasure',
    ...overrides,
  };
}

function heroAt(base: ActiveRun, x: number, y: number) {
  return { ...base.actors[0]!, x, y };
}

// Finds the effects RNG state that yields `target` on its next d20 roll, iterating forward from
// the demo run's initial stream. The demo seed's first roll is not a 1, so a crafted state is the
// only way to exercise the natural-1 branch deterministically.
function effectsStateForRoll(target: number) {
  let state = createDemoRun().rng.effects;
  for (let i = 0; i < 100_000; i += 1) {
    const step = rollDie(state, 20);
    if (step.value === target) return state;
    state = step.state;
  }
  throw new Error(`no effects state produced a roll of ${target}`);
}

// Encode validates the full save schema (throwing on a lingering lock or live loot pointer), and
// re-encoding the decoded run must reproduce the canonical bytes, proving the round-trip is stable.
function roundTrips(run: ActiveRun): boolean {
  const encoded = encodeActiveRun(run);
  return encodeActiveRun(decodeActiveRun(encoded)) === encoded;
}

describe('pickLock', () => {
  it('unlocks a chest, materialises its loot at the cell, and round-trips', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const chest = lockedChest({}, 2);
    const run: ActiveRun = { ...base, actors: [hero], features: [chest], items: [lockpickItem()] };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: chest.featureId,
      eventId: 'event.pick',
    });
    const feature = result.run.features[0] as ChestFeature;
    expect(feature.state).toBe('looted');
    expect(feature.lock).toBeNull();
    expect(feature.lootContentId).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(['lock.picked', 'loot.dropped']);
    const loot = result.run.items.find((item) => item.contentId === 'item.treasure');
    expect(loot?.location).toEqual({ type: 'floor', floorId: 'floor.demo', x: 2, y: 2 });
    // The lockpick is untouched on success.
    expect(result.run.items.find((item) => item.contentId === 'item.lockpick')?.quantity).toBe(3);
    expect(roundTrips(result.run)).toBe(true);
  });

  it('consumes one lockpick on an ordinary chest failure and leaves it retryable', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const chest = lockedChest({}, 999);
    const run: ActiveRun = { ...base, actors: [hero], features: [chest], items: [lockpickItem()] };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: chest.featureId,
      eventId: 'event.pick',
    });
    const feature = result.run.features[0] as ChestFeature;
    expect(feature.state).toBe('locked');
    expect(feature.lock).not.toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(['item.consumed', 'lock.pick-failed']);
    expect(result.run.items.find((item) => item.contentId === 'item.lockpick')?.quantity).toBe(2);
    expect(roundTrips(result.run)).toBe(true);
  });

  it('permanently jams a chest on a natural 1, discards loot, and cannot be reopened', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const chest = lockedChest({}, 2);
    const run: ActiveRun = {
      ...base,
      actors: [hero],
      features: [chest],
      items: [lockpickItem()],
      rng: { ...base.rng, effects: effectsStateForRoll(1) },
    };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: chest.featureId,
      eventId: 'event.pick',
    });
    const feature = result.run.features[0] as ChestFeature;
    expect(feature.state).toBe('jammed');
    expect(feature.lock).toBeNull();
    expect(feature.lootContentId).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(['chest.jammed']);
    // Loot is discarded, and the pick is not spent on a critical failure.
    expect(result.run.items.some((item) => item.contentId === 'item.treasure')).toBe(false);
    expect(result.run.items.find((item) => item.contentId === 'item.lockpick')?.quantity).toBe(3);
    expect(roundTrips(result.run)).toBe(true);
    // A jammed chest is no longer locked, so a second attempt throws the unavailable invariant.
    expect(() =>
      pickLock({
        run: result.run,
        content: content(),
        actorId: hero.actorId,
        featureId: chest.featureId,
        eventId: 'event.pick.again',
      }),
    ).toThrow();
  });

  it('picks a locked door to closed, clears its lock, and round-trips', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 2);
    const door = lockedDoor();
    const run: ActiveRun = { ...base, actors: [hero], features: [door], items: [lockpickItem()] };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: door.featureId,
      eventId: 'event.pick',
    });
    const feature = result.run.features[0] as DoorFeature;
    expect(feature.state).toBe('closed');
    expect(feature.lock).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual(['lock.picked']);
    expect(roundTrips(result.run)).toBe(true);
  });

  it('unlocks a door with its key without a roll or a consumed pick', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 2);
    const door = lockedDoor('item.brass-key');
    const run: ActiveRun = {
      ...base,
      actors: [hero],
      features: [door],
      items: [keyItem()],
    };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: door.featureId,
      eventId: 'event.unlock',
    });
    const feature = result.run.features[0] as DoorFeature;
    expect(feature.state).toBe('closed');
    expect(feature.lock).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual(['door.unlocked']);
    // The effects stream is untouched: the key path never rolls.
    expect(result.run.rng.effects).toEqual(base.rng.effects);
    // The key remains in the pack.
    expect(result.run.items.some((item) => item.contentId === 'item.brass-key')).toBe(true);
    expect(roundTrips(result.run)).toBe(true);
  });

  it('treats a natural 1 on a door as an ordinary, retryable failure', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 2);
    const door = lockedDoor();
    const run: ActiveRun = {
      ...base,
      actors: [hero],
      features: [door],
      items: [lockpickItem()],
      rng: { ...base.rng, effects: effectsStateForRoll(1) },
    };
    const result = pickLock({
      run,
      content: content(),
      actorId: hero.actorId,
      featureId: door.featureId,
      eventId: 'event.pick',
    });
    const feature = result.run.features[0] as DoorFeature;
    // A door never permanently jams: it stays locked and retryable.
    expect(feature.state).toBe('locked');
    expect(feature.lock).not.toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual(['item.consumed', 'lock.pick-failed']);
    expect(result.run.items.find((item) => item.contentId === 'item.lockpick')?.quantity).toBe(2);
    expect(roundTrips(result.run)).toBe(true);
  });

  it('produces the same outcome for a fixed seed', () => {
    const build = (): ActiveRun => {
      const base = createDemoRun();
      const hero = heroAt(base, 2, 1);
      const chest = lockedChest({}, 2);
      return { ...base, actors: [hero], features: [chest], items: [lockpickItem()] };
    };
    const first = pickLock({
      run: build(),
      content: content(),
      actorId: 'hero.demo',
      featureId: 'chest.locked',
      eventId: 'event.pick',
    });
    const second = pickLock({
      run: build(),
      content: content(),
      actorId: 'hero.demo',
      featureId: 'chest.locked',
      eventId: 'event.pick',
    });
    expect(encodeActiveRun(first.run)).toEqual(encodeActiveRun(second.run));
  });

  it('rejects a pick attempt when the actor holds neither a lockpick nor the key', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 2);
    const door = lockedDoor('item.brass-key');
    const run: ActiveRun = { ...base, actors: [hero], features: [door], items: [] };
    const validation = validatePlayerAction({
      state: run,
      command: {
        type: 'pick-lock',
        commandId: 'command.pick',
        expectedRevision: run.revision,
        featureId: door.featureId,
      },
      context: { content: content() },
    });
    expect(validation).toEqual({ status: 'invalid', reason: 'action.unavailable' });
  });

  it('validates a pick attempt when the actor holds a lockpick', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 2);
    const door = lockedDoor();
    const run: ActiveRun = { ...base, actors: [hero], features: [door], items: [lockpickItem()] };
    const validation = validatePlayerAction({
      state: run,
      command: {
        type: 'pick-lock',
        commandId: 'command.pick',
        expectedRevision: run.revision,
        featureId: door.featureId,
      },
      context: { content: content() },
    });
    expect(validation).toMatchObject({ type: 'pick-lock', featureId: door.featureId });
  });
});
