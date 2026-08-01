import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDemoContentPack,
  createDemoRun,
  createGameplayDemoRun,
  expandLegacySeed,
  resolveCommand,
  resolveEffectSequence,
  type ActorState,
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
  overrides: Readonly<{ actorId?: string; revealed?: boolean }> = {},
): ItemInstance {
  const { actorId = 'hero.demo', revealed = true } = overrides;
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
    location: { type: 'backpack', actorId },
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
