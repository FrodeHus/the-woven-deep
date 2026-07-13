import { describe, expect, it } from 'vitest';
import { ContentCompileError, parseContentFile } from '../src/compiler/index.js';

describe('parseContentFile', () => {
  it('applies defaults to a strict monster entry', () => {
    const [entry] = parseContentFile({
      path: 'monsters/rat.yaml',
      source: `schemaVersion: 1
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: '#a89b82'
    ai: ai.skittish
    stats: { health: 4, attack: 2, defense: 0 }
`,
    });

    expect(entry).toMatchObject({
      id: 'monster.cave-rat',
      tags: [],
      runAppearanceChance: 1,
    });
  });

  it('materializes defaults and derived metadata for a strict vault entry', () => {
    const [entry] = parseContentFile({
      path: 'vaults/test-room.yaml',
      source: `schemaVersion: 1
entries:
  - kind: vault
    id: vault.test-room
    name: Test room
    tags: [test]
    minDepth: 1
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0, 180], reflectHorizontal: true }
    layout: ["#####", "#+m.#", "#####"]
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "m":
        terrain: floor
        slot: { id: monster-main, kind: monster, required: true, tags: [guard] }
`,
    });

    expect(entry).toMatchObject({
      kind: 'vault',
      layout: ['#####', '#+m.#', '#####'],
      entranceCount: 1,
      requiredSlotIds: ['monster-main'],
      legend: {
        '#': { terrain: 'wall', entrance: false, light: null, slot: null },
        m: {
          terrain: 'floor',
          entrance: false,
          light: null,
          slot: { id: 'monster-main', kind: 'monster', required: true, tags: ['guard'] },
        },
      },
    });
  });

  it('rejects unknown properties with a field path', () => {
    expect(() => parseContentFile({
      path: 'monsters/bad.yaml',
      source: `schemaVersion: 1
entries:
  - kind: monster
    id: monster.bad
    name: Bad
    glyph: b
    color: '#ffffff'
    ai: ai.skittish
    stats: { health: 1, attack: 1, defense: 0 }
    surpriseProperty: true
`,
    })).toThrowError(ContentCompileError);
  });

  it('identifies a vault in structural numeric and fixture diagnostics', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'vaults/bad-room.yaml',
        source: `schemaVersion: 1
entries:
  - kind: vault
    id: vault.bad-room
    name: Bad room
    minDepth: 0
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0] }
    layout: ["+*"]
    legend:
      "+": { terrain: floor, entrance: true }
      "*":
        terrain: floor
        light:
          idSuffix: amber
          glyph: "*"
          presentationToken: fixture.lamp
          color: [255, 180, 64]
          radius: 0
          strength: 180
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'vaults/bad-room.yaml',
        path: '$.entries.vault.bad-room.minDepth',
        message: expect.stringMatching(/expected number to be >0/i),
      }),
      expect.objectContaining({
        file: 'vaults/bad-room.yaml',
        path: '$.entries.vault.bad-room.legend.*.light.radius',
        message: expect.stringMatching(/expected number to be >=1/i),
      }),
    ]));
  });

  it('keeps index-only structural paths when a raw vault ID is invalid', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'vaults/invalid-id.yaml',
        source: `schemaVersion: 1
entries:
  - kind: vault
    id: "vault.Bad secret"
    name: Bad room
    minDepth: 0
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0] }
    layout: ["+"]
    legend:
      "+": { terrain: floor, entrance: true }
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.entries.0.id',
      '$.entries.0.minDepth',
    ]));
    expect((error as Error).message).not.toContain('vault.Bad secret');
  });

  it('rejects aliases', () => {
    expect(() => parseContentFile({
      path: 'monsters/alias.yaml',
      source: 'schemaVersion: 1\nentries: &entries [*entries]\n',
    })).toThrow(/alias|YAML/i);
  });

  it('rejects custom tags with file context', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'monsters/tagged.yaml',
        source: `schemaVersion: 1
entries: !unsafe
  - kind: monster
    id: monster.tagged
    name: Tagged
    glyph: t
    color: '#ffffff'
    ai: ai.skittish
    stats: { health: 1, attack: 1, defense: 0 }
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues).toEqual([
      expect.objectContaining({
        file: 'monsters/tagged.yaml',
        path: '$',
        message: expect.stringMatching(/tag/i),
      }),
    ]);
  });
});
