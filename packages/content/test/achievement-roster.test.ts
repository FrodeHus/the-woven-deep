import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CRITERIA_TYPES, ACHIEVEMENT_ENDINGS } from '../src/model.js';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { AchievementContentEntry } from '../src/model.js';
import type { MonsterContentEntry } from '../src/model.js';

describe('achievement roster', () => {
  it('contains exactly 10 valid, cross-referenced achievements', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const achievements = pack.entries.filter(
      (entry): entry is AchievementContentEntry => entry.kind === 'achievement',
    );
    const monsters = pack.entries.filter(
      (entry): entry is MonsterContentEntry => entry.kind === 'monster',
    );

    expect(achievements).toHaveLength(10);

    const ids = achievements.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    const criteriaTypesSeen = new Set(achievements.map((entry) => entry.criteria.type));
    expect(criteriaTypesSeen).toEqual(new Set(ACHIEVEMENT_CRITERIA_TYPES));

    const bossIds = new Set(
      monsters.filter((monster) => monster.tags.includes('boss')).map((monster) => monster.id),
    );
    for (const entry of achievements) {
      const { criteria } = entry;
      if (criteria.type === 'defeat-boss') {
        expect(bossIds.has(criteria.monsterId)).toBe(true);
      } else if (criteria.type === 'reach-depth') {
        expect(criteria.depth).toBeGreaterThanOrEqual(1);
        expect(criteria.depth).toBeLessThanOrEqual(20);
      } else if (criteria.type === 'complete-ending') {
        expect(ACHIEVEMENT_ENDINGS).toContain(criteria.ending);
      }
    }
  });
});
