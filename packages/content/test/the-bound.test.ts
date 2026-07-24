import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('The Bound family', () => {
  it('compiles four tiered arcane remnants on the ramp with the family loot table', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const ids = [
      'monster.bound-wretch',
      'monster.bound-shackled',
      'monster.bound-warden',
      'monster.bound-hexbound',
    ];
    for (const id of ids) {
      const monster = byId.get(id) as MonsterContentEntry | undefined;
      expect(monster, id).toBeDefined();
      expect(monster!.kind).toBe('monster');
      expect(monster!.lootTableId).toBe('loot-table.the-bound');
      expect(monster!.behaviorId).toBe('behavior.approach-and-attack');
      expect(monster!.tags).toContain('the-bound');
      // Caster boundary: arcane identity is resistances + tags, never a damage type.
      expect(monster!.resistances.arcane).toBeGreaterThanOrEqual(40);
      expect(monster!.resistances.fire).toBeLessThan(0);
      expect(monster!.threat).toBeLessThan(20);
      expect(monster!.health).toBeLessThan(58);
    }
    expect((byId.get('monster.bound-shackled') as MonsterContentEntry).health).toBe(52);
    expect((byId.get('monster.bound-hexbound') as MonsterContentEntry).threat).toBe(13);
    expect((byId.get('monster.bound-hexbound') as MonsterContentEntry).tags).toContain('caster');
    expect(byId.get('loot-table.the-bound')?.kind).toBe('loot-table');
  });
});
