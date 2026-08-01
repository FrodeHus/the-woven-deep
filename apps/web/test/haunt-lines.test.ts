import { describe, expect, it } from 'vitest';
import {
  CONTENT_SCHEMA_VERSION,
  type CompiledContentPack,
  type MonsterContentEntry,
} from '@woven-deep/content';
import type { HauntView } from '@woven-deep/engine';
import { hauntEncounterLine, hauntFarewellLine, killerPhrase } from '../src/session/haunt-lines.js';

const attributes = { might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2 } as const;
const resistances = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 } as const;
const dice = { count: 1, sides: 4, bonus: 0 } as const;

const boneGnawer: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.bone-gnawer',
  name: 'Bone-Gnawer',
  tags: [],
  glyph: 'b',
  color: '#aaaaaa',
  minDepth: 1,
  maxDepth: 5,
  attributes,
  health: 4,
  speed: 110,
  accuracy: 1,
  defense: 10,
  perception: 6,
  damage: dice,
  armor: 0,
  resistances,
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  rarity: 'common',
  threat: 1,
  lootTableId: null,
  dropChance: 1,
};

// Deliberately defines no `monster.shade` -- that absence is what makes the "content-drifted id"
// degradation path visible in the test below.
const pack: CompiledContentPack = {
  schemaVersion: CONTENT_SCHEMA_VERSION,
  hash: 'demo',
  entries: [boneGnawer],
  generationReport: { foundationalCategories: [] },
};

function hauntView(overrides: Partial<HauntView> = {}): HauntView {
  return {
    hallRecordId: 'record.a',
    role: 'echo',
    heroName: 'Hero',
    deathDepth: 4,
    killerContentId: null,
    causeDepth: null,
    encountered: false,
    appeased: false,
    actorId: null,
    needCategories: [],
    ...overrides,
  };
}

describe('haunt-lines', () => {
  it('speaks a champion line with a resolved killer', () => {
    expect(
      hauntEncounterLine(
        hauntView({
          role: 'champion',
          heroName: 'Kaelen',
          killerContentId: 'monster.bone-gnawer',
          causeDepth: 7,
        }),
        pack,
      ),
    ).toBe("Kaelen, the Deep's Champion — fell to a bone-gnawer at depth 7. The Deep remembers.");
  });

  it('speaks an echo line with a resolved killer', () => {
    expect(
      hauntEncounterLine(
        hauntView({
          role: 'echo',
          heroName: 'Mira',
          killerContentId: 'monster.shade',
          causeDepth: 4,
        }),
        pack,
      ),
    ).toBe('Echo of Mira — fell to the dark at depth 4. The Deep remembers.');
  });

  it('shortens the line for a cause-less legacy record', () => {
    expect(
      hauntEncounterLine(
        hauntView({ role: 'echo', heroName: 'Mira', killerContentId: null, causeDepth: null }),
        pack,
      ),
    ).toBe('Echo of Mira. The Deep remembers.');
  });

  it('falls back to the dark for a killer the pack no longer defines', () => {
    expect(killerPhrase(pack, 'monster.deleted')).toBe('the dark');
    expect(killerPhrase(pack, null)).toBe('the dark');
  });

  it('speaks the farewell on appeasement', () => {
    expect(hauntFarewellLine(hauntView({ role: 'echo', heroName: 'Mira' }))).toBe(
      'Echo of Mira is at peace. The Deep releases what it held.',
    );
  });
});
