import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  movementAction,
  resolveCommand,
  validatePlayerAction,
  type ActiveRun,
  type ActorState,
  type ChestFeature,
  type Direction,
  type GameCommand,
  type ResolutionContext,
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
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

const TREASURE = itemDefinition('item.treasure', { glyph: '*', color: '#ffd700' });

function content(): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, TREASURE] };
}

const context: ResolutionContext = { content: content() };

/**
 * The demo floor is
 *   #######
 *   #.....#
 *   #..#..#
 *   #.....#
 *   #######
 * so (2,2) is walkable floor with a wall pillar beside it at (3,2).
 */
function chestAt(x: number, y: number, overrides: Partial<ChestFeature> = {}): ChestFeature {
  return {
    featureId: 'chest.closed',
    type: 'chest',
    floorId: 'floor.demo',
    x,
    y,
    contentId: null,
    coverTileId: 1,
    state: 'closed',
    lock: null,
    lootTableId: null,
    lootContentId: TREASURE.id,
    ...overrides,
  };
}

function heroAt(base: ActiveRun, x: number, y: number): ActorState {
  return { ...base.actors[0]!, x, y };
}

function runWith(
  hero: ActorState,
  features: readonly ChestFeature[],
  extraActors: readonly ActorState[] = [],
): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    actors: [hero, ...extraActors].sort((left, right) =>
      left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0,
    ),
    features: [...features],
    items: [],
  };
}

function move(direction: Direction, expectedRevision = 0): GameCommand {
  return { type: 'move', commandId: 'command.bump', expectedRevision, direction };
}

describe('bump-to-open a closed chest', () => {
  it('opens and loots a closed chest the hero walks into', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2)]);

    const resolved = resolveCommand(run, move('south'), context);

    expect(resolved.result.status).toBe('applied');
    const chest = resolved.state.features[0] as ChestFeature;
    expect(chest.state).toBe('looted');
    // A terminal chest holds no live lock or loot pointer.
    expect(chest.lock).toBeNull();
    expect(chest.lootTableId).toBeNull();
    expect(chest.lootContentId).toBeNull();
    // The loot lands on the chest's own tile, exactly as the pick-lock success arm does.
    const loot = resolved.state.items.find((item) => item.contentId === TREASURE.id);
    expect(loot?.location).toEqual({ type: 'floor', floorId: 'floor.demo', x: 2, y: 2 });
    // The hero opens the chest instead of entering the cell.
    const heroAfter = resolved.state.actors.find((actor) => actor.actorId === hero.actorId)!;
    expect({ x: heroAfter.x, y: heroAfter.y }).toEqual({ x: 2, y: 1 });
  });

  it('emits loot.dropped and costs the hero a turn of energy', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2)]);

    const resolved = resolveCommand(run, move('south'), context);

    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: 'loot.dropped', x: 2, y: 2 }),
    );
    // Bump-to-open charges the same cost the door bump does (`action.open-door`), so the world
    // advances by a turn exactly as any other action does. (Post-step energy is not the assertion:
    // the scheduler restores it while advancing world time.)
    expect(resolved.result).toMatchObject({ turn: run.turn + 1 });
    expect(resolved.state.worldTime).toBeGreaterThan(run.worldTime);
  });

  it('validates the bump as an open-chest action carrying the door-bump cost', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2)]);

    expect(validatePlayerAction({ state: run, command: move('south'), context })).toEqual({
      type: 'open-chest',
      actorId: hero.actorId,
      featureId: 'chest.closed',
      cost: 100,
    });
  });

  it('draws the loot from the loot stream and nothing else', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2, { lootTableId: null, lootContentId: TREASURE.id })]);

    const resolved = resolveCommand(run, move('south'), context);

    // A fixed `lootContentId` takes no draw at all; a table would. Either way the ONLY stream a
    // chest opening may touch is `loot` -- pinned here against the whole rng record.
    for (const [name, value] of Object.entries(resolved.state.rng)) {
      if (name === 'loot') continue;
      expect(value, name).toEqual(run.rng[name as keyof typeof run.rng]);
    }
  });

  it('leaves the chest terminal: a second bump is an ordinary walk onto the looted cell', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2)]);

    const opened = resolveCommand(run, move('south'), context);
    const second = resolveCommand(
      opened.state,
      { ...move('south', opened.state.revision), commandId: 'command.bump-again' },
      context,
    );

    expect(second.result.status).toBe('applied');
    const heroAfter = second.state.actors.find((actor) => actor.actorId === hero.actorId)!;
    expect({ x: heroAfter.x, y: heroAfter.y }).toEqual({ x: 2, y: 2 });
  });

  it('keeps a locked chest blocked, on the pick-lock path', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [
      chestAt(2, 2, { state: 'locked', lock: { difficulty: 12, keyContentId: null } }),
    ]);

    expect(validatePlayerAction({ state: run, command: move('south'), context })).toEqual({
      status: 'invalid',
      reason: 'blocked.chest',
    });
  });

  it('refuses a diagonal bump whose flanks are both blocked, and opens nothing', () => {
    // The chest sits diagonally at (3,2) -- the interior wall cell, so it takes that tile's
    // coverTileId -- with chests on BOTH orthogonal flanks, (3,1) and (4,2). The corner rule says
    // the hero cannot reach through that gap, so the chest stays shut.
    const base = createDemoRun();
    const hero = heroAt(base, 4, 1);
    const run = runWith(hero, [
      chestAt(3, 2, { featureId: 'chest.target', coverTileId: 0 }),
      chestAt(4, 2, { featureId: 'chest.flank-a' }),
      chestAt(3, 1, { featureId: 'chest.flank-b' }),
    ]);

    expect(validatePlayerAction({ state: run, command: move('southwest'), context })).toEqual({
      status: 'invalid',
      reason: 'blocked.corner',
    });
    const resolved = resolveCommand(run, move('southwest'), context);
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'blocked.corner' });
    for (const feature of resolved.state.features) {
      expect((feature as ChestFeature).state).toBe('closed');
    }
  });

  it('opens the same diagonal chest once a flank is clear', () => {
    // The mirror of the case above: one flank open is all the corner rule asks for.
    const base = createDemoRun();
    const hero = heroAt(base, 4, 1);
    const run = runWith(hero, [
      chestAt(3, 2, { featureId: 'chest.target', coverTileId: 0 }),
      chestAt(4, 2, { featureId: 'chest.flank-a' }),
    ]);

    expect(validatePlayerAction({ state: run, command: move('southwest'), context })).toMatchObject(
      { type: 'open-chest', featureId: 'chest.target' },
    );
  });

  it('never lets a non-hero actor bump a chest open', () => {
    // Every non-hero mover goes through `movementAction` directly (the bump conversion lives in
    // `validatePlayerAction`, which only ever runs for the hero), and it still refuses.
    const base = createDemoRun();
    const monster: ActorState = {
      ...base.actors[0]!,
      actorId: 'monster.rat.1',
      contentId: 'monster.rat',
      playerControlled: false,
      x: 2,
      y: 1,
      disposition: 'hostile',
      populationId: null,
    };
    const run = runWith(heroAt(base, 1, 1), [chestAt(2, 2)], [monster]);

    expect(
      movementAction({
        actor: monster,
        floor: run.floors[0]!,
        actors: run.actors,
        features: run.features,
        relationships: run.relationships,
        direction: 'south',
        cost: 100,
      }),
    ).toEqual({ status: 'invalid', reason: 'blocked.chest' });
  });

  it('round-trips the opened run through the save codec', () => {
    const base = createDemoRun();
    const hero = heroAt(base, 2, 1);
    const run = runWith(hero, [chestAt(2, 2)]);

    const resolved = resolveCommand(run, move('south'), context);
    const encoded = encodeActiveRun(resolved.state);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
  });
});
