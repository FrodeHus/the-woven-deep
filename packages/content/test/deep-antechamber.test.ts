import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrapContentEntry, VaultContentEntry } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('deep antechamber vault and warded glyph trap', () => {
  it('compiles the trap with arcane damage and a burning condition', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const trap = pack.entries.find((entry) => entry.id === 'trap.warded-glyph') as
      TrapContentEntry | undefined;
    expect(trap).toBeDefined();
    expect(trap!.discoveryDifficulty).toBe(12);
    expect(trap!.effects).toHaveLength(2);
    expect(trap!.effects[0]!.effectId).toBe('effect.damage');
    expect(trap!.effects[1]!.parameters).toMatchObject({ conditionId: 'condition.burning' });
  });

  it('compiles the vault with a trap slot naming the new trap and a deep item cache', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const vault = pack.entries.find((entry) => entry.id === 'vault.deep-antechamber') as
      VaultContentEntry | undefined;
    expect(vault).toBeDefined();
    expect(vault!.minDepth).toBe(13);
    expect(vault!.maxDepth).toBe(19);
    const slots = Object.values(vault!.legend)
      .map((entry) => entry.slot)
      .filter((slot): slot is NonNullable<typeof slot> => slot !== null);
    const trapSlot = slots.find((slot) => slot.kind === 'trap');
    expect(trapSlot?.contentId).toBe('trap.warded-glyph');
    const itemSlot = slots.find((slot) => slot.kind === 'item');
    expect(itemSlot?.lootTableId).toBe('loot-table.echo-wrought');
    expect(slots.filter((slot) => slot.kind === 'monster')).toHaveLength(2);
  });
});
