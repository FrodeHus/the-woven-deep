import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  projectGameplayState,
  resolveCommand,
  synchronizeDerivedMaxima,
  type ActiveRun,
  type GameCommand,
  type ItemInstance,
} from '../src/index.js';

/**
 * The demo balance derives `maxHealth: base 8 + 2 * vitality` and `maxWeave: base 4 + wits`, and the
 * demo hero has vitality/wits 10 -- so a self-consistent hero carries 28 health and 14 weave. The
 * point of this suite is that an item modifier finally moves those numbers.
 */
const BASE_MAX_HEALTH = 28;
const BASE_MAX_WEAVE = 14;

const VITALITY_RING = 'item.vitality-ring';
const WITS_RING = 'item.wits-ring';

function ring(id: string): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    description: '',
    tags: [],
    glyph: '=',
    color: '#c8c8d8',
    category: 'ring',
    stackLimit: 1,
    price: 10,
    rarity: 'rare',
    heirloomEligible: false,
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: ['left-ring'], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
}

function pack(): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      ring(VITALITY_RING),
      {
        ...ring(WITS_RING),
        equipment: { slots: ['right-ring'], handedness: 'one-handed', reservedSlots: [] },
      },
    ],
  };
}

const content = pack();

/** The demo run with its hero made self-consistent with the pack's own formulas. */
function heroWearingNothing(): ActiveRun {
  const run = createDemoRun();
  const hero = heroActor(run);
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? {
            ...actor,
            health: BASE_MAX_HEALTH,
            maxHealth: BASE_MAX_HEALTH,
            weave: BASE_MAX_WEAVE,
            maxWeave: BASE_MAX_WEAVE,
          }
        : actor,
    ),
  };
}

const heroAtFullHealth = heroWearingNothing;

function ringInstance(
  itemId: string,
  contentId: string,
  modifiers: Record<string, number>,
  location: ItemInstance['location'],
): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: { enchantmentId: 'enchantment.test', modifiers },
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location,
  };
}

/** Puts the ring straight into the matching slot, bypassing the equip command. */
function equipVitalityRing(run: ActiveRun): ActiveRun {
  const hero = heroActor(run);
  return {
    ...run,
    items: [
      ...run.items,
      ringInstance(
        'item.ring.1',
        VITALITY_RING,
        { maxHealth: 5 },
        {
          type: 'equipped',
          actorId: hero.actorId,
          slot: 'left-ring',
        },
      ),
    ],
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, equipment: { ...actor.equipment, 'left-ring': 'item.ring.1' } }
        : actor,
    ),
  };
}

function unequipVitalityRing(run: ActiveRun): ActiveRun {
  const hero = heroActor(run);
  return {
    ...run,
    items: run.items.filter((item) => item.itemId !== 'item.ring.1'),
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, equipment: { ...actor.equipment, 'left-ring': null } }
        : actor,
    ),
  };
}

/** A hero whose every point of maximum health has been modified away. */
function heroWithMaxHealthDrainedToZero(): ActiveRun {
  const run = heroWearingNothing();
  const hero = heroActor(run);
  return {
    ...run,
    items: [
      ...run.items,
      ringInstance(
        'item.ring.1',
        VITALITY_RING,
        { maxHealth: -1000 },
        {
          type: 'equipped',
          actorId: hero.actorId,
          slot: 'left-ring',
        },
      ),
    ],
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, equipment: { ...actor.equipment, 'left-ring': 'item.ring.1' } }
        : actor,
    ),
  };
}

/** A second, non-hero actor whose stored maxima disagree with anything derivable. */
function runWithPlacedChampion(): ActiveRun {
  const run = heroWearingNothing();
  const hero = heroActor(run);
  return {
    ...run,
    actors: [
      ...run.actors,
      {
        ...hero,
        actorId: 'actor.champion',
        playerControlled: false,
        disposition: 'hostile' as const,
        x: 3,
        y: 3,
        health: 120,
        maxHealth: 120,
        weave: 0,
        maxWeave: 0,
        populationId: 'population.champion',
      },
    ],
  };
}

let commandCounter = 0;
function apply(
  run: ActiveRun,
  command: Omit<GameCommand, 'commandId' | 'expectedRevision'>,
): ActiveRun {
  commandCounter += 1;
  const resolution = resolveCommand(
    run,
    {
      ...command,
      commandId: `command.${commandCounter}`,
      expectedRevision: run.revision,
    } as GameCommand,
    { content },
  );
  if (resolution.result.status !== 'applied') {
    throw new Error(`command ${command.type} was rejected: ${JSON.stringify(resolution.result)}`);
  }
  return resolution.state;
}

/** The ring in the backpack, then equipped through the real command path. */
function equipViaCommand(
  run: ActiveRun,
  contentId: string,
  slot: 'left-ring' | 'right-ring',
): ActiveRun {
  const hero = heroActor(run);
  const modifiers = contentId === VITALITY_RING ? { maxHealth: 5 } : { maxWeave: 3 };
  const staged: ActiveRun = {
    ...run,
    items: [
      ...run.items,
      ringInstance('item.ring.1', contentId, modifiers, {
        type: 'backpack',
        actorId: hero.actorId,
      }),
    ],
  };
  return apply(staged, { type: 'equip', itemId: 'item.ring.1', slot } as never);
}

function wounded(run: ActiveRun, health: number): ActiveRun {
  const hero = heroActor(run);
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, health } : actor,
    ),
  };
}

describe('synchronizeDerivedMaxima', () => {
  it('raises the stored maximum when a +maxHealth item is equipped', () => {
    const run = heroWearingNothing();
    const equipped = equipVitalityRing(run);
    const synced = synchronizeDerivedMaxima(equipped, content);
    expect(heroActor(synced).maxHealth).toBe(heroActor(run).maxHealth + 5);
  });

  it('lowers the stored maximum and clamps health when the item comes off', () => {
    const worn = synchronizeDerivedMaxima(equipVitalityRing(heroAtFullHealth()), content);
    expect(heroActor(worn).maxHealth).toBe(BASE_MAX_HEALTH + 5);
    const bare = synchronizeDerivedMaxima(unequipVitalityRing(worn), content);
    expect(heroActor(bare).maxHealth).toBe(BASE_MAX_HEALTH);
    // The five points the ring was holding up are gone, so the health riding on them clamps down.
    expect(heroActor(bare).health).toBe(heroActor(bare).maxHealth);
  });

  it('never clamps health below 1', () => {
    const drained = synchronizeDerivedMaxima(heroWithMaxHealthDrainedToZero(), content);
    expect(heroActor(drained).health).toBeGreaterThanOrEqual(1);
    expect(heroActor(drained).maxHealth).toBeGreaterThanOrEqual(1);
  });

  it('leaves a dead hero dead rather than resurrecting a corpse', () => {
    const dead = wounded(heroWearingNothing(), 0);
    expect(heroActor(synchronizeDerivedMaxima(dead, content)).health).toBe(0);
  });

  it('is idempotent', () => {
    const once = synchronizeDerivedMaxima(equipVitalityRing(heroAtFullHealth()), content);
    expect(synchronizeDerivedMaxima(once, content)).toEqual(once);
  });

  it('returns the same state object when nothing moved', () => {
    const settled = synchronizeDerivedMaxima(heroWearingNothing(), content);
    expect(synchronizeDerivedMaxima(settled, content)).toBe(settled);
  });

  it('consumes no randomness', () => {
    const before = equipVitalityRing(heroAtFullHealth());
    expect(synchronizeDerivedMaxima(before, content).rng).toEqual(before.rng);
  });

  it('leaves champion and echo actors untouched', () => {
    const withHaunt = runWithPlacedChampion();
    const synced = synchronizeDerivedMaxima(withHaunt, content);
    expect(synced.actors.filter((actor) => !actor.playerControlled)).toEqual(
      withHaunt.actors.filter((actor) => !actor.playerControlled),
    );
  });
});

describe('every reader of the stored maximum, driven through resolveCommand', () => {
  it('shows the raised maximum on the HUD projection', () => {
    const state = equipViaCommand(heroAtFullHealth(), VITALITY_RING, 'left-ring');
    expect(projectGameplayState({ state, content }).hero.maxHealth).toBe(BASE_MAX_HEALTH + 5);
  });

  it('rests to the raised maximum', () => {
    const worn = equipViaCommand(
      wounded(heroAtFullHealth(), BASE_MAX_HEALTH + 2),
      VITALITY_RING,
      'left-ring',
    );
    const rested = apply(worn, { type: 'rest', until: 'healed', maximumDuration: 5000 } as never);
    expect(heroActor(rested).health).toBe(BASE_MAX_HEALTH + 5);
  });

  it('restores weave to the raised maximum', () => {
    const spent = {
      ...heroAtFullHealth(),
      actors: heroAtFullHealth().actors.map((actor) =>
        actor.playerControlled ? { ...actor, weave: 0 } : actor,
      ),
    };
    const worn = equipViaCommand(spent, WITS_RING, 'right-ring');
    const rested = apply(worn, { type: 'rest', until: 'healed', maximumDuration: 5000 } as never);
    expect(heroActor(rested).weave).toBe(BASE_MAX_WEAVE + 3);
  });

  it('keeps a synced run savable', () => {
    const state = equipViaCommand(heroAtFullHealth(), VITALITY_RING, 'left-ring');
    const encoded = encodeActiveRun(state);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
  });

  it('clamps a dropping maximum inside the same command, keeping the run savable', () => {
    // Equipping raises the bar and resting fills to it; taking the ring off must bring health back
    // down inside that same command, or the run violates `health <= maxHealth` at the save boundary.
    const worn = equipViaCommand(
      wounded(heroAtFullHealth(), BASE_MAX_HEALTH + 2),
      VITALITY_RING,
      'left-ring',
    );
    const rested = apply(worn, { type: 'rest', until: 'healed', maximumDuration: 5000 } as never);
    expect(heroActor(rested).health).toBe(BASE_MAX_HEALTH + 5);
    const bare = apply(rested, { type: 'unequip', slot: 'left-ring' } as never);
    expect(heroActor(bare).maxHealth).toBe(BASE_MAX_HEALTH);
    expect(heroActor(bare).health).toBe(BASE_MAX_HEALTH);
    expect(() => encodeActiveRun(bare)).not.toThrow();
  });
});
