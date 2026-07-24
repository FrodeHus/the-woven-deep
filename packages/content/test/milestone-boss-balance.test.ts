import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EncounterContentEntry, ItemContentEntry, MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

const BOSSES = ['monster.ashfather', 'monster.tide-sovereign', 'monster.heart-herald'] as const;
const REWARDS = ['item.ashfather-cinder', 'item.tide-crown', 'item.herald-sigil'] as const;
const ENCOUNTERS = [
  'encounter.ashfather',
  'encounter.tide-sovereign',
  'encounter.heart-herald',
] as const;

async function pack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

describe('milestone boss balance', () => {
  it('threat ascends 5 -> 10 -> 15 and stays under the depth-20 Heart', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const threats = BOSSES.map((id) => (byId.get(id) as MonsterContentEntry).threat);
    const heart = (byId.get('monster.weakened-heart') as MonsterContentEntry).threat;
    expect(heart).toBe(20);
    for (let i = 1; i < threats.length; i += 1)
      expect(threats[i]!).toBeGreaterThan(threats[i - 1]!);
    for (const threat of threats) expect(threat).toBeLessThan(heart);
  });

  it('health is monotonic among the three bosses', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const health = BOSSES.map((id) => (byId.get(id) as MonsterContentEntry).health);
    for (let i = 1; i < health.length; i += 1) expect(health[i]!).toBeGreaterThan(health[i - 1]!);
  });

  it('rewards stay under the heart-cinder combat budget and are non-decreasing', async () => {
    const byId = new Map((await pack()).entries.map((entry) => [entry.id, entry]));
    const budget = (id: string) => {
      const combat = (byId.get(id) as ItemContentEntry).combat!;
      return combat.accuracy + combat.defense + combat.armor;
    };
    const cinder = budget('item.heart-cinder');
    expect(cinder).toBe(3);
    const budgets = REWARDS.map(budget);
    for (const value of budgets) expect(value).toBeLessThan(cinder);
    for (let i = 1; i < budgets.length; i += 1)
      expect(budgets[i]!).toBeGreaterThanOrEqual(budgets[i - 1]!);
    for (const id of REWARDS) expect((byId.get(id) as ItemContentEntry).price).toBeLessThan(260);
  });

  it('each boss encounter has two descending-threshold phases and resolvable rewards', async () => {
    const entries = (await pack()).entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of ENCOUNTERS) {
      const encounter = byId.get(id) as EncounterContentEntry;
      expect(encounter.model).toBe('boss');
      if (encounter.model !== 'boss') continue;
      const { phases, uniqueItemId, enhancedLootTableId } = encounter.definition;
      expect(phases).toHaveLength(2);
      expect(phases[1]!.healthThresholdPercent).toBeLessThan(phases[0]!.healthThresholdPercent);
      expect(byId.get(uniqueItemId)).toBeDefined();
      expect(byId.get(enhancedLootTableId)).toBeDefined();
    }
  });
});
