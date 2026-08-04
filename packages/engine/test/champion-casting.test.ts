import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import {
  applyAction,
  championCastAction,
  chooseBehaviorAction,
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  type ActiveRun,
  type ActorState,
} from '../src/index.js';

const CHAMPION_ACTOR_ID = 'actor.population.fallen-champion.001';
const POPULATION_ID = 'population.fallen-champion.hall.hero-1';

/** A single-target attack spell: range 5, cost 4. */
const emberBolt: SpellContentEntry = {
  kind: 'spell',
  id: 'spell.ember',
  name: 'Ember',
  description: '',
  tags: [],
  targetingId: 'target.actor',
  range: 5,
  actionCost: 100,
  weaveCost: 4,
  effects: [
    {
      effectId: 'effect.damage',
      parameters: { damageType: 'fire', dice: { count: 1, sides: 4, bonus: 0 } },
    },
  ],
};

/** Costlier than Ember and sorts LATER by id, so cost-ranking and alphabetical order disagree. */
const galeLance: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.gale',
  name: 'Gale',
  weaveCost: 6,
};

/** Out of the champion's reach at the distance every case below uses. */
const shortSpark: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.spark',
  name: 'Spark',
  range: 1,
  weaveCost: 1,
};

/** An unsupported targeting kind: recorded, but never cast by this version. */
const aimedBlast: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.blast',
  name: 'Blast',
  targetingId: 'target.burst',
  aoe: { radius: 2 },
  weaveCost: 2,
};

const selfMend: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.mend',
  name: 'Mend',
  targetingId: 'target.self',
  range: 0,
  weaveCost: 2,
  effects: [{ effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }],
};

const selfWard: SpellContentEntry = {
  ...emberBolt,
  id: 'spell.ward',
  name: 'Ward',
  targetingId: 'target.self',
  range: 0,
  weaveCost: 2,
  effects: [
    {
      effectId: 'effect.condition.apply',
      parameters: { conditionId: 'condition.warded', duration: 10, stacks: 1 },
    },
  ],
};

function packWith(...spells: readonly SpellContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      ...spells,
      {
        kind: 'condition' as const,
        id: 'condition.warded',
        name: 'Warded',
        description: '',
        tags: [],
        color: '#88aaff',
        stacking: 'refresh' as const,
        maximumStacks: 1,
        modifiers: { defense: 2 },
        periodicEffects: [],
      },
    ],
  };
}

/**
 * A run whose champion stands `distance` cells due east of the hero, aware and hostile, with a
 * population carrying `abilityIds`. Everything the decision reads lives here: the population, the
 * actor's Weave, and the awareness list.
 */
function runWithChampion(
  input: Readonly<{
    abilityIds: readonly string[];
    distance: number;
    weave?: number;
    health?: number;
    conditions?: ActorState['conditions'];
  }>,
): ActiveRun {
  const base = createDemoRun();
  const hero = base.actors[0]!;
  const champion: ActorState = {
    ...hero,
    actorId: CHAMPION_ACTOR_ID,
    contentId: hero.contentId,
    playerControlled: false,
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    awareActorIds: [hero.actorId],
    populationId: POPULATION_ID,
    x: hero.x + input.distance,
    y: hero.y,
    health: input.health ?? 20,
    maxHealth: 20,
    weave: input.weave ?? 20,
    maxWeave: 20,
    conditions: input.conditions ?? [],
  };
  return {
    ...base,
    actors: [hero, champion],
    populations: [
      {
        model: 'champion' as const,
        populationId: POPULATION_ID,
        encounterId: 'encounter.fallen-champion',
        floorId: hero.floorId,
        createdAt: 0,
        livingMemberIds: [CHAMPION_ACTOR_ID],
        formerMemberIds: [],
        actorId: CHAMPION_ACTOR_ID,
        hallRecordId: 'hall.hero-1',
        rank: 1 as const,
        defeated: false,
        rewardCreated: false,
        equipmentContentIds: [],
        abilityIds: input.abilityIds,
      },
    ],
  } as ActiveRun;
}

describe('championCastAction', () => {
  it('casts at a target in range', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action).toMatchObject({
      type: 'cast',
      actorId: CHAMPION_ACTOR_ID,
      spellId: 'spell.ember',
      targetActorId: state.actors[0]!.actorId,
      weaveCost: 4,
      cost: 100,
    });
  });

  it('never casts at an adjacent target, leaving the melee branch to act', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 1 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('picks the costliest affordable spell, not the alphabetically first', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember', 'spell.gale'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, galeLance),
    });
    expect(action?.spellId).toBe('spell.gale');
  });

  it('falls back to a cheaper spell when the costliest is unaffordable', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ember', 'spell.gale'],
      distance: 3,
      weave: 5,
    });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, galeLance),
    });
    expect(action?.spellId).toBe('spell.ember');
  });

  it('returns null when nothing is affordable', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 0 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('skips a spell whose range cannot reach the target', () => {
    const state = runWithChampion({ abilityIds: ['spell.spark'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(shortSpark) }),
    ).toBeNull();
  });

  it('ignores an unsupported targeting kind', () => {
    const state = runWithChampion({ abilityIds: ['spell.blast'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(aimedBlast) }),
    ).toBeNull();
  });

  it('ignores an ability the pack no longer defines', () => {
    const state = runWithChampion({ abilityIds: ['spell.deleted'], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('returns null for an actor whose population carries no abilities', () => {
    const state = runWithChampion({ abilityIds: [], distance: 3 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('heals itself when wounded', () => {
    const state = runWithChampion({ abilityIds: ['spell.mend'], distance: 3, health: 5 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(selfMend),
    });
    expect(action).toMatchObject({ spellId: 'spell.mend', targetActorId: CHAMPION_ACTOR_ID });
  });

  it('does not heal itself at full health', () => {
    const state = runWithChampion({ abilityIds: ['spell.mend'], distance: 3, health: 20 });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(selfMend) }),
    ).toBeNull();
  });

  it('wards itself when the condition is absent', () => {
    const state = runWithChampion({ abilityIds: ['spell.ward'], distance: 3 });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(selfWard),
    });
    expect(action?.spellId).toBe('spell.ward');
  });

  it('does not re-ward itself while already warded', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ward'],
      distance: 3,
      conditions: [
        {
          conditionId: 'condition.warded',
          sourceActorId: CHAMPION_ACTOR_ID,
          appliedAt: 0,
          expiresAt: null,
          stacks: 1,
        },
      ],
    });
    expect(
      championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content: packWith(selfWard) }),
    ).toBeNull();
  });

  it('prefers an attack spell over a useful self spell', () => {
    const state = runWithChampion({
      abilityIds: ['spell.ember', 'spell.mend'],
      distance: 3,
      health: 5,
    });
    const action = championCastAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt, selfMend),
    });
    expect(action?.spellId).toBe('spell.ember');
  });

  it('will not cast at a target it cannot perceive', () => {
    // Legality comes from `validateTarget` against the CASTER's perception, so an unlit target
    // is no more castable for a haunt than for the hero. Killing the floor's ambient light is
    // the same lever `event-projection.test.ts`'s own hidden-actor fixture pulls.
    const lit = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const dark: ActiveRun = {
      ...lit,
      floors: [{ ...lit.floors[0]!, ambient: { color: [0, 0, 0], strength: 0 } }],
    };
    expect(
      championCastAction({ state: dark, actorId: CHAMPION_ACTOR_ID, content: packWith(emberBolt) }),
    ).toBeNull();
  });

  it('consumes no randomness', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const content = packWith(emberBolt);
    championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content });
    expect(state.rng).toEqual(createDemoRun().rng);
  });
});

describe('chooseBehaviorAction routes a haunt cast', () => {
  it('returns the cast for a haunt with a legal spell at range', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action).toMatchObject({ type: 'cast', spellId: 'spell.ember' });
  });

  it('still bumps when adjacent', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 1 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action.type).toBe('bump-attack');
  });

  it('walks toward the hero when it cannot pay', () => {
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 0 });
    const action = chooseBehaviorAction({
      state,
      actorId: CHAMPION_ACTOR_ID,
      content: packWith(emberBolt),
    });
    expect(action.type).toBe('move');
  });
});

describe('a haunt cast resolves through the shared resolver', () => {
  it('spends weave, damages the hero, and survives a save round-trip', () => {
    const content = packWith(emberBolt);
    const state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3 });
    const hero = state.actors[0]!;
    const action = championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content })!;
    const applied = applyAction({ state, action, content, eventId: 'event.cast' });

    const caster = applied.state.actors.find(
      (candidate) => candidate.actorId === CHAMPION_ACTOR_ID,
    )!;
    expect(caster.weave).toBe(20 - 4);
    expect(applied.events).toContainEqual(
      expect.objectContaining({ type: 'spell.cast', actorId: CHAMPION_ACTOR_ID }),
    );
    const struck = applied.state.actors.find((candidate) => candidate.actorId === hero.actorId)!;
    expect(struck.health).toBeLessThan(hero.health);

    // `runWithChampion` builds `actors` as [hero, champion] for easy indexing, but the save
    // invariant (`validateOrderedIds`, mirroring the `sortByActorId` production placement uses)
    // requires strictly increasing actorId order. 'actor.population...' sorts before 'hero.demo',
    // so the encoder needs the same normalization a real placement already applies.
    const forSave = {
      ...applied.state,
      actors: [...applied.state.actors].sort((left, right) =>
        left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0,
      ),
    };
    const encoded = encodeActiveRun(forSave);
    expect(encodeActiveRun(decodeActiveRun(encoded, content))).toBe(encoded);
  });

  it('stops casting once the pool cannot pay', () => {
    const content = packWith(emberBolt);
    let state = runWithChampion({ abilityIds: ['spell.ember'], distance: 3, weave: 9 });
    let casts = 0;
    for (let turn = 0; turn < 5; turn += 1) {
      const action = championCastAction({ state, actorId: CHAMPION_ACTOR_ID, content });
      if (!action) break;
      casts += 1;
      state = applyAction({ state, action, content, eventId: `event.cast-${turn}` }).state;
    }
    // 9 Weave pays for two casts at 4 and leaves 1 -- not a third.
    expect(casts).toBe(2);
    const caster = state.actors.find((candidate) => candidate.actorId === CHAMPION_ACTOR_ID)!;
    expect(caster.weave).toBe(1);
  });
});
