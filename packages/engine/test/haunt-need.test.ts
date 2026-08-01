import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FallenChampionTemplateContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  hauntNeed,
  type FallenHeroStandingSnapshot,
  type RunConclusionCause,
} from '../src/index.js';

let template: FallenChampionTemplateContentEntry;

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const entry = pack.entries.find(
    (candidate): candidate is FallenChampionTemplateContentEntry =>
      candidate.kind === 'fallen-champion-template',
  );
  if (!entry) throw new Error('test setup failure: pack has no fallen-champion-template');
  template = entry;
});

function causeWithKiller(): RunConclusionCause {
  return { killerContentId: 'monster.bone-gnawer', depth: 7, turn: 1, worldTime: 1 };
}

function standingWith(
  overrides: Partial<FallenHeroStandingSnapshot> = {},
): FallenHeroStandingSnapshot {
  const heirloom = {
    contentId: 'item.iron-sword',
    sourceItemId: 'item.original.1',
    enchantment: null,
    condition: 90,
    charges: null,
    fuel: null,
    curse: null,
    qualityRank: 2,
    displayName: "Ada's Iron Sword",
    glyph: ')',
    color: '#d8d8d8',
    originatingHallRecordId: 'hall.need-1',
  };
  return {
    rank: 1,
    hallRecordId: 'hall.need-1',
    heroName: 'Ada',
    portraitGlyph: '@',
    classTags: ['wayfarer'],
    attributes: { might: 12, agility: 12, vitality: 12, wits: 12, resolve: 12 },
    equippedItemContentIds: ['item.iron-sword'],
    signatureAbilityIds: [],
    deathDepth: 5,
    sourceContentHash: 'b'.repeat(64),
    heirloom,
    cause: causeWithKiller(),
    deathInventory: [heirloom],
    ...overrides,
  };
}

describe('hauntNeed', () => {
  it('unions the favored categories of every class tag', () => {
    expect(
      hauntNeed({ standing: standingWith({ classTags: ['loomcaller', 'lamplighter'] }), template }),
    ).toEqual(['fuel', 'light', 'potion', 'scroll']);
  });

  it('adds the causeless categories when the record names no killer', () => {
    expect(
      hauntNeed({ standing: standingWith({ classTags: ['loomcaller'], cause: null }), template }),
    ).toEqual(['light', 'potion', 'scroll']);
    expect(
      hauntNeed({
        standing: standingWith({
          classTags: ['loomcaller'],
          cause: { killerContentId: null, depth: 4, turn: 1, worldTime: 1 },
        }),
        template,
      }),
    ).toEqual(['light', 'potion', 'scroll']);
  });

  it('omits the causeless categories when a killer is named', () => {
    expect(
      hauntNeed({
        standing: standingWith({ classTags: ['loomcaller'], cause: causeWithKiller() }),
        template,
      }),
    ).toEqual(['potion', 'scroll']);
  });

  it('falls back to the template defaults for an unmapped class tag', () => {
    expect(
      hauntNeed({
        standing: standingWith({ classTags: ['unmapped'], cause: causeWithKiller() }),
        template,
      }),
    ).toEqual(['food', 'potion']);
  });

  it('falls back to the template defaults for a standing with no class tags at all', () => {
    expect(
      hauntNeed({ standing: standingWith({ classTags: [], cause: causeWithKiller() }), template }),
    ).toEqual(['food', 'potion']);
  });

  it('is stable and deduplicated', () => {
    const need = hauntNeed({
      standing: standingWith({ classTags: ['lamplighter', 'warden'] }),
      template,
    });
    expect(need).toEqual([...new Set(need)].sort());
  });

  it('is order-independent across the standing class tags', () => {
    expect(
      hauntNeed({ standing: standingWith({ classTags: ['warden', 'lamplighter'] }), template }),
    ).toEqual(
      hauntNeed({ standing: standingWith({ classTags: ['lamplighter', 'warden'] }), template }),
    );
  });

  it('never returns an empty need for any single shipped class tag', () => {
    for (const tag of [...Object.keys(template.appeasement.classFavors), 'unmapped']) {
      expect(
        hauntNeed({
          standing: standingWith({ classTags: [tag], cause: causeWithKiller() }),
          template,
        }).length,
        tag,
      ).toBeGreaterThan(0);
    }
  });
});
