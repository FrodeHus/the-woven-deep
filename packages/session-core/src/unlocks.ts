import type { ClassContentEntry, CompiledContentPack, UnlockCondition } from '@woven-deep/content';
import type { LifetimeState, StoredHallRecord } from '@woven-deep/engine';
import { classById, classEntries } from './pack-queries.js';

export interface EvaluateUnlocksInput {
  readonly records: readonly StoredHallRecord[];
  readonly lifetime: LifetimeState;
  readonly content: CompiledContentPack;
}

/**
 * Decides whether a class's data-driven `unlock` condition is satisfied by the profile's Hall
 * records + lifetime state.
 */
function unlockConditionMet(condition: UnlockCondition, input: EvaluateUnlocksInput): boolean {
  switch (condition.type) {
    case 'reach-depth':
      return input.records.some((record) => record.deepestDepth >= condition.depth);
    case 'defeat-champions':
      return input.lifetime.conqueredChampionRecordIds.length >= condition.count;
  }
}

/**
 * Evaluates which content-locked class ids a profile has unlocked, from its Hall records +
 * lifetime state. Pure: no I/O, no clock, no randomness. A class id is only ever included if it
 * is currently `playable: false` in `content` AND its own `unlock` condition is met — a class
 * that is already playable, or has no `unlock` condition, is never returned.
 */
export function evaluateUnlocks(input: EvaluateUnlocksInput): readonly string[] {
  return classEntries(input.content)
    .filter(
      (entry) =>
        !entry.playable && entry.unlock !== null && unlockConditionMet(entry.unlock, input),
    )
    .map((entry) => entry.id)
    .sort();
}

/**
 * Recovers the content class entry a `NewRunHero` was built from, by matching its `classTags`
 * against each class entry's own `classTags` as a set. The engine's `heroFromChoices` always
 * copies a chosen class entry's `classTags` verbatim onto the hero it produces (see
 * `packages/engine/src/chargen.ts`), so this is a faithful (if indirect) way to recover the
 * class id from a hero that only carries tags, not an explicit class id. Returns `undefined`
 * when no class entry's tag set matches exactly (e.g. a hand-built hero in a test).
 */
export function classEntryForHeroTags(
  content: CompiledContentPack,
  classTags: readonly string[],
): ClassContentEntry | undefined {
  const tagSet = new Set(classTags);
  return classEntries(content).find(
    (entry) =>
      entry.classTags.length === tagSet.size && entry.classTags.every((tag) => tagSet.has(tag)),
  );
}

export interface CanStartClassInput {
  readonly classId: string;
  readonly unlockedClassIds: readonly string[];
  readonly content: CompiledContentPack;
}

/**
 * The run-start anti-cheat guard: whether a profile may start a run as the given class id. A
 * `playable: true` class is always allowed. A content-locked (`playable: false`) class is only
 * allowed when the profile has earned it, i.e. it appears in `unlockedClassIds` (the profile's
 * persisted, `evaluateUnlocks`-derived set). An unknown class id is never allowed. Pure -- no I/O,
 * matching `evaluateUnlocks`'s own style; the server is the one place this decides anything, since
 * `unlockedClassIds` is only ever trustworthy as read from the profile's own persisted Hall state.
 */
export function canStartClass(input: CanStartClassInput): boolean {
  const entry = classById(input.content, input.classId);
  if (entry === undefined) return false;
  if (entry.playable) return true;
  return input.unlockedClassIds.includes(input.classId);
}
