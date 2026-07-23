import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

function classFile(extra: Record<string, unknown>) {
  return {
    schemaVersion: 7,
    entries: [
      {
        kind: 'class',
        id: 'class.test',
        name: 'Test',
        tags: ['playable'],
        description: 'A test class.',
        playable: true,
        silhouetteGlyph: 'T',
        unlockHint: null,
        classTags: ['test'],
        kits: [
          { kitId: 'a', name: 'A', equipped: [], backpack: [] },
          { kitId: 'b', name: 'B', equipped: [], backpack: [] },
        ],
        ...extra,
      },
    ],
  };
}

describe('class casterAptitude', () => {
  it('defaults to false when omitted', () => {
    const entry = contentFileSchema.parse(classFile({})).entries[0]!;
    expect(entry).toMatchObject({ kind: 'class', casterAptitude: false });
  });

  it('parses an explicit true', () => {
    const entry = contentFileSchema.parse(classFile({ casterAptitude: true })).entries[0]!;
    expect(entry).toMatchObject({ casterAptitude: true });
  });
});
