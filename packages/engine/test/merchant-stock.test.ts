import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type ItemContentEntry,
  type MerchantEncounterContentEntry,
} from '@woven-deep/content/compiler';
import {
  createDemoRun,
  materializeMerchant,
  rollDie,
  type ActiveRun,
} from '../src/index.js';

let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;

beforeAll(async () => {
  content = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  encounter = content.entries.find((entry): entry is MerchantEncounterContentEntry =>
    entry.kind === 'encounter' && entry.model === 'merchant')!;
});

function fixture(overrides: Partial<ActiveRun> = {}) {
  const base = createDemoRun();
  return {
    run: { ...base, contentHash: content.hash, worldTime: 1234, ...overrides },
    content,
    encounter,
    populationId: 'population.merchant-test',
    floorId: 'floor.demo',
    position: { x: 4, y: 6 },
  } as const;
}

describe('merchant stock materialization', () => {
  it('is deterministic, owns only merchant-stock RNG, and initializes finite merchant state', () => {
    const input = fixture();
    const first = materializeMerchant(input);
    const second = materializeMerchant(input);
    const lifetime = rollDie(input.run.rng['merchant-stock'],
      encounter.definition.maximumLifetime - encounter.definition.minimumLifetime + 1);

    expect(first).toEqual(second);
    expect(first.population.rolledLifetime).toBe(encounter.definition.minimumLifetime + lifetime.value - 1);
    expect(first.population.departureAt).toBe(input.run.worldTime + first.population.rolledLifetime);
    expect(first.population).toMatchObject({
      lifecycle: 'available', emittedWarningThresholds: [], provoked: false,
      aggressionPenaltyApplied: false, deathPenaltyApplied: false,
      stockLossResolved: false, commerceBonusApplied: false,
    });
    expect(first.actor).toMatchObject({
      actorId: 'actor.population.merchant-test.001', contentId: encounter.definition.npcId,
      floorId: input.floorId, x: 4, y: 6, disposition: 'neutral',
      behaviorId: 'npc-behavior.travelling-merchant', populationId: input.populationId,
      populationPresentation: { name: 'Travelling Lampwright', glyph: 'L', color: '#ffd166', leader: false },
    });
    expect(first.population.initialStockItemIds).toEqual(first.items.map((item) => item.itemId).sort());
    expect(first.population.stockItemIds).toEqual(first.items.map((item) => item.itemId).sort());
    expect(first.items.every((item) => item.location.type === 'merchant-stock'
      && item.location.populationId === input.populationId)).toBe(true);
    expect(first.items.map((item) => item.itemId)).toEqual(first.items.map((_, index) =>
      `item.${input.populationId}.stock.${String(index + 1).padStart(6, '0')}`));
    expect(first.items.every((item) => item.condition === 100 && item.enchantment === null
      && item.charges === null)).toBe(true);
    const itemDefinitions = new Map(content.entries
      .filter((entry): entry is ItemContentEntry => entry.kind === 'item')
      .map((entry) => [entry.id, entry]));
    expect(first.items.every((item) => {
      const definition = itemDefinitions.get(item.contentId)!;
      const depth = input.run.floors.find((floor) => floor.floorId === input.floorId)!.depth;
      return item.quantity >= 1 && item.quantity <= definition.stackLimit
        && depth >= definition.minDepth && depth <= definition.maxDepth;
    })).toBe(true);
    expect(first.services).toBeUndefined();
    expect(first.population.services).toHaveLength(encounter.definition.services.length);
    for (const [index, service] of first.population.services.entries()) {
      const authored = encounter.definition.services[index]!;
      expect(service.remainingUses).toBeGreaterThanOrEqual(authored.minimumUses);
      expect(service.remainingUses).toBeLessThanOrEqual(authored.maximumUses);
    }
    expect(first.nextMerchantStockState).not.toEqual(input.run.rng['merchant-stock']);
  });

  it('filters direct stock choices by floor depth without consuming unrelated streams', () => {
    const depth = 3;
    const eligibleId = 'item.brass-lantern';
    const entries = content.entries.map((entry) => entry.kind === 'item' && entry.id !== eligibleId
      ? { ...entry, minDepth: depth + 1, maxDepth: entry.maxDepth + depth + 1 } as ItemContentEntry
      : entry);
    const input = { ...fixture(), content: { ...content, entries },
      run: { ...fixture().run, floors: fixture().run.floors.map((floor) => ({ ...floor, depth })) } };

    const result = materializeMerchant(input);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.contentId === eligibleId)).toBe(true);
    expect(result.items.every((item) => item.identified === true
      && item.fuel !== null && item.enabled === false)).toBe(true);
    expect(input.run.rng.combat).toEqual(fixture().run.rng.combat);
    expect(input.run.rng.encounters).toEqual(fixture().run.rng.encounters);
    expect(input.run.rng.loot).toEqual(fixture().run.rng.loot);
  });

  it('rejects an empty depth-eligible stock graph before consuming caller state', () => {
    const input = fixture();
    const entries = content.entries.map((entry) => entry.kind === 'item'
      ? { ...entry, minDepth: 99, maxDepth: 100 } as ItemContentEntry : entry);
    const before = JSON.stringify(input.run.rng);

    expect(() => materializeMerchant({ ...input, content: { ...content, entries } }))
      .toThrow(/merchant stock.*eligible/i);
    expect(JSON.stringify(input.run.rng)).toBe(before);
  });
});
