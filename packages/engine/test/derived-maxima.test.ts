import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  CurseContentEntry,
  EnchantmentContentEntry,
  ItemContentEntry,
} from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyCurseTriggers,
  createDemoContentPack,
  createMerchantDemoRun,
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  merchantDemoCommands,
  projectGameplayState,
  resolveCommand,
  synchronizeDerivedMaxima,
  type ActiveRun,
  type ActorState,
  type DomainEvent,
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
    // Common (bps 10000) keeps `deriveEnchantmentModifiers`'s scaling a 1:1 identity against the
    // authored modifier below, so the hand-picked test magnitudes (5 maxHealth, 3 maxWeave) are
    // exactly what content-bound validation's registry re-derivation expects to see on the
    // instance -- rarity plays no other role in this suite.
    rarity: 'common',
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

const HEALING_POTION = 'item.test-elixir';
const CURSED_RING = 'item.cursed-ring';
const TEST_CURSE = 'curse.test-below-half';

/** Heals far more than any gap the tests open, so the cap -- not the roll -- is what is measured. */
const potion: ItemContentEntry = {
  ...ring(HEALING_POTION),
  category: 'potion',
  glyph: '!',
  equipment: null,
  effects: [
    {
      effectId: 'effect.heal',
      parameters: { dice: { count: 1, sides: 1, bonus: 50 } },
      requiresLivingTarget: true,
    },
  ],
};

const belowHalfCurse: CurseContentEntry = {
  kind: 'curse',
  id: TEST_CURSE,
  name: 'Test curse',
  tags: ['curse'],
  revealText: 'The weight of it settles.',
  drawbackModifiers: { defense: -1 },
  trigger: {
    on: 'on-hurt-below-half',
    effect: {
      effectId: 'effect.hunger.restore',
      parameters: { amount: 1 },
      requiresLivingTarget: true,
    },
    chanceBps: 10000,
  },
};

const testEnchantment: EnchantmentContentEntry = {
  kind: 'enchantment',
  id: 'enchantment.test',
  name: 'Test enchantment',
  tags: ['enchantment', 'ring'],
  categories: ['ring'],
  modifiers: { maxHealth: 5 },
  weight: 1,
};

/** A distinct registry entry for the weave-side fixtures below, since content-bound validation now
 * re-derives each instance's stored modifiers from its own `enchantmentId` -- one entry cannot
 * honestly stand in for both a maxHealth and a maxWeave test magnitude. */
const testWeaveEnchantment: EnchantmentContentEntry = {
  kind: 'enchantment',
  id: 'enchantment.test-weave',
  name: 'Test weave enchantment',
  tags: ['enchantment', 'ring'],
  categories: ['ring'],
  modifiers: { maxWeave: 3 },
  weight: 1,
};

function pack(): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [
      ...base.entries,
      ring(VITALITY_RING),
      ring(CURSED_RING),
      potion,
      belowHalfCurse,
      testEnchantment,
      testWeaveEnchantment,
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
  enchantmentId = 'enchantment.test',
): ItemInstance {
  return {
    itemId,
    contentId,
    quantity: 1,
    condition: 100,
    enchantment: { enchantmentId, modifiers },
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
  const enchantmentId = contentId === VITALITY_RING ? 'enchantment.test' : 'enchantment.test-weave';
  const staged: ActiveRun = {
    ...run,
    items: [
      ...run.items,
      ringInstance(
        'item.ring.1',
        contentId,
        modifiers,
        {
          type: 'backpack',
          actorId: hero.actorId,
        },
        enchantmentId,
      ),
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

describe('the readers a non-world command reaches', () => {
  let shipping: CompiledContentPack;

  beforeAll(async () => {
    shipping = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  /** The shipping pack plus the test ring, so a merchant scenario can carry one. */
  function shippingWithRing(): CompiledContentPack {
    return { ...shipping, entries: [...shipping.entries, ring(VITALITY_RING), testEnchantment] };
  }

  it('refreshes the stored maximum on a trade command, which never runs a world step', () => {
    // The trade, dialogue and house branches return before the world branch's own refresh, so the
    // sync has to live at the recording choke point every branch funnels through. This matters on
    // shipping content: `merchant-service.remove-curse` strips a curse whose `maxWeave` drawback is
    // live, and a paid service must show its effect in the command the player bought it in.
    const content = shippingWithRing();
    const initial = createMerchantDemoRun(content);
    const commands = merchantDemoCommands(initial);
    const openCommand = commands.find((entry) => entry.boundary === 'before-open')!.command;
    const buyCommand = commands.find((entry) => entry.boundary === 'before-buy')!.command;

    const opened = resolveCommand(initial, openCommand, { content });
    expect(opened.result.status).toBe('applied');

    const hero = heroActor(opened.state);
    const staleMaximum = hero.maxHealth;
    const staged: ActiveRun = {
      ...opened.state,
      items: [
        ...opened.state.items,
        ringInstance(
          'item.ring.stale',
          VITALITY_RING,
          { maxHealth: 5 },
          {
            type: 'equipped',
            actorId: hero.actorId,
            slot: 'left-ring',
          },
        ),
      ],
      actors: opened.state.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? { ...actor, equipment: { ...actor.equipment, 'left-ring': 'item.ring.stale' } }
          : actor,
      ),
    };

    const bought = resolveCommand(staged, buyCommand, { content });
    expect(bought.result.status).toBe('applied');
    // No world step ran -- the turn did not even advance -- and the maximum is still correct.
    expect(bought.state.turn).toBe(opened.state.turn);
    expect(heroActor(bought.state).maxHealth).toBe(staleMaximum + 5);
  });

  it('heals a potion up to the raised maximum', () => {
    // `effect.heal` caps at `maxHealth - health`, a reader distinct from rest's stop condition.
    const worn = equipViaCommand(wounded(heroAtFullHealth(), 10), VITALITY_RING, 'left-ring');
    const hero = heroActor(worn);
    const withPotion: ActiveRun = {
      ...worn,
      items: [
        ...worn.items,
        {
          itemId: 'item.elixir.1',
          contentId: HEALING_POTION,
          quantity: 1,
          condition: 100,
          enchantment: null,
          identified: true,
          charges: null,
          fuel: null,
          enabled: null,
          location: { type: 'backpack', actorId: hero.actorId },
        },
      ],
    };
    const drunk = apply(withPotion, {
      type: 'use-item',
      itemId: 'item.elixir.1',
      target: null,
    } as never);
    expect(heroActor(drunk).health).toBe(BASE_MAX_HEALTH + 5);
    expect(heroActor(drunk).health).toBeGreaterThan(BASE_MAX_HEALTH);
  });
});

describe('the below-half crossing reads the pre-sync maximum', () => {
  /**
   * `matchedTriggers` fires when `2 * health < maxHealth <= 2 * (health + amount)` -- it reads the
   * hero's STORED maximum, and in `resolveCommand` it runs before the refresh. So the crossing is
   * decided against the maximum the hero had when the blow landed, not the one they end the command
   * with.
   *
   * The two only disagree when the refresh moves the maximum across the crossing window
   * `(2 * health, 2 * (health + amount)]` -- a window exactly `2 * amount` wide. A maximum that
   * moves by less than the damage taken this turn can never straddle it, which is every modifier in
   * shipping content by a wide margin. This test pins the agreeing case; a divergence would need a
   * single command to both damage the hero and swing their maximum by more than twice that damage.
   */
  function cursedState(): ActiveRun {
    const run = heroAtFullHealth();
    const hero = heroActor(run);
    return {
      ...run,
      items: [
        ...run.items,
        {
          ...ringInstance(
            'item.cursed.1',
            CURSED_RING,
            { maxHealth: 5 },
            {
              type: 'equipped',
              actorId: hero.actorId,
              slot: 'left-ring',
            },
          ),
          curse: { curseId: TEST_CURSE, revealed: false },
        },
      ],
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId
          ? {
              ...actor,
              // Just under half of the STORED maximum, which the ring has not been folded into yet.
              health: Math.floor(BASE_MAX_HEALTH / 2) - 1,
              equipment: { ...actor.equipment, 'left-ring': 'item.cursed.1' },
            }
          : actor,
      ),
    };
  }

  function damageEvent(actor: ActorState, amount: number): DomainEvent {
    return {
      type: 'actor.damaged',
      eventId: 'event.blow',
      actorId: actor.actorId,
      sourceActorId: actor.actorId,
      damageType: 'physical',
      amount,
      health: actor.health,
    } as DomainEvent;
  }

  it('decides the crossing before the refresh, and the refresh does not undo it', () => {
    const state = cursedState();
    const hero = heroActor(state);
    // Pre-blow health was at or above half of the stored 28; post-blow health is below it.
    const triggered = applyCurseTriggers({
      state,
      content,
      events: [damageEvent(hero, 3)],
      eventId: 'event.blow',
    });
    expect(triggered.events.some((event) => event.type === 'curse.revealed')).toBe(true);

    const synced = synchronizeDerivedMaxima(triggered.state, content);
    // The refresh raises the bar afterwards -- the crossing already happened and stands.
    expect(heroActor(synced).maxHealth).toBe(BASE_MAX_HEALTH + 5);
    expect(heroActor(synced).health).toBe(heroActor(triggered.state).health);
  });

  it('does not fire when the same blow lands above half of the stored maximum', () => {
    const state = cursedState();
    const hero = heroActor(state);
    const healthy: ActiveRun = {
      ...state,
      actors: state.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, health: BASE_MAX_HEALTH - 1 } : actor,
      ),
    };
    const triggered = applyCurseTriggers({
      state: healthy,
      content,
      events: [damageEvent(heroActor(healthy), 1)],
      eventId: 'event.blow',
    });
    expect(triggered.events).toEqual([]);
  });
});
