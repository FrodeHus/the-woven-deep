import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import {
  applyCondition,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  expandLegacySeed,
  nextUint32,
  type ActorState,
  type Uint32State,
} from '../src/index.js';
import { combat } from '../src/combat-profile.js';
import { combatWithRiders } from '../src/attack-riders.js';

let pack: CompiledContentPack;

/**
 * A 1d1 attacker: rolled damage is fixed, so a natural-20 crit deals 2 and never kills the demo
 * hero. Only the attack roll needs controlling, which `stateProducing` does.
 */
const venomousBase: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.test-venomous',
  name: 'Test Venomous',
  tags: [],
  glyph: 'v',
  color: '#5f8f3a',
  description: 'Synthetic venomous monster used only by attack-riders.test.ts.',
  lore: 'It exists to be bitten by a test.',
  attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
  health: 20,
  speed: 100,
  accuracy: 0,
  defense: 0,
  perception: 0,
  damage: { count: 1, sides: 1, bonus: 0 },
  armor: 0,
  resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  minDepth: 1,
  maxDepth: 1,
  threat: 1,
  rarity: 'common',
  lootTableId: null,
  dropChance: 0,
  onHitConditions: [],
};

const certainVenom: MonsterContentEntry = {
  ...venomousBase,
  id: 'monster.test-certain-venom',
  onHitConditions: [{ conditionId: 'condition.poisoned', chance: 1, duration: null }],
};

const neverVenom: MonsterContentEntry = {
  ...venomousBase,
  id: 'monster.test-never-venom',
  onHitConditions: [{ conditionId: 'condition.poisoned', chance: 0, duration: null }],
};

const shortVenom: MonsterContentEntry = {
  ...venomousBase,
  id: 'monster.test-short-venom',
  onHitConditions: [{ conditionId: 'condition.poisoned', chance: 1, duration: 3 }],
};

beforeAll(async () => {
  const base = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  pack = {
    ...base,
    entries: [...base.entries, venomousBase, certainVenom, neverVenom, shortVenom],
  };
});

function stateProducing(face: number, sides = 20): Uint32State {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  for (let seed = 1; seed < 100_000; seed += 1) {
    const state = expandLegacySeed(seed);
    const step = nextUint32(state);
    if (step.value < limit && (step.value % sides) + 1 === face) return state;
  }
  throw new Error(`no state found for d${sides} face ${face}`);
}

function attackerActor(contentId: string): ActorState {
  return {
    ...createDemoRun().actors[0]!,
    actorId: 'monster.attacker',
    contentId,
    playerControlled: false,
    disposition: 'hostile',
    conditions: [],
  };
}

function heroActor(overrides: Partial<ActorState> = {}): ActorState {
  return { ...createDemoRun().actors[0]!, conditions: [], ...overrides };
}

function attack(
  contentId: string,
  options: Readonly<{ hero?: ActorState; naturalRoll?: number; worldTime?: number }> = {},
) {
  const run = createDemoRun();
  const attacker = attackerActor(contentId);
  const hero = options.hero ?? heroActor();
  const input = {
    actors: [attacker, hero],
    combatState: stateProducing(options.naturalRoll ?? 20),
    attackerId: attacker.actorId,
    targetActorId: hero.actorId,
    eventId: 'command.attack' as const,
    content: pack,
    items: [],
    survival: run.survival,
    populations: [],
    fallenHeroStandings: [],
    worldTime: options.worldTime ?? 0,
    hero: run.hero,
  };
  const withRiders = combatWithRiders(input);
  return {
    withRiders,
    plain: combat(input),
    heroId: hero.actorId,
    attackerId: attacker.actorId,
    poison: (result: { actors: readonly ActorState[] }) =>
      result.actors
        .find((actor) => actor.actorId === hero.actorId)!
        .conditions.find((condition) => condition.conditionId === 'condition.poisoned'),
  };
}

describe('on-hit condition riders', () => {
  it('poisons the target when a venomous monster lands a hit', () => {
    const { withRiders, poison, heroId, attackerId } = attack('monster.test-certain-venom');
    expect(poison(withRiders)).toMatchObject({ conditionId: 'condition.poisoned', stacks: 1 });
    expect(withRiders.events).toContainEqual(
      expect.objectContaining({
        type: 'condition.applied',
        actorId: heroId,
        sourceActorId: attackerId,
        conditionId: 'condition.poisoned',
      }),
    );
  });

  it('honours a rider duration override against the condition default', () => {
    const short = attack('monster.test-short-venom', { worldTime: 10 });
    const standard = attack('monster.test-certain-venom', { worldTime: 10 });
    expect(short.poison(short.withRiders)?.expiresAt).toBe(13);
    expect(standard.poison(standard.withRiders)?.expiresAt).toBe(15);
  });

  it('leaves the target clean when the rider chance does not come up', () => {
    const { withRiders, poison } = attack('monster.test-never-venom');
    expect(poison(withRiders)).toBeUndefined();
  });

  it('applies nothing on a miss and consumes no extra randomness', () => {
    const { withRiders, plain, poison } = attack('monster.test-certain-venom', { naturalRoll: 1 });
    expect(withRiders.events.some((event) => event.type === 'attack.missed')).toBe(true);
    expect(poison(withRiders)).toBeUndefined();
    expect(withRiders.combatState).toEqual(plain.combatState);
  });

  it('does not poison a corpse', () => {
    const hero = heroActor({ health: 1 });
    const { withRiders, poison } = attack('monster.test-certain-venom', { hero });
    expect(withRiders.events.some((event) => event.type === 'actor.died')).toBe(true);
    expect(poison(withRiders)).toBeUndefined();
  });

  it('consumes no randomness when the attacker carries no riders', () => {
    const { withRiders, plain } = attack('monster.test-venomous');
    expect(withRiders.combatState).toEqual(plain.combatState);
    expect(withRiders.events).toEqual(plain.events);
  });

  it('applies nothing when the attacker is the hero rather than a monster', () => {
    const run = createDemoRun();
    const hero = { ...run.actors[0]!, conditions: [] };
    const target = attackerActor('monster.test-certain-venom');
    const input = {
      actors: [hero, target],
      combatState: stateProducing(20),
      attackerId: hero.actorId,
      targetActorId: target.actorId,
      eventId: 'command.attack' as const,
      content: pack,
      items: [],
      survival: run.survival,
      populations: [],
      fallenHeroStandings: [],
      worldTime: 0,
      hero: run.hero,
    };
    const result = combatWithRiders(input);
    expect(result.combatState).toEqual(combat(input).combatState);
    expect(
      result.actors.find((actor) => actor.actorId === target.actorId)!.conditions,
    ).toHaveLength(0);
  });

  // The design claims riders need no save-schema bump because `ActorState.conditions` already
  // round-trips. This pins that claim rather than trusting it.
  it('round-trips a poisoned run through the save codec unchanged', () => {
    const run = createDemoRun();
    const applied = applyCondition({
      actors: run.actors,
      content: pack,
      targetActorId: run.actors[0]!.actorId,
      sourceActorId: run.actors[0]!.actorId,
      conditionId: 'condition.poisoned',
      worldTime: run.worldTime,
      eventId: 'command.attack',
    });
    const poisoned = { ...run, actors: applied.actors };
    const encoded = encodeActiveRun(poisoned);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(
      decodeActiveRun(encoded).actors[0]!.conditions.map((condition) => condition.conditionId),
    ).toContain('condition.poisoned');
  });

  it('refreshes an existing poison rather than stacking it', () => {
    const bitten = heroActor({
      conditions: [
        {
          conditionId: 'condition.poisoned',
          sourceActorId: 'monster.attacker',
          appliedAt: 0,
          expiresAt: 5,
          stacks: 1,
        },
      ],
    });
    const { withRiders, poison } = attack('monster.test-certain-venom', {
      hero: bitten,
      worldTime: 10,
    });
    expect(poison(withRiders)).toMatchObject({ stacks: 1, expiresAt: 15 });
  });
});
