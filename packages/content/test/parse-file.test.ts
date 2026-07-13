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

  it('rejects aliases and custom tags', () => {
    expect(() => parseContentFile({
      path: 'monsters/alias.yaml',
      source: 'schemaVersion: 1\nentries: &entries [*entries]\n',
    })).toThrow(/alias|YAML/i);
  });
});
