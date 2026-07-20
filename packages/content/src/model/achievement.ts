import type { BaseContentEntry } from './common.js';

export const ACHIEVEMENT_CRITERIA_IDS = ['first-champion-defeat', 'first-echo-defeat'] as const;
export type AchievementCriteriaId = (typeof ACHIEVEMENT_CRITERIA_IDS)[number];

export interface AchievementContentEntry extends BaseContentEntry {
  readonly kind: 'achievement';
  readonly description: string;
  readonly criteriaId: AchievementCriteriaId;
}
