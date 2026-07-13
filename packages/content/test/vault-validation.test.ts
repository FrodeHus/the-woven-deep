import { describe, expect, it } from 'vitest';
import type { VaultContentEntry, VaultLegendEntry } from '../src/index.js';
import { validateVaultEntry } from '../src/compiler/index.js';

const baseLegend: Record<string, VaultLegendEntry> = {
  '#': { terrain: 'wall', entrance: false, light: null, slot: null },
  '.': { terrain: 'floor', entrance: false, light: null, slot: null },
  '+': { terrain: 'floor', entrance: true, light: null, slot: null },
  m: {
    terrain: 'floor',
    entrance: false,
    light: null,
    slot: { id: 'monster-main', kind: 'monster', required: true, tags: ['guard'] },
  },
};

function vault(
  layout: readonly string[],
  legend: Readonly<Record<string, VaultLegendEntry>> = baseLegend,
): VaultContentEntry {
  return {
    kind: 'vault',
    id: 'vault.test-room',
    name: 'Test room',
    tags: ['test'],
    minDepth: 1,
    maxDepth: 5,
    rarity: 'common',
    weight: 10,
    maxPerFloor: 1,
    margin: 1,
    transforms: { rotations: [0, 180], reflectHorizontal: true },
    layout,
    legend,
    entranceCount: 1,
    requiredSlotIds: ['monster-main'],
  };
}

describe('validateVaultEntry', () => {
  const cases = [
    ['nonrectangular layout', ['#####', '###'], 'layout rows must have equal code-point width'],
    ['missing entrance', ['###', '#.#', '###'], 'at least one entrance'],
    ['missing legend symbol', ['#+x'], 'layout symbol x has no legend entry'],
    ['unused legend symbol', ['#+.'], 'legend symbol x is unused'],
    ['control character', ['#+\u0000'], 'control character'],
    ['tab character', ['#+\t'], 'tab character'],
    ['trailing whitespace symbol', ['#+ '], 'trailing whitespace is ambiguous'],
    ['duplicate slot ID', ['#+mm'], 'duplicate slot monster-main'],
    ['unreachable required slot', ['+##m'], 'required slot monster-main is unreachable'],
  ] as const;

  it.each(cases)('rejects %s', (name, layout, message) => {
    const legend = name === 'unused legend symbol'
      ? { ...baseLegend, x: { terrain: 'floor', entrance: false, light: null, slot: null } satisfies VaultLegendEntry }
      : baseLegend;
    const issues = validateVaultEntry(vault(layout, legend), 'vaults/test-room.yaml');

    expect(issues.some((issue) => issue.message.includes(message))).toBe(true);
  });

  it('rejects multi-code-point legend keys and duplicate fixture suffixes in stable issue order', () => {
    const fixture = {
      terrain: 'floor', entrance: false, slot: null,
      light: {
        idSuffix: 'amber', glyph: '*', presentationToken: 'fixture.lamp',
        color: [255, 180, 64] as const, radius: 6, strength: 180, enabled: true,
      },
    } satisfies VaultLegendEntry;
    const issues = validateVaultEntry(vault(['+ab'], {
      '+': baseLegend['+']!, a: fixture, b: fixture, xy: baseLegend['.']!,
    }), 'vaults/test-room.yaml');

    const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
    expect(issues).toEqual([...issues].sort((left, right) =>
      compare(left.path, right.path) || compare(left.message, right.message)));
    expect(issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('legend key xy must be one Unicode code point'),
      expect.stringContaining('duplicate fixture suffix amber'),
    ]));
  });

  it('rejects an impassable entrance without using it to reach an adjacent required slot', () => {
    const issues = validateVaultEntry(vault(['+m'], {
      ...baseLegend,
      '+': { ...baseLegend['+']!, terrain: 'wall' },
    }), 'vaults/test-room.yaml');

    expect(issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'entrance terrain wall is not potentially traversable',
      'required slot monster-main is unreachable',
    ]));
  });

  it('rejects an optional placement slot authored on void terrain at its vault legend field', () => {
    const issues = validateVaultEntry(vault(['+s'], {
      '+': baseLegend['+']!,
      s: {
        terrain: 'void', entrance: false, light: null,
        slot: { id: 'optional-cache', kind: 'item', required: false, tags: ['cache'] },
      },
    }), 'vaults/test-room.yaml');

    expect(issues).toContainEqual({
      file: 'vaults/test-room.yaml',
      path: '$.entries.vault.test-room.legend.s.slot',
      message: 'void terrain cannot contain placement slot optional-cache; use non-void terrain or remove the slot',
    });
  });

  it('rejects a light authored on void terrain at its vault legend field', () => {
    const issues = validateVaultEntry(vault(['+l'], {
      '+': baseLegend['+']!,
      l: {
        terrain: 'void', entrance: false, slot: null,
        light: {
          idSuffix: 'void-lamp', glyph: '*', presentationToken: 'fixture.lamp',
          color: [255, 180, 64], radius: 6, strength: 180, enabled: true,
        },
      },
    }), 'vaults/test-room.yaml');

    expect(issues).toContainEqual({
      file: 'vaults/test-room.yaml',
      path: '$.entries.vault.test-room.legend.l.light',
      message: 'void terrain cannot contain light void-lamp; use non-void terrain or remove the light',
    });
  });
});
