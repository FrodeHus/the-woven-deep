import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  allocateIdentificationMap,
  createDemoContentPack,
  createDemoRun,
  createGameplayDemoRun,
  expandLegacySeed,
  firstEnchantableItemId,
  resolveCommand,
  resolveEffectSequence,
  stableJson,
  RNG_STREAM_NAMES,
  type ActiveRun,
  type ActorState,
  type HeirloomItemMetadata,
  type ItemInstance,
} from '../src/index.js';
import type { CompiledContentPack, ConditionContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';

function effectContent() {
  const base = createDemoContentPack();
  const conditions: ConditionContentEntry[] = ['condition.burning', 'condition.slow'].map((id) => ({
    kind: 'condition',
    id,
    name: id,
    description: id,
    tags: [],
    color: '#ffffff',
    duration: { mode: 'timed', default: 3, maximum: 30 },
    stacking: { mode: 'intensify', maximumStacks: 5 },
    modifiersPerStack: {},
    traits: [],
  }));
  return { ...base, entries: [...base.entries, ...conditions] };
}

function actors(health = 10): readonly ActorState[] {
  const hero = createDemoRun().actors[0]!;
  return [
    hero,
    {
      ...hero,
      actorId: 'monster.target',
      contentId: 'monster.target',
      playerControlled: false,
      x: 2,
      health,
      maxHealth: 10,
      disposition: 'hostile',
    },
  ];
}

function fixture(effects: readonly any[], health = 10) {
  return {
    effects,
    actors: actors(health),
    survival: createDemoRun().survival,
    survivalActorId: 'hero.demo',
    content: effectContent(),
    sourceActorId: 'hero.demo',
    targetActorId: 'monster.target',
    effectsState: expandLegacySeed(42),
    worldTime: 12,
    eventId: 'command.effect',
    forceMoveDirection: { x: 1, y: 0 } as const,
    operations: {},
  };
}

describe('ordered effects', () => {
  it('applies damage then a condition in authored order', () => {
    const result = resolveEffectSequence(
      fixture([
        {
          effectId: 'effect.damage',
          parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } },
          requiresLivingTarget: true,
        },
        {
          effectId: 'effect.condition.apply',
          parameters: { conditionId: 'condition.burning', duration: 3 },
          requiresLivingTarget: true,
        },
      ]),
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'attack.hit',
      'actor.damaged',
      'condition.applied',
    ]);
    expect(result.actors[1]?.conditions).toContainEqual(
      expect.objectContaining({
        conditionId: 'condition.burning',
        appliedAt: 12,
        expiresAt: 15,
      }),
    );
  });

  it('skips living-target effects after target death', () => {
    const result = resolveEffectSequence(
      fixture(
        [
          {
            effectId: 'effect.damage',
            parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } },
            requiresLivingTarget: true,
          },
          {
            effectId: 'effect.condition.apply',
            parameters: { conditionId: 'condition.burning', duration: 3 },
            requiresLivingTarget: true,
          },
        ],
        1,
      ),
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'attack.hit',
      'actor.damaged',
      'actor.died',
    ]);
  });

  it('prevalidates every effect before applying the first', () => {
    const input = fixture([
      {
        effectId: 'effect.heal',
        parameters: { dice: { count: 1, sides: 4, bonus: 0 } },
        requiresLivingTarget: false,
      },
      { effectId: 'effect.unknown', parameters: {}, requiresLivingTarget: false },
    ]);
    const before = structuredClone(input);
    expect(() => resolveEffectSequence(input)).toThrow(/unregistered effect/i);
    expect(input).toEqual(before);
  });

  it('heals, removes conditions, and force-moves directly', () => {
    const base = actors(3);
    const target = {
      ...base[1]!,
      conditions: [
        {
          conditionId: 'condition.slow',
          sourceActorId: 'hero.demo',
          appliedAt: 1,
          expiresAt: 20,
          stacks: 1,
        },
      ],
    };
    const result = resolveEffectSequence({
      ...fixture([
        {
          effectId: 'effect.heal',
          parameters: { dice: { count: 1, sides: 1, bonus: 2 } },
          requiresLivingTarget: true,
        },
        {
          effectId: 'effect.condition.remove',
          parameters: { conditionId: 'condition.slow' },
          requiresLivingTarget: true,
        },
        { effectId: 'effect.force-move', parameters: { distance: 2 }, requiresLivingTarget: true },
      ]),
      actors: [base[0]!, target],
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'actor.healed',
      'condition.removed',
      'actor.forced-move',
    ]);
    expect(result.actors[1]).toMatchObject({ health: 6, x: 4, conditions: [] });
  });

  it.each([
    'effect.reveal',
    'effect.fuel.transfer',
    'effect.light.toggle',
    'effect.feature.mutate',
  ] as const)('delegates %s only after validating the full sequence', (effectId) => {
    const parameters = {
      'effect.reveal': { radius: 2 },
      'effect.fuel.transfer': { maximum: 10 },
      'effect.light.toggle': { enabled: true },
      'effect.feature.mutate': { state: 'door.open' },
    }[effectId];
    let calls = 0;
    const result = resolveEffectSequence({
      ...fixture([{ effectId, parameters, requiresLivingTarget: false }]),
      operations: {
        [effectId]: (input) => {
          calls += 1;
          return { actors: input.actors, events: [] };
        },
      },
    });
    expect(calls).toBe(1);
    expect(result.actors).toEqual(actors());
  });

  it('consumes item quantities through the shared inventory transition', () => {
    const item = {
      itemId: 'item.potion.1',
      contentId: 'item.potion',
      quantity: 2,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'backpack' as const, actorId: 'hero.demo' },
    };
    const result = resolveEffectSequence({
      ...fixture([
        {
          effectId: 'effect.item.consume',
          parameters: { quantity: 2 },
          requiresLivingTarget: false,
        },
      ]),
      items: [item],
      sourceItemId: item.itemId,
    });
    expect(result.items).toEqual([]);
    expect(result.events).toContainEqual({
      type: 'item.consumed',
      eventId: 'command.effect',
      actorId: 'hero.demo',
      itemId: item.itemId,
      quantity: 2,
    });
  });

  it('rejects invalid forced movement direction before changing state', () => {
    const input = {
      ...fixture([
        { effectId: 'effect.force-move', parameters: { distance: 1 }, requiresLivingTarget: true },
      ]),
      forceMoveDirection: { x: 0, y: 0 },
    };
    expect(() => resolveEffectSequence(input)).toThrow(/unit direction/i);
  });
});

function cursedItem(
  itemId: string,
  overrides: Readonly<{ actorId?: string; revealed?: boolean; equipped?: boolean }> = {},
): ItemInstance {
  const { actorId = 'hero.demo', revealed = true, equipped = false } = overrides;
  return {
    itemId,
    contentId: 'item.dummy',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: equipped ? { type: 'equipped', actorId, slot: 'main-hand' } : { type: 'backpack', actorId },
    curse: { curseId: 'curse.test', revealed },
  };
}

describe('effect.curse.remove', () => {
  it('removes the curse from the first revealed cursed item in itemId order', () => {
    const itemA = cursedItem('item.a.0001');
    const itemB = cursedItem('item.a.0002');
    const result = resolveEffectSequence({
      ...fixture([
        { effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false },
      ]),
      items: [itemB, itemA],
      targetActorId: 'hero.demo',
    });
    expect(result.items.find((item) => item.itemId === 'item.a.0001')!.curse).toBeUndefined();
    expect(result.items.find((item) => item.itemId === 'item.a.0002')!.curse).toBeDefined();
    expect(result.events).toContainEqual({
      type: 'curse.removed',
      eventId: 'command.effect',
      itemId: 'item.a.0001',
      curseId: 'curse.test',
    });
  });

  it('prefers a welded (equipped) cursed item over a droppable backpack one, whatever the itemId order', () => {
    // The backpack ring sorts first by itemId, but the player aimed the scroll at the sword welded
    // to their hand -- the item they cannot simply drop.
    const backpackRing = cursedItem('item.a.ring');
    const weldedSword = cursedItem('item.z.sword', { equipped: true });
    const result = resolveEffectSequence({
      ...fixture([
        { effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false },
      ]),
      items: [backpackRing, weldedSword],
      targetActorId: 'hero.demo',
    });
    expect(result.items.find((item) => item.itemId === 'item.z.sword')!.curse).toBeUndefined();
    expect(result.items.find((item) => item.itemId === 'item.a.ring')!.curse).toBeDefined();
  });

  it('leaves an unrevealed curse alone', () => {
    const sword = cursedItem('item.sword.1', { revealed: false });
    const result = resolveEffectSequence({
      ...fixture([
        { effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false },
      ]),
      items: [sword],
      targetActorId: 'hero.demo',
    });
    expect(result.items.some((item) => item.curse !== undefined)).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('consumes no randomness whether or not it finds a target', () => {
    const input = {
      ...fixture([
        { effectId: 'effect.curse.remove', parameters: {}, requiresLivingTarget: false },
      ]),
      items: [],
      targetActorId: 'hero.demo',
    };
    const result = resolveEffectSequence(input);
    expect(result.effectsState).toEqual(input.effectsState);
  });

  describe('the scroll of sundering', () => {
    let pack: CompiledContentPack;

    beforeAll(async () => {
      pack = await compileContentDirectory({
        rootDir: resolve(import.meta.dirname, '../../../content'),
      });
    });

    function scrollInstance(actorId: string, itemId = 'item.sundering-scroll.1'): ItemInstance {
      return {
        itemId,
        contentId: 'item.sundering-scroll',
        quantity: 1,
        condition: 100,
        enchantment: null,
        identified: true,
        charges: null,
        fuel: null,
        enabled: null,
        location: { type: 'backpack', actorId },
      };
    }

    it('does not consume the scroll when there is no cursed item to sunder', () => {
      const { run } = createGameplayDemoRun(pack);
      const hero = run.actors.find((actor) => actor.playerControlled)!;
      const scroll = scrollInstance(hero.actorId);
      const withScroll = { ...run, items: [...run.items, scroll] };
      const resolved = resolveCommand(
        withScroll,
        {
          type: 'use-item',
          commandId: 'command.sunder',
          expectedRevision: withScroll.revision,
          itemId: scroll.itemId,
          target: null,
        },
        { content: pack },
      );
      expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'target.invalid' });
      expect(resolved.state.items.find((item) => item.itemId === scroll.itemId)!.quantity).toBe(1);
    });
  });
});

describe('effect.item.enchant', () => {
  let pack: CompiledContentPack;

  const HERO_ID = 'hero.demo';
  const SWORD_CONTENT_ID = 'item.iron-sword';
  const ARTIFACT_CONTENT_ID = 'item.thread-counts-needle';
  const CURSE_ID = 'curse.hungering-edge';
  const POTION_CONTENT_ID = 'item.crimson-potion';
  const SCROLL_CONTENT_ID = 'item.tempering-steel-scroll';
  const SCROLL_ID = 'item.tempering-steel-scroll.1';

  beforeAll(async () => {
    pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  function item(
    itemId: string,
    contentId: string,
    location: ItemInstance['location'],
    overrides: Partial<ItemInstance> = {},
  ): ItemInstance {
    return {
      itemId,
      contentId,
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location,
      ...overrides,
    };
  }

  function scroll(): ItemInstance {
    return item(SCROLL_ID, SCROLL_CONTENT_ID, { type: 'backpack', actorId: HERO_ID });
  }

  /** A hero-owned, content-bound run carrying exactly `items` (plus the scroll), suitable for
   * `resolveCommand`'s `validateContentBoundRun` gate: real `contentHash`, an identification map
   * allocated against the real pack, and one current encounter decision per authored encounter. */
  function heroRun(items: readonly ItemInstance[]): ActiveRun {
    const base = createDemoRun();
    const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
    return {
      ...base,
      contentHash: pack.hash,
      identification: identified.identification,
      rng: identified.rng,
      encounterDecisions: pack.entries
        .filter((entry) => entry.kind === 'encounter')
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((entry) => ({
          encounterId: entry.id,
          baseProbability: entry.runAppearanceChance,
          protectionBonus: 0,
          effectiveProbability: entry.runAppearanceChance,
          eligible: true,
          reachedEligibleDepth: false,
          encountered: false,
          instancesCreated: 0,
        })),
      items: [...items, scroll()].sort((left, right) => (left.itemId < right.itemId ? -1 : 1)),
    };
  }

  /** Plain iron swords (an ordinary enchantable weapon) at the given itemIds, equipped before
   * backpack -- mirrors the scroll's own targeting convention under test. */
  function heroWith(
    setup: Readonly<{ equipped?: readonly string[]; backpack?: readonly string[] }>,
  ): ActiveRun {
    // `validateContentBoundRun` only checks that each item's own slot is one its definition
    // allows -- it never checks cross-item slot uniqueness against `hero.equipment` -- so every
    // equipped iron sword can legally share `main-hand` here; targeting order is what is under
    // test, not equipment-slot bookkeeping.
    const equipped = (setup.equipped ?? []).map((itemId) =>
      item(itemId, SWORD_CONTENT_ID, {
        type: 'equipped',
        actorId: HERO_ID,
        slot: 'main-hand',
      }),
    );
    const backpack = (setup.backpack ?? []).map((itemId) =>
      item(itemId, SWORD_CONTENT_ID, { type: 'backpack', actorId: HERO_ID }),
    );
    return heroRun([...equipped, ...backpack]);
  }

  function readScroll(run: ActiveRun): ActiveRun {
    const resolved = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.temper',
        expectedRevision: run.revision,
        itemId: SCROLL_ID,
        target: null,
      },
      { content: pack },
    );
    if (resolved.result.status !== 'applied') {
      throw new Error(`fixture readScroll failed: ${stableJson(resolved.result)}`);
    }
    return resolved.state;
  }

  function readTemperingScroll(run: ActiveRun) {
    return {
      type: 'use-item' as const,
      commandId: 'command.temper',
      expectedRevision: run.revision,
      itemId: SCROLL_ID,
      target: null,
    };
  }

  function enchantmentOf(run: ActiveRun, itemId: string) {
    return run.items.find((candidate) => candidate.itemId === itemId)!.enchantment;
  }

  it('enchants the first eligible item, equipped before backpack, by itemId order', () => {
    const run = heroWith({
      equipped: ['item.b.0002', 'item.a.0003'],
      backpack: ['item.a.0001'],
    });
    const resolved = readScroll(run);
    expect(enchantmentOf(resolved, 'item.a.0003')).not.toBeNull(); // equipped wins over backpack
    expect(enchantmentOf(resolved, 'item.a.0001')).toBeNull();
    const identified = resolved.items.find((candidate) => candidate.itemId === 'item.a.0003')!;
    expect(identified.identified).toBe(true);
  });

  it('skips artifacts and revealed-cursed items when choosing a target', () => {
    const artifactId = 'item.hero.artifact';
    const revealedCursedSwordId = 'item.hero.cursed-sword';
    const ironSwordId = 'item.hero.sword';
    const run = heroRun([
      item(artifactId, ARTIFACT_CONTENT_ID, {
        type: 'equipped',
        actorId: HERO_ID,
        slot: 'left-ring',
      }),
      item(
        revealedCursedSwordId,
        SWORD_CONTENT_ID,
        { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
        { curse: { curseId: CURSE_ID, revealed: true } },
      ),
      item(ironSwordId, SWORD_CONTENT_ID, {
        type: 'equipped',
        actorId: HERO_ID,
        slot: 'main-hand',
      }),
    ]);
    const resolved = readScroll(run);
    expect(enchantmentOf(resolved, ironSwordId)).not.toBeNull();
    expect(enchantmentOf(resolved, artifactId)).toBeNull();
    expect(enchantmentOf(resolved, revealedCursedSwordId)).toBeNull();
  });

  it('skips a wielded heirloom-provenance item and targets the next eligible item', () => {
    const heirloomSwordId = 'item.hero.heirloom-sword';
    const ironSwordId = 'item.hero.sword';
    // A recovered heirloom the hero is WIELDING is otherwise the scroll's preferred target
    // (equipped-first ordering) -- its identity IS its recorded provenance, so it must never be
    // the one the scroll touches. Exercised directly against the pure targeting function: a
    // hand-placed `.heirloom` item cannot round-trip `resolveCommand`'s content-bound haunts
    // provenance cross-check (it only recognizes items the haunts drop machinery itself created),
    // and that check is orthogonal to what this test is proving.
    const heirloom: HeirloomItemMetadata = {
      displayName: 'Ancestral Blade',
      glyph: ')',
      color: '#ddeeff',
      originatingHallRecordId: `record.${'a'.repeat(32)}.${'b'.repeat(16)}`,
      originatingRank: 1,
      sourceItemId: 'item.original.0001',
    };
    const items: readonly ItemInstance[] = [
      item(
        heirloomSwordId,
        SWORD_CONTENT_ID,
        { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
        { heirloom },
      ),
      item(ironSwordId, SWORD_CONTENT_ID, { type: 'backpack', actorId: HERO_ID }),
    ];
    expect(firstEnchantableItemId(pack, items, HERO_ID)).toBe(ironSwordId);
  });

  it('identifies completely and reveals the curse when enchanting an unrevealed-cursed item, never leaving identified: true with curse.revealed: false', () => {
    const unrevealedCursedSwordId = 'item.hero.unrevealed-cursed-sword';
    const run = heroRun([
      item(
        unrevealedCursedSwordId,
        SWORD_CONTENT_ID,
        { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
        { identified: false, curse: { curseId: CURSE_ID, revealed: false } },
      ),
    ]);
    const resolved = readScroll(run);
    const enchanted = resolved.items.find(
      (candidate) => candidate.itemId === unrevealedCursedSwordId,
    )!;
    // The #121 invariant every identify path reveals: identified and curse.revealed rise
    // together, never `identified: true` with a hidden curse.
    expect(enchanted.identified).toBe(true);
    expect(enchanted.curse).toEqual({ curseId: CURSE_ID, revealed: true });
    expect(enchanted.enchantment).not.toBeNull();
    // item.iron-sword identifies per-instance (mode: instance, no shared appearance pool), so
    // there is nothing for the appearance step to touch -- bookkeeping stays exactly as it was.
    expect(resolved.identification).toEqual(run.identification);
  });

  it('rejects the read and consumes nothing when no item is eligible', () => {
    const state = heroRun([
      item('item.hero.potion', POTION_CONTENT_ID, { type: 'backpack', actorId: HERO_ID }),
    ]);
    const resolved = resolveCommand(state, readTemperingScroll(state), { content: pack });
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'target.invalid' });
    expect(
      resolved.state.items.some((item) => item.contentId === 'item.tempering-steel-scroll'),
    ).toBe(true);
    expect(resolved.state.rng.enchanting).toEqual(state.rng.enchanting);
  });

  it('re-enchants an already-enchanted item', () => {
    const ironSwordId = 'item.hero.sword';
    const run = heroRun([
      item(
        ironSwordId,
        SWORD_CONTENT_ID,
        { type: 'equipped', actorId: HERO_ID, slot: 'main-hand' },
        {
          enchantment: { enchantmentId: 'enchantment.keen-edge', modifiers: { meleeAccuracy: 1 } },
        },
      ),
    ]);
    const resolved = readScroll(run);
    expect(enchantmentOf(resolved, ironSwordId)).not.toBeNull();
  });

  it('draws on the enchanting stream only', () => {
    const before = heroWith({ equipped: ['item.hero.sword'] });
    const after = readScroll(before);
    for (const stream of RNG_STREAM_NAMES.filter(
      (name) => name !== 'enchanting' && name !== 'effects',
    )) {
      expect(after.rng[stream]).toEqual(before.rng[stream]);
    }
  });
});
