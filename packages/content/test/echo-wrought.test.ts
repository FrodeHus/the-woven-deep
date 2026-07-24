import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonsterContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('Echo-wrought family', () => {
  it('compiles four heavy brutes on the ramp with a legendary capstone under the boss', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const byId = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const ids = [
      'monster.echo-breaker',
      'monster.echo-colossus',
      'monster.echo-harrower',
      'monster.echo-sovereign',
    ];
    for (const id of ids) {
      const monster = byId.get(id) as MonsterContentEntry | undefined;
      expect(monster, id).toBeDefined();
      expect(monster!.lootTableId).toBe('loot-table.echo-wrought');
      expect(monster!.tags).toContain('echo-wrought');
      expect(monster!.armor).toBeGreaterThanOrEqual(5);
      expect(monster!.threat).toBeLessThan(20);
      expect(monster!.health).toBeLessThan(58);
    }
    const sovereign = byId.get('monster.echo-sovereign') as MonsterContentEntry;
    expect(sovereign.threat).toBe(18);
    expect(sovereign.health).toBe(57);
    expect(sovereign.rarity).toBe('legendary');
    expect(sovereign.tags).toEqual(expect.arrayContaining(['elite', 'legendary']));
    expect(byId.get('loot-table.echo-wrought')?.kind).toBe('loot-table');
  });
});
