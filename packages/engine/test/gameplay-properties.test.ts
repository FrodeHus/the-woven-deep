import fc from 'fast-check';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  advanceToNextReady,
  createDemoContentPack,
  createDemoRun,
  mergeStacks,
  selectReadyActor,
  splitStack,
  stableJson,
  type ItemInstance,
  itemLightSources,
  advanceSurvival,
  tickConditions,
  hungerStage,
  refuelItem,
  projectGameplayState,
  createGameplayDemoRun,
  resolveCommand,
  validateActiveRun,
  validateContentBoundRun,
  type ActiveRun,
  type Direction,
  type GameCommand,
} from '../src/index.js';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { actor, schedulerStateArbitrary } from './arbitraries.js';

let gameplayPack: CompiledContentPack;
let gameplayRun: ActiveRun;

beforeAll(async () => {
  gameplayPack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  gameplayRun = createGameplayDemoRun(gameplayPack).run;
});

const directions: readonly Direction[] = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
];

function assertEquipmentConsistent(state: ActiveRun): void {
  const items = new Map(state.items.map((item) => [item.itemId, item]));
  for (const actorState of state.actors) {
    for (const [slot, itemId] of Object.entries(actorState.equipment)) {
      if (itemId === null) continue;
      expect(items.get(itemId)?.location).toEqual({
        type: 'equipped',
        actorId: actorState.actorId,
        slot,
      });
    }
  }
  for (const item of state.items) {
    expect(item.quantity).toBeGreaterThan(0);
    if (item.location.type !== 'equipped') continue;
    const owner = state.actors.find((candidate) => candidate.actorId === item.location.actorId);
    expect(owner?.equipment[item.location.slot]).toBe(item.itemId);
  }
}

describe('cross-system gameplay sequence properties', () => {
  it('keeps the shrunk revealed-passage sequence saveable', () => {
    let state = structuredClone(gameplayRun);
    for (const [index, actionName] of ['wait', 'wait', 'north', 'wait', 'wait'].entries()) {
      const command = {
        ...(actionName === 'north' ? { type: 'move', direction: 'north' } : { type: 'wait' }),
        commandId: `command.revealed-passage-${index}`,
        expectedRevision: state.revision,
      } as GameCommand;
      state = resolveCommand(state, command, { content: gameplayPack }).state;
    }
    expect(validateActiveRun(state)).toEqual(state);
  });

  it('preserves saves, content bounds, resources, equipment, reactions, and hidden state', () => {
    const action = fc.oneof(
      fc.constant('wait' as const),
      fc.constant('search' as const),
      fc.constantFrom(...directions),
    );
    fc.assert(
      fc.property(fc.array(action, { minLength: 1, maxLength: 10 }), (actions) => {
        let state = structuredClone(gameplayRun);
        for (const [index, actionName] of actions.entries()) {
          const previousWorldTime = state.worldTime;
          const command = {
            ...(actionName === 'wait' || actionName === 'search'
              ? { type: actionName }
              : { type: 'move', direction: actionName }),
            commandId: `command.property-${index}`,
            expectedRevision: state.revision,
          } as GameCommand;
          const resolution = resolveCommand(state, command, { content: gameplayPack });
          state = resolution.state;
          expect(validateActiveRun(state)).toEqual(state);
          expect(() => validateContentBoundRun(state, gameplayPack)).not.toThrow();
          expect(state.worldTime).toBeGreaterThanOrEqual(previousWorldTime);
          assertEquipmentConsistent(state);
          for (const reaction of resolution.events.filter(
            (event) => event.type === 'reaction.triggered',
          )) {
            const reactor = state.actors.find(
              (candidate) => candidate.actorId === reaction.actorId,
            );
            expect(reactor?.disposition).toBe('hostile');
          }
          const projection = stableJson(projectGameplayState({ state, content: gameplayPack }));
          expect(projection).not.toContain('appearanceByContentId');
          expect(projection).not.toContain('rng');
        }
      }),
      { seed: 0x4a09, numRuns: 500 },
    );
  }, 120_000);
});

describe('gameplay scheduler properties', () => {
  it('always selects a living actor with safe integer state without mutating its input', () => {
    fc.assert(
      fc.property(schedulerStateArbitrary, (state) => {
        const before = structuredClone(state);
        const result = advanceToNextReady(state);
        expect(state).toEqual(before);
        expect(Number.isSafeInteger(result.worldTime)).toBe(true);
        expect(result.actors.every((candidate) => Number.isSafeInteger(candidate.energy))).toBe(
          true,
        );
        expect(result.selectedActorId).not.toBeNull();
      }),
      { seed: 0x4a01, numRuns: 500 },
    );
  });

  it('selects the same actor for every input order', () => {
    fc.assert(
      fc.property(schedulerStateArbitrary, fc.integer(), (state, offset) => {
        const pivot = Math.abs(offset) % state.actors.length;
        const permuted = [...state.actors.slice(pivot), ...state.actors.slice(0, pivot)].reverse();
        expect(selectReadyActor(permuted, state.content)?.actorId).toBe(
          selectReadyActor(state.actors, state.content)?.actorId,
        );
        expect(advanceToNextReady({ ...state, actors: permuted }).selectedActorId).toBe(
          advanceToNextReady(state).selectedActorId,
        );
      }),
      { seed: 0x4a02, numRuns: 500 },
    );
  });

  it('fails deterministically when advancing world time would overflow', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: 99 }),
        fc.integer({ min: 1, max: 400 }),
        (energy, speed) => {
          const state = {
            worldTime: Number.MAX_SAFE_INTEGER,
            content: createDemoContentPack(),
            actors: [
              actor({ actorId: 'hero.test', playerControlled: true, health: 10, energy, speed }),
            ],
          };
          expect(() => advanceToNextReady(state)).toThrow(/worldTime.*safe integer/i);
        },
      ),
      { seed: 0x4a03, numRuns: 500 },
    );
  });
});

describe('public projection properties', () => {
  it('is unaffected by hidden actors, features, identification assignments, and random streams', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer(), fc.integer(), fc.integer(), fc.integer()),
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
        (rng, suffix) => {
          const base = createDemoRun();
          const hidden = {
            ...base.actors[0]!,
            actorId: `hidden.${suffix}`,
            contentId: `monster.${suffix}`,
            playerControlled: false,
            disposition: 'hostile' as const,
            x: 5,
            y: 3,
          };
          const secret = {
            featureId: `secret.${suffix}`,
            floorId: 'floor.demo',
            x: 5,
            y: 3,
            contentId: null,
            coverTileId: 1 as const,
            type: 'secret' as const,
            state: 'hidden' as const,
            discoveryDifficulty: 10,
            discovery: {
              discoveredByActorIds: [],
              progressByActorId: {},
              attemptedContextKeys: [],
            },
          };
          const content = createDemoContentPack();
          const changed = {
            ...base,
            actors: [...base.actors, hidden],
            features: [secret],
            rng: { ...base.rng, combat: rng },
            identification: {
              ...base.identification,
              appearanceByContentId: { [`item.${suffix}`]: `appearance.${suffix}` },
            },
          };
          expect(stableJson(projectGameplayState({ state: changed, content }))).toBe(
            stableJson(projectGameplayState({ state: base, content })),
          );
        },
      ),
      { seed: 0x4a08, numRuns: 200 },
    );
  });
});

describe('inventory conservation properties', () => {
  const definition: ItemContentEntry = {
    kind: 'item',
    id: 'item.property',
    name: 'Property item',
    glyph: '*',
    color: '#ffffff',
    tags: [],
    category: 'misc',
    stackLimit: 100,
    price: 1,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
  const content = (() => {
    const base = createDemoContentPack();
    return { ...base, entries: [...base.entries, definition] };
  })();

  it('conserves quantity and stable output across legal split-merge sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.integer({ min: 1, max: 99 }),
        (quantity, candidateSplit) => {
          const splitQuantity = 1 + (candidateSplit % (quantity - 1));
          const instance: ItemInstance = {
            itemId: 'item.property.1',
            contentId: definition.id,
            quantity,
            condition: 100,
            enchantment: null,
            identified: true,
            charges: null,
            fuel: null,
            enabled: null,
            location: { type: 'backpack', actorId: 'hero.demo' },
          };
          const run = { ...createDemoRun(), items: [instance] };
          const before = stableJson(run);
          const first = splitStack({
            run,
            content,
            actorId: 'hero.demo',
            itemId: instance.itemId,
            quantity: splitQuantity,
            newItemId: 'item.property.2',
          });
          expect(first.ok).toBe(true);
          if (!first.ok) return;
          expect(first.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(quantity);
          const second = mergeStacks({
            run: first.run,
            content,
            actorId: 'hero.demo',
            leftItemId: 'item.property.1',
            rightItemId: 'item.property.2',
          });
          expect(second.ok).toBe(true);
          if (!second.ok) return;
          expect(second.items).toEqual([instance]);
          expect(stableJson(run)).toBe(before);
          expect(
            stableJson(
              splitStack({
                run,
                content,
                actorId: 'hero.demo',
                itemId: instance.itemId,
                quantity: splitQuantity,
                newItemId: 'item.property.2',
              }),
            ),
          ).toBe(stableJson(first));
        },
      ),
      { seed: 0x4a04, numRuns: 500 },
    );
  });
});

describe('item light properties', () => {
  it('never emits light from a backpack, empty fuel, or a disabled item', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom('backpack', 'equipped', 'floor'),
        (enabled, fuel, locationType) => {
          const definition: ItemContentEntry = {
            kind: 'item',
            id: 'item.light-property',
            name: 'Property light',
            glyph: 'i',
            color: '#ffffff',
            tags: [],
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
              color: [255, 255, 255],
              radius: 3,
              strength: 100,
              fuelCapacity: 100,
              fuelPerTime: 1,
              warningThresholds: [10],
              fuelTags: ['oil'],
            },
            identification: { mode: 'known', poolId: null },
            effects: [],
          };
          const base = createDemoRun();
          const location =
            locationType === 'backpack'
              ? { type: 'backpack' as const, actorId: 'hero.demo' }
              : locationType === 'equipped'
                ? { type: 'equipped' as const, actorId: 'hero.demo', slot: 'off-hand' as const }
                : { type: 'floor' as const, floorId: 'floor.demo', x: 1, y: 1 };
          const instance: ItemInstance = {
            itemId: 'item.light-property.1',
            contentId: definition.id,
            quantity: 1,
            condition: 100,
            enchantment: null,
            identified: true,
            charges: null,
            fuel,
            enabled,
            location,
          };
          const content = {
            ...createDemoContentPack(),
            entries: [...createDemoContentPack().entries, definition],
          };
          const emitted = itemLightSources({
            run: { ...base, items: [instance] },
            content,
            floorId: 'floor.demo',
          });
          expect(emitted.length).toBe(enabled && fuel > 0 && locationType !== 'backpack' ? 1 : 0);
        },
      ),
      { seed: 0x4a05, numRuns: 500 },
    );
  });
});

describe('survival resource properties', () => {
  const lightDefinition: ItemContentEntry = {
    kind: 'item',
    id: 'item.survival-light',
    name: 'Survival light',
    glyph: 'i',
    color: '#ffffff',
    tags: [],
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
      color: [255, 255, 255],
      radius: 3,
      strength: 100,
      fuelCapacity: 100,
      fuelPerTime: 2,
      warningThresholds: [50, 10],
      fuelTags: ['oil'],
    },
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
  const fuelDefinition: ItemContentEntry = {
    ...lightDefinition,
    id: 'item.oil',
    name: 'Oil',
    category: 'fuel',
    stackLimit: 100,
    tags: ['oil'],
    equipment: null,
    light: null,
  };
  const baseContent = createDemoContentPack();
  const balance = baseContent.entries.find((entry) => entry.kind === 'balance')!;
  const propertyBalance = {
    ...balance,
    hungerMaximum: 100,
    hungerThresholds: { hungry: 70, weak: 30, starving: 0 },
  };
  const content = {
    ...baseContent,
    entries: [
      propertyBalance,
      ...baseContent.entries.filter((entry) => entry.kind !== 'balance'),
      lightDefinition,
      fuelDefinition,
    ],
  };

  it('keeps hunger and fuel bounded with stable deterministic output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        fc.constantFrom('backpack', 'equipped', 'floor'),
        (reserve, fuel, elapsed, enabled, locationType) => {
          const base = createDemoRun();
          const location =
            locationType === 'backpack'
              ? { type: 'backpack' as const, actorId: 'hero.demo' }
              : locationType === 'equipped'
                ? { type: 'equipped' as const, actorId: 'hero.demo', slot: 'off-hand' as const }
                : { type: 'floor' as const, floorId: 'floor.demo', x: 1, y: 1 };
          const item: ItemInstance = {
            itemId: 'item.survival-light.1',
            contentId: lightDefinition.id,
            quantity: 1,
            condition: 100,
            enchantment: null,
            identified: true,
            charges: null,
            fuel,
            enabled,
            location,
          };
          const input = {
            state: {
              ...base,
              worldTime: elapsed,
              items: [item],
              survival: {
                ...base.survival,
                hungerReserve: reserve,
                hungerStage: hungerStage({ reserve, thresholds: propertyBalance.hungerThresholds }),
              },
            },
            content,
            elapsed,
            eventId: 'event.property',
            danger: true,
            tickConditions,
            mitigationFor: () => ({ armor: 0, resistance: 0, immune: false }),
          };
          const result = advanceSurvival(input);
          expect(result.state.survival.hungerReserve).toBeGreaterThanOrEqual(0);
          expect(result.state.survival.hungerReserve).toBeLessThanOrEqual(reserve);
          expect(result.state.items[0]!.fuel).toBeGreaterThanOrEqual(0);
          const shouldDrain = enabled && fuel > 0 && locationType !== 'backpack';
          expect(result.state.items[0]!.fuel).toBe(
            shouldDrain ? Math.max(0, fuel - elapsed * 2) : fuel,
          );
          expect(stableJson(advanceSurvival(input))).toBe(stableJson(result));
        },
      ),
      { seed: 0x4a06, numRuns: 500 },
    );
  });

  it('conserves units when refueling into limited capacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 1, max: 100 }),
        (targetFuel, sourceQuantity) => {
          const base = createDemoRun();
          const target: ItemInstance = {
            itemId: 'light.1',
            contentId: lightDefinition.id,
            quantity: 1,
            condition: 100,
            enchantment: null,
            identified: true,
            charges: null,
            fuel: targetFuel,
            enabled: false,
            location: { type: 'backpack', actorId: 'hero.demo' },
          };
          const source: ItemInstance = {
            ...target,
            itemId: 'oil.1',
            contentId: fuelDefinition.id,
            quantity: sourceQuantity,
            fuel: null,
            enabled: null,
          };
          const result = refuelItem({
            run: { ...base, items: [target, source] },
            content,
            actorId: 'hero.demo',
            itemId: target.itemId,
            fuelItemId: source.itemId,
            quantity: sourceQuantity,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const remaining =
            result.run.items.find((item) => item.itemId === source.itemId)?.quantity ?? 0;
          const filled = result.run.items.find((item) => item.itemId === target.itemId)!.fuel!;
          expect(remaining + filled).toBe(sourceQuantity + targetFuel);
        },
      ),
      { seed: 0x4a07, numRuns: 500 },
    );
  });
});
