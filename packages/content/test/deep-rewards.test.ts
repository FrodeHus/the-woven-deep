import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemContentEntry, LootTableContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('deep reward relics and merchant tiers', () => {
  it('compiles two deep reward rings gated by depth', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const signet = byId.get('item.bound-signet') as ItemContentEntry;
    const heartstone = byId.get('item.echo-heartstone') as ItemContentEntry;
    expect(signet.category).toBe('ring');
    expect(signet.minDepth).toBe(13);
    expect(signet.price).toBeGreaterThan(0);
    expect(heartstone.minDepth).toBe(15);
    expect(heartstone.rarity).toBe('legendary');
    // Reward relics must be sellable without tripping reserved-tag merchant rules.
    for (const item of [signet, heartstone]) {
      for (const reserved of ['heirloom', 'quest', 'objective', 'nontransferable']) {
        expect(item.tags).not.toContain(reserved);
      }
    }
  });

  it('keeps the relics out of ordinary loot now that they are artifacts, and the town restocks at the right depths', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const table = (id: string): LootTableContentEntry =>
      pack.entries.find(
        (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === id,
      )!;
    const choice = (id: string, contentId: string) =>
      table(id).choices.find((entry) => entry.contentId === contentId);
    // Artifacts are forbidden from ordinary loot graphs (Task 1 validation); the vault-pool
    // offer path replaces family kill-loot and town restocks for these two relics.
    expect(choice('loot-table.the-bound', 'item.bound-signet')).toBeUndefined();
    expect(choice('loot-table.echo-wrought', 'item.echo-heartstone')).toBeUndefined();
    expect(choice('loot-table.town-curios', 'item.echo-heartstone')).toBeUndefined();
    expect(choice('loot-table.town-arms', 'item.bound-signet')).toBeUndefined();
    expect(choice('loot-table.town-provisioner', 'item.ashen-potion')).toMatchObject({
      minDepth: 15,
    });
  });

  it('keeps the deep reward rings weaker than the final-boss ring (heart-cinder)', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const heartCinder = byId.get('item.heart-cinder') as ItemContentEntry;
    const signet = byId.get('item.bound-signet') as ItemContentEntry;
    const heartstone = byId.get('item.echo-heartstone') as ItemContentEntry;

    const combatTotal = (item: ItemContentEntry) =>
      (item.combat!.accuracy ?? 0) + (item.combat!.defense ?? 0) + (item.combat!.armor ?? 0);
    const cinderTotal = combatTotal(heartCinder);

    for (const relic of [signet, heartstone]) {
      expect(relic.combat!.accuracy).toBeLessThanOrEqual(heartCinder.combat!.accuracy);
      expect(relic.combat!.defense).toBeLessThanOrEqual(heartCinder.combat!.defense);
      expect(relic.combat!.armor).toBeLessThanOrEqual(heartCinder.combat!.armor);
      expect(combatTotal(relic)).toBeLessThan(cinderTotal);
      expect(relic.price).toBeLessThan(heartCinder.price);
    }
  });
});
