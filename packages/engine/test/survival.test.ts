import { describe, expect, it } from 'vitest';
import type { BalanceContentEntry, ItemContentEntry } from '@woven-deep/content';
import {
  advanceSurvival,
  createDemoContentPack,
  createDemoRun,
  hungerStage,
  resolveEffectSequence,
  tickConditions,
  type ItemInstance,
  validateContentBoundRun,
  hungerModifiers,
} from '../src/index.js';

const noMitigation = () => ({ armor: 0, resistance: 0, immune: false });

const thresholds = { hungry: 70, weak: 30, starving: 0 } as const;

function balance(overrides: Partial<BalanceContentEntry> = {}): BalanceContentEntry {
  const base = createDemoContentPack().entries.find((entry) => entry.kind === 'balance')!;
  return {
    ...base,
    hungerMaximum: 100,
    hungerThresholds: thresholds,
    recoveryInterval: 5,
    recoveryAmount: 2,
    recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 },
    ...overrides,
  } as BalanceContentEntry;
}

function light(): ItemContentEntry {
  return {
    kind: 'item',
    id: 'item.torch',
    name: 'Torch',
    glyph: 'i',
    color: '#ffffff',
    tags: ['torch'],
    category: 'light',
    stackLimit: 1,
    price: 1,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: null,
    light: {
      color: [255, 180, 100],
      radius: 4,
      strength: 120,
      fuelCapacity: 20,
      fuelPerTime: 1,
      warningThresholds: [10, 5],
      fuelTags: ['oil'],
    },
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
}

function fixture(
  overrides: Readonly<{ elapsed?: number; hunger?: number; fuel?: number; enabled?: boolean }> = {},
) {
  const elapsed = overrides.elapsed ?? 7;
  const base = createDemoRun();
  const definition = light();
  const item: ItemInstance = {
    itemId: 'torch.1',
    contentId: definition.id,
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: overrides.fuel ?? 12,
    enabled: overrides.enabled ?? true,
    location: { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' },
  };
  const content = {
    ...createDemoContentPack(),
    entries: [
      balance(),
      ...createDemoContentPack().entries.filter((entry) => entry.kind !== 'balance'),
      definition,
    ],
  };
  const state = {
    ...base,
    worldTime: elapsed,
    items: [item],
    survival: {
      ...base.survival,
      hungerReserve: overrides.hunger ?? 20,
      hungerStage: hungerStage({ reserve: overrides.hunger ?? 20, thresholds }),
    },
  };
  return {
    state,
    content,
    elapsed,
    eventId: 'event.survival',
    danger: false,
    tickConditions,
    mitigationFor: noMitigation,
  };
}

describe('survival clocks', () => {
  it.each([
    [80, 'sated'],
    [50, 'hungry'],
    [20, 'weak'],
    [0, 'starving'],
  ] as const)('maps reserve %i to %s', (reserve, stage) => {
    expect(hungerStage({ reserve, thresholds })).toBe(stage);
  });

  it('uses the loaded hunger-stage modifiers without hidden constants', () => {
    const configured = balance({
      hungerStageModifiers: {
        sated: {},
        hungry: {},
        weak: { defense: -3 },
        starving: { defense: -6 },
      },
    });
    expect(hungerModifiers({ stage: 'weak', balance: configured })).toEqual({ defense: -3 });
  });

  it('drains hunger and active light fuel by exact elapsed world time', () => {
    const result = advanceSurvival(fixture());
    expect(result.state.survival.hungerReserve).toBe(13);
    expect(result.state.items.find((item) => item.itemId === 'torch.1')?.fuel).toBe(5);
    expect(result.events.filter((event) => event.type === 'fuel.warning')).toHaveLength(2);
  });

  it('emits skipped hunger stages once in deterioration order', () => {
    const input = fixture({ elapsed: 90, hunger: 80 });
    const first = advanceSurvival(input);
    const second = advanceSurvival({ ...input, state: { ...first.state, worldTime: 180 } });
    expect(
      first.events
        .filter((event) => event.type === 'hunger.stage-changed')
        .map((event) => event.stage),
    ).toEqual(['hungry', 'weak', 'starving']);
    expect(second.events.some((event) => event.type === 'hunger.stage-changed')).toBe(false);
  });

  it('does not drain disabled or backpack light items', () => {
    const disabled = fixture({ enabled: false });
    const backpack = fixture();
    const item = backpack.state.items[0]!;
    const result = advanceSurvival({
      ...backpack,
      state: {
        ...backpack.state,
        items: [{ ...item, location: { type: 'backpack', actorId: 'hero.demo' } }],
      },
    });
    expect(advanceSurvival(disabled).state.items[0]?.fuel).toBe(12);
    expect(result.state.items[0]?.fuel).toBe(12);
  });

  it('restores only effective food reserve at the maximum', () => {
    const input = fixture({ elapsed: 0, hunger: 95 });
    const result = resolveEffectSequence({
      effects: [
        {
          effectId: 'effect.hunger.restore',
          parameters: { amount: 20 },
          requiresLivingTarget: true,
        },
      ],
      actors: input.state.actors,
      items: input.state.items,
      survival: input.state.survival,
      survivalActorId: 'hero.demo',
      content: input.content,
      sourceActorId: 'hero.demo',
      targetActorId: 'hero.demo',
      effectsState: input.state.rng.effects,
      worldTime: 0,
      eventId: 'event.eat',
      forceMoveDirection: { x: 1, y: 0 },
      operations: {},
    });
    expect(result.survival.hungerReserve).toBe(100);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'hunger.restored', amount: 5 }),
    );
  });

  it('regenerates Weave over crossed intervals and clamps it to the derived maximum', () => {
    const input = fixture({ elapsed: 10, hunger: 90 });
    const trickle = { ...input.state.actors[0]!, weave: 5, maxWeave: 14 };
    const regenerated = advanceSurvival({
      ...input,
      state: { ...input.state, actors: [trickle] },
    });
    // weaveRegenAmount 2 across 2 crossed recovery intervals (interval 5, elapsed 10) -> +4.
    expect(regenerated.state.actors[0]?.weave).toBe(9);

    const nearFull = { ...input.state.actors[0]!, weave: 13, maxWeave: 14 };
    const clamped = advanceSurvival({
      ...input,
      state: { ...input.state, actors: [nearFull] },
    });
    expect(clamped.state.actors[0]?.weave).toBe(14);
  });

  it('boosts Weave regen by the hero derived-stat modifiers, still clamped to the derived maximum', () => {
    const input = fixture({ elapsed: 10, hunger: 90 });
    const trickle = { ...input.state.actors[0]!, weave: 5, maxWeave: 20 };
    const boosted = advanceSurvival({
      ...input,
      state: {
        ...input.state,
        hero: { ...input.state.hero, statModifiers: { weaveRegen: 2 } },
        actors: [trickle],
      },
    });
    // Base weaveRegenAmount 2 + a +2 weaveRegen modifier = 4/interval, across 2 crossed
    // recovery intervals (interval 5, elapsed 10) -> +8.
    expect(boosted.state.actors[0]?.weave).toBe(13);

    const nearFull = { ...input.state.actors[0]!, weave: 18, maxWeave: 20 };
    const clamped = advanceSurvival({
      ...input,
      state: {
        ...input.state,
        hero: { ...input.state.hero, statModifiers: { weaveRegen: 2 } },
        actors: [nearFull],
      },
    });
    expect(clamped.state.actors[0]?.weave).toBe(20);
  });

  it('recovers on crossed absolute intervals only when safe and sufficiently fed', () => {
    const input = fixture({ elapsed: 10, hunger: 90 });
    const actor = { ...input.state.actors[0]!, health: 10 };
    const recovered = advanceSurvival({ ...input, state: { ...input.state, actors: [actor] } });
    const danger = advanceSurvival({
      ...input,
      danger: true,
      state: { ...input.state, actors: [actor] },
    });
    expect(recovered.state.actors[0]?.health).toBe(14);
    expect(danger.state.actors[0]?.health).toBe(10);
  });

  it('recovers at the hungry stage once recoveryAmount matches the fixed content value', () => {
    const demoContent = createDemoContentPack();
    const content = {
      ...demoContent,
      entries: [
        balance({ recoveryAmount: 10, recoveryInterval: 5 }),
        ...demoContent.entries.filter((entry) => entry.kind !== 'balance'),
      ],
    };
    const base = createDemoRun();
    const actor = { ...base.actors[0]!, health: 10 };
    const state = {
      ...base,
      worldTime: 10,
      actors: [actor],
      survival: {
        ...base.survival,
        hungerReserve: 50,
        hungerStage: hungerStage({ reserve: 50, thresholds }),
      },
    };
    const result = advanceSurvival({
      state,
      content,
      elapsed: 10,
      eventId: 'event.survival',
      danger: false,
      tickConditions,
      mitigationFor: noMitigation,
    });
    // hungry recovery percentage is 50; floor(10 * 50 / 100) = 5 per crossed interval, 2 intervals crossed.
    expect(result.state.actors[0]?.health).toBe(20);
  });

  it('does not recover while an active condition blocks recovery', () => {
    const input = fixture({ elapsed: 10, hunger: 90 });
    const condition = {
      kind: 'condition' as const,
      id: 'condition.no-recovery',
      name: 'No recovery',
      description: 'No recovery',
      tags: [],
      color: '#ffffff',
      duration: { mode: 'timed' as const, default: 20, maximum: 20 },
      stacking: { mode: 'refresh' as const, maximumStacks: 1 },
      modifiersPerStack: {},
      traits: ['condition-trait.blocks-recovery' as const],
    };
    const actor = {
      ...input.state.actors[0]!,
      health: 10,
      conditions: [
        { conditionId: condition.id, sourceActorId: null, appliedAt: 0, expiresAt: 20, stacks: 1 },
      ],
    };
    const content = { ...input.content, entries: [...input.content.entries, condition] };
    const result = advanceSurvival({
      ...input,
      content,
      state: { ...input.state, actors: [actor] },
    });
    expect(result.state.actors[0]?.health).toBe(10);
  });

  it('applies starvation damage at saved absolute deadlines', () => {
    const input = fixture({ elapsed: 6, hunger: 0 });
    const state = {
      ...input.state,
      worldTime: 11,
      survival: {
        ...input.state.survival,
        hungerReserve: 0,
        hungerStage: 'starving' as const,
        nextStarvationAt: 7,
      },
    };
    const result = advanceSurvival({ ...input, state, elapsed: 6 });
    expect(result.state.actors[0]?.health).toBe(19);
    expect(result.state.survival.nextStarvationAt).toBe(507);
  });

  it('rejects saved hunger values that disagree with the loaded balance data', () => {
    const input = fixture({ elapsed: 0, hunger: 20 });
    expect(() => validateContentBoundRun(input.state, input.content)).not.toThrow();
    expect(() =>
      validateContentBoundRun(
        {
          ...input.state,
          survival: {
            ...input.state.survival,
            hungerReserve: 101,
          },
        },
        input.content,
      ),
    ).toThrow(/hunger reserve/i);
    expect(() =>
      validateContentBoundRun(
        {
          ...input.state,
          survival: {
            ...input.state.survival,
            hungerStage: 'sated',
          },
        },
        input.content,
      ),
    ).toThrow(/hunger stage/i);
  });
});
