import type { BaseContentEntry, ContentId } from './common.js';

export const ACHIEVEMENT_CRITERIA_TYPES = [
  'defeat-boss',
  'defeat-fallen-hero',
  'reach-depth',
  'complete-ending',
] as const;
export type AchievementCriteriaType = (typeof ACHIEVEMENT_CRITERIA_TYPES)[number];

export const ACHIEVEMENT_ENDINGS = ['became-heart', 'refused', 'broke-cycle'] as const;
export type AchievementEnding = (typeof ACHIEVEMENT_ENDINGS)[number];

export type AchievementCriteria =
  | { readonly type: 'defeat-boss'; readonly monsterId: ContentId }
  | { readonly type: 'defeat-fallen-hero'; readonly role: 'champion' | 'echo' }
  | { readonly type: 'reach-depth'; readonly depth: number }
  | { readonly type: 'complete-ending'; readonly ending: AchievementEnding };

export interface AchievementContentEntry extends BaseContentEntry {
  readonly kind: 'achievement';
  readonly description: string;
  readonly criteria: AchievementCriteria;
}
