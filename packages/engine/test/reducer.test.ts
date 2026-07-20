import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type MonsterContentEntry,
} from '@woven-deep/content/compiler';
import {
  createDemoRun,
  createDemoContentPack,
  createMerchantDemoRun,
  createUnknownKnowledge,
  decodeActiveRun,
  encodeActiveRun,
  expandLegacySeed,
  heroActor,
  heroPerception,
  isExplored,
  merchantDemoCommands,
  nextUint32,
  refreshKnowledge,
  resolveCommand as resolveCommandWithContext,
  stableJson,
  type ActiveRun,
  type ActorState,
  type GameCommand,
  type LightSource,
  type TileId,
  type Uint32State,
} from '../src/index.js';

const context = { content: createDemoContentPack() };
const resolveCommand = (
  state: Parameters<typeof resolveCommandWithContext>[0],
  command: Parameters<typeof resolveCommandWithContext>[1],
) => resolveCommandWithContext(state, command, context);

const move = (
  commandId: string,
  expectedRevision: number,
  direction: 'north' | 'south' | 'east' | 'west',
): GameCommand => ({
  type: 'move',
  commandId,
  expectedRevision,
  direction,
});

describe('resolveCommand', () => {
  it('moves without mutating input and advances turn/revision', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, move('command.1', 0, 'east'));
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(heroActor(resolution.state)).toMatchObject({ x: 2, y: 1 });
    expect(resolution.events).toEqual([
      {
        type: 'hero.moved',
        eventId: 'command.1',
        heroId: 'hero.demo',
        from: { x: 1, y: 1 },
        to: { x: 2, y: 1 },
      },
    ]);
    expect(heroActor(initial)).toMatchObject({ x: 1, y: 1 });
    expect(initial.recentCommands).toHaveLength(0);
  });

  it.each([
    [0, 'blocked.wall'],
    [2, 'blocked.door'],
    [3, 'blocked.pillar'],
    [6, 'blocked.void'],
  ] as const)(
    'records terrain %i as %s without changing the run counters or world',
    (tile, reason) => {
      const demo = createDemoRun();
      const floor = demo.floors[0]!;
      const initial = {
        ...demo,
        floors: [
          { ...floor, tiles: floor.tiles.map((current, index) => (index === 9 ? tile : current)) },
        ],
      };
      const resolution = resolveCommand(initial, move(`command.${reason}`, 0, 'east'));

      expect(resolution.result).toEqual({
        status: 'invalid',
        commandId: `command.${reason}`,
        reason,
        revision: 0,
        turn: 0,
      });
      expect(resolution.state.hero).toEqual(initial.hero);
      expect(resolution.state.floors).toEqual(initial.floors);
      expect(resolution.state.floors[0]?.knowledge).toBe(initial.floors[0]?.knowledge);
      expect(resolution.state).toMatchObject({ revision: 0, turn: 0 });
      expect(resolution.state.recentCommands).toHaveLength(1);
    },
  );

  it.each([
    [1, 'floor'],
    [4, 'stair-up'],
    [5, 'stair-down'],
  ] as const)('walks onto terrain %i (%s) without changing floors', (tile, _name) => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      floors: [
        { ...floor, tiles: floor.tiles.map((current, index) => (index === 9 ? tile : current)) },
      ],
    };
    const resolution = resolveCommand(initial, move(`command.walk.${tile}`, 0, 'east'));

    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(heroActor(resolution.state)).toMatchObject({ floorId: floor.floorId, x: 2, y: 1 });
    expect(resolution.state.activeFloorId).toBe(floor.floorId);
  });

  it('rejects bounds and stale revisions without advancing', () => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      actors: [{ ...demo.actors[0]!, x: 0, y: 0 }],
      floors: [{ ...floor, tiles: floor.tiles.map((tile, index) => (index === 0 ? 1 : tile)) }],
    };
    expect(resolveCommand(initial, move('command.bounds', 0, 'west')).result).toMatchObject({
      status: 'invalid',
      reason: 'blocked.bounds',
    });
    expect(resolveCommand(createDemoRun(), move('command.stale', 9, 'east')).result).toMatchObject({
      status: 'rejected',
      reason: 'stale_revision',
    });
  });

  it('applies wait without changing position', () => {
    const initial = createDemoRun();
    const resolution = resolveCommand(initial, {
      type: 'wait',
      commandId: 'command.wait',
      expectedRevision: 0,
    });
    expect(resolution.state.hero).toEqual(initial.hero);
    expect(resolution.result).toMatchObject({ status: 'applied', revision: 1, turn: 1 });
    expect(resolution.events[0]?.type).toBe('hero.waited');
  });

  it('replays identical IDs and rejects conflicting reuse', () => {
    const command = move('command.repeat', 0, 'east');
    const first = resolveCommand(createDemoRun(), command);
    const duplicate = resolveCommand(first.state, command);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.result).toEqual(first.result);
    expect(duplicate.events).toEqual(first.events);
    const conflict = resolveCommand(first.state, { ...command, direction: 'south' });
    expect(conflict.result).toMatchObject({ status: 'rejected', reason: 'command_id_conflict' });
  });

  it('refreshes only applied movement knowledge with the moved carried light', () => {
    const width = 9;
    const tiles = Array.from({ length: width }, () => 1 as TileId);
    const demo = createDemoRun();
    const hero = { ...demo.hero, actorId: 'hero.corridor', sightRadius: 8 } as const;
    const actor = {
      ...demo.actors[0]!,
      actorId: hero.actorId,
      floorId: 'floor.corridor',
      x: 2,
      y: 0,
    };
    const perceivedHero = heroPerception(hero, actor);
    const carriedLight: LightSource = {
      lightId: 'light.carried',
      location: { type: 'actor', actorId: actor.actorId },
      color: [255, 255, 255],
      radius: 2,
      strength: 255,
      enabled: true,
      falloff: 'linear',
      vaultPlacementId: null,
      presentation: null,
    };
    const entityLight: LightSource = {
      ...carriedLight,
      lightId: 'light.entity',
      location: { type: 'actor', actorId: 'entity.sentry' },
      radius: 1,
    };
    const template = demo.floors[0]!;
    const corridor = {
      ...template,
      floorId: actor.floorId,
      width,
      height: 1,
      tiles,
      entities: [{ entityId: 'entity.sentry', x: 7, y: 0 }],
      ambient: { color: [255, 255, 255] as const, strength: 0 },
      knowledge: createUnknownKnowledge(width),
      lights: [carriedLight, entityLight],
      stairUp: null,
      stairDown: null,
    };
    const initialKnowledge = refreshKnowledge({
      floor: corridor,
      hero: perceivedHero,
      actors: new Map([
        [actor.actorId, actor],
        ['entity.sentry', corridor.entities[0]!],
      ]),
    }).knowledge;
    const inactiveFloor = { ...template, floorId: 'floor.inactive' };
    const initial = {
      ...demo,
      hero,
      actors: [actor],
      activeFloorId: actor.floorId,
      floors: [{ ...corridor, knowledge: initialKnowledge }, inactiveFloor],
    };
    const before = stableJson(initial);
    const command = move('command.corridor', 0, 'east');

    const first = resolveCommand(initial, command);
    const activeKnowledge = first.state.floors[0]!.knowledge;

    expect(heroActor(first.state)).toMatchObject({ x: 3, y: 0 });
    expect(first.state.floors.map((floor) => floor.floorId)).toEqual([
      'floor.corridor',
      'floor.inactive',
    ]);
    expect(first.state.floors[1]).toBe(inactiveFloor);
    expect(first.state.floors[0]!.lights[0]!.location).toEqual({
      type: 'actor',
      actorId: actor.actorId,
    });
    expect(isExplored(initialKnowledge, 5)).toBe(false);
    expect(isExplored(activeKnowledge, 5)).toBe(true);
    expect(isExplored(initialKnowledge, 0)).toBe(true);
    expect(isExplored(activeKnowledge, 0)).toBe(true);
    expect(stableJson(initial)).toBe(before);

    const duplicate = resolveCommand(first.state, command);
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.result).toBe(first.result);
    expect(duplicate.events).toBe(first.events);

    const unchangedKnowledge = first.state.floors[0]!.knowledge;
    const stale = resolveCommand(first.state, move('command.stale.dark', 0, 'east'));
    const conflict = resolveCommand(first.state, { ...command, direction: 'west' });
    const invalid = resolveCommand(first.state, move('command.invalid.dark', 1, 'north'));
    const waited = resolveCommand(first.state, {
      type: 'wait',
      commandId: 'command.wait.dark',
      expectedRevision: 1,
    });

    expect(stale.state).toBe(first.state);
    expect(conflict.state).toBe(first.state);
    expect(stale.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(conflict.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(invalid.state.floors[0]!.knowledge).toBe(unchangedKnowledge);
    expect(waited.state.floors[0]!.knowledge).toStrictEqual(unchangedKnowledge);
  });

  it('evicts only the oldest processed result after 128 records', () => {
    let state = createDemoRun();
    for (let index = 0; index < 129; index += 1) {
      state = resolveCommand(state, {
        type: 'wait',
        commandId: `command.${index}`,
        expectedRevision: index,
      }).state;
    }
    expect(state.recentCommands).toHaveLength(128);
    expect(state.recentCommands[0]?.command.commandId).toBe('command.1');
    expect(state.recentCommands.at(-1)?.command.commandId).toBe('command.128');
  });

  it('rejects trade commands without an eligible merchant or open session', () => {
    const initial = createDemoRun();
    const open = resolveCommand(initial, {
      type: 'trade-open',
      commandId: 'command.trade-open',
      expectedRevision: 0,
      merchantActorId: 'actor.absent',
    });
    expect(open.result).toEqual({
      status: 'invalid',
      commandId: 'command.trade-open',
      reason: 'merchant.unavailable',
      revision: 0,
      turn: 0,
    });
    expect(open.state).toMatchObject({ revision: 0, turn: 0, worldTime: 0, activeTrade: null });

    const buy = resolveCommand(initial, {
      type: 'trade-buy',
      commandId: 'command.trade-buy',
      expectedRevision: 0,
      merchantPopulationId: 'population.absent',
      itemId: 'item.absent',
      quantity: 1,
    });
    expect(buy.result).toMatchObject({
      status: 'invalid',
      reason: 'trade.required',
      revision: 0,
      turn: 0,
    });
    expect(buy.state.rng).toEqual(initial.rng);
  });

  it.each([
    {
      type: 'wait',
      commandId: 'command.overflow.wait',
      expectedRevision: Number.MAX_SAFE_INTEGER,
    } as const,
    move('command.overflow.move', Number.MAX_SAFE_INTEGER, 'east'),
  ])('throws an invariant error before an applied $type can overflow counters', (command) => {
    const initial = {
      ...createDemoRun(),
      revision: Number.MAX_SAFE_INTEGER,
      turn: Number.MAX_SAFE_INTEGER,
    };
    const before = structuredClone(initial);
    expect(() => resolveCommand(initial, command)).toThrow(/invariant/i);
    expect(initial).toEqual(before);
  });
});

function monsterDefinition(id: string): MonsterContentEntry {
  return {
    kind: 'monster',
    id,
    name: id,
    glyph: 'm',
    color: '#aa4444',
    tags: [],
    minDepth: 1,
    maxDepth: 20,
    attributes: { might: 5, agility: 5, vitality: 5, wits: 5, resolve: 5 },
    health: 10,
    speed: 100,
    accuracy: 100,
    defense: 8,
    perception: 8,
    damage: { count: 1, sides: 1, bonus: 0 },
    armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    behaviorParameters: {},
    rarity: 'common',
    threat: 4,
    lootTableId: null,
    dropChance: 0,
  };
}

function combatStateProducing(face: number, sides = 20): Uint32State {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const state = expandLegacySeed(seed);
    const step = nextUint32(state);
    if (step.value < limit && (step.value % sides) + 1 === face) return state;
  }
  throw new Error(`no state found for d${sides} face ${face}`);
}

describe('metrics folding at the record() boundary', () => {
  it('credits a kill and advances turnsElapsed when a hero attack kills an adjacent monster', () => {
    const base = createDemoContentPack();
    const packWithMonster = {
      ...base,
      entries: [...base.entries, monsterDefinition('monster.reducer-target')],
    };
    const demo = createDemoRun();
    const hero = demo.actors[0]!;
    const target: ActorState = {
      ...hero,
      actorId: 'monster.reducer-target',
      contentId: 'monster.reducer-target',
      playerControlled: false,
      x: hero.x + 1,
      y: hero.y,
      health: 1,
      maxHealth: 1,
      disposition: 'hostile',
      populationId: null,
    };
    const initial: ActiveRun = {
      ...demo,
      actors: [hero, target],
      rng: { ...demo.rng, combat: combatStateProducing(20) },
    };
    const resolution = resolveCommandWithContext(
      initial,
      {
        type: 'attack',
        commandId: 'command.reducer-kill',
        expectedRevision: 0,
        targetActorId: target.actorId,
      },
      { content: packWithMonster },
    );

    expect(resolution.result.status).toBe('applied');
    expect(resolution.state.metrics.kills).toBe(1);
    expect(resolution.state.metrics.turnsElapsed).toBe(1);
  });

  describe('trade commerce', () => {
    let content: CompiledContentPack;

    beforeAll(async () => {
      content = await compileContentDirectory({
        rootDir: resolve(import.meta.dirname, '../../../content'),
      });
    });

    it('grows currencySpent from a trade-buy without advancing turnsElapsed', () => {
      const initial = createMerchantDemoRun(content);
      const commands = merchantDemoCommands(initial);
      const openCommand = commands.find((entry) => entry.boundary === 'before-open')!.command;
      const buyCommand = commands.find((entry) => entry.boundary === 'before-buy')!.command;

      const opened = resolveCommandWithContext(initial, openCommand, { content });
      expect(opened.result.status).toBe('applied');

      const bought = resolveCommandWithContext(opened.state, buyCommand, { content });
      expect(bought.result.status).toBe('applied');
      expect(bought.state.metrics.currencySpent).toBeGreaterThan(
        opened.state.metrics.currencySpent,
      );
      expect(bought.state.metrics.turnsElapsed).toBe(opened.state.metrics.turnsElapsed);
      expect(bought.state.turn).toBe(opened.state.turn);
    });
  });
});

describe('run conclusion', () => {
  function starvingDemoRun(): ActiveRun {
    const demo = createDemoRun();
    const hero = { ...demo.actors[0]!, health: 1 };
    return {
      ...demo,
      actors: [hero],
      survival: {
        ...demo.survival,
        hungerReserve: 0,
        hungerStage: 'starving',
        nextStarvationAt: 1,
      },
    };
  }

  it('concludes the run with a died completion inside the killing transition, then rejects every later command', () => {
    const initial = starvingDemoRun();
    const killing = resolveCommand(initial, {
      type: 'wait',
      commandId: 'command.fatal',
      expectedRevision: 0,
    });

    expect(killing.result).toMatchObject({ status: 'applied' });
    expect(heroActor(killing.state).health).toBe(0);
    expect(killing.events.map((event) => event.type)).toEqual([
      'hero.waited',
      'actor.damaged',
      'actor.died',
      'run.concluded',
    ]);
    expect(killing.state.conclusion).toMatchObject({
      completionType: 'died',
      cause: { killerContentId: null },
    });

    const concludedState = killing.state;
    const revisionBefore = concludedState.revision;
    const turnBefore = concludedState.turn;
    const rngBefore = concludedState.rng;

    const attempts: GameCommand[] = [
      move('command.after.move', revisionBefore, 'east'),
      { type: 'wait', commandId: 'command.after.wait', expectedRevision: revisionBefore },
      {
        type: 'trade-open',
        commandId: 'command.after.trade-open',
        expectedRevision: revisionBefore,
        merchantActorId: 'actor.absent',
      },
      {
        type: 'rest',
        commandId: 'command.after.rest',
        expectedRevision: revisionBefore,
        until: 'healed',
        maximumDuration: 100,
      },
    ];

    let state = concludedState;
    for (const command of attempts) {
      const resolution = resolveCommand(state, command);
      expect(resolution.result).toMatchObject({
        status: 'invalid',
        reason: 'run.concluded',
        revision: revisionBefore,
        turn: turnBefore,
      });
      expect(resolution.events.at(-1)).toMatchObject({
        type: 'action.invalid',
        reason: 'run.concluded',
      });
      expect(resolution.state.revision).toBe(revisionBefore);
      expect(resolution.state.turn).toBe(turnBefore);
      expect(resolution.state.rng).toEqual(rngBefore);
      state = resolution.state;
    }

    const encoded = encodeActiveRun(concludedState);
    expect(decodeActiveRun(encoded)).toEqual(concludedState);
  });

  it('credits the killer when a reaction (opportunity attack) kills the hero mid-move', () => {
    const base = createDemoContentPack();
    const packWithMonster = {
      ...base,
      entries: [...base.entries, monsterDefinition('monster.reaction-killer')],
    };
    const demo = createDemoRun();
    const hero = { ...demo.actors[0]!, x: 2, y: 1, health: 1 };
    const monster: ActorState = {
      ...hero,
      actorId: 'monster.reaction-killer.1',
      contentId: 'monster.reaction-killer',
      playerControlled: false,
      x: 3,
      y: 1,
      health: 10,
      maxHealth: 10,
      disposition: 'hostile',
      populationId: null,
      reactionReady: true,
      awareActorIds: [hero.actorId],
    };
    const initial: ActiveRun = {
      ...demo,
      actors: [hero, monster],
      rng: { ...demo.rng, combat: combatStateProducing(20) },
    };

    const killing = resolveCommandWithContext(initial, move('command.reaction-fatal', 0, 'west'), {
      content: packWithMonster,
    });

    expect(killing.result).toMatchObject({ status: 'applied' });
    expect(heroActor(killing.state)).toMatchObject({ x: 2, y: 1, health: 0 });
    expect(killing.events.map((event) => event.type)).toEqual([
      'reaction.triggered',
      'combat.observed',
      'actor.damaged',
      'actor.died',
      'run.concluded',
    ]);
    expect(killing.state.conclusion).toMatchObject({
      completionType: 'died',
      cause: { killerContentId: 'monster.reaction-killer' },
    });
  });

  it('concludes the run when a rest is interrupted by a fatal starvation tick', () => {
    const initial = starvingDemoRun();
    const killing = resolveCommand(initial, {
      type: 'rest',
      commandId: 'command.rest-fatal',
      expectedRevision: 0,
      until: 'healed',
      maximumDuration: 5000,
    });

    expect(killing.result).toMatchObject({ status: 'applied' });
    expect(heroActor(killing.state).health).toBe(0);
    // The tick that starves the hero to death is observed as ordinary rest-interrupting damage
    // (restStopReason ranks 'damage' above 'hero-death'); the conclusion boundary still fires in
    // this same transition regardless of which stop reason the rest itself records.
    const restCompleted = killing.events.find((event) => event.type === 'rest.completed');
    expect(restCompleted).toMatchObject({ stopReason: 'damage' });
    expect(killing.events.at(-1)).toMatchObject({ type: 'run.concluded', completionType: 'died' });
    expect(killing.state.conclusion).toMatchObject({
      completionType: 'died',
      cause: { killerContentId: null },
    });
  });
});
