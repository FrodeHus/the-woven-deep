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

  it('wires the relics into family kill-loot and the town restocks at the right depths', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const table = (id: string): LootTableContentEntry =>
      pack.entries.find(
        (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === id,
      )!;
    const choice = (id: string, contentId: string) =>
      table(id).choices.find((entry) => entry.contentId === contentId);
    expect(choice('loot-table.the-bound', 'item.bound-signet')).toMatchObject({ minDepth: 13 });
    expect(choice('loot-table.echo-wrought', 'item.echo-heartstone')).toMatchObject({
      minDepth: 15,
    });
    expect(choice('loot-table.town-curios', 'item.echo-heartstone')).toMatchObject({
      minDepth: 15,
    });
    expect(choice('loot-table.town-arms', 'item.bound-signet')).toMatchObject({ minDepth: 13 });
    expect(choice('loot-table.town-provisioner', 'item.ashen-potion')).toMatchObject({
      minDepth: 15,
    });
  });
});
