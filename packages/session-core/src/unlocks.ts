import type { CompiledContentPack } from '@woven-deep/content';
import type { LifetimeState, StoredHallRecord } from '@woven-deep/engine';
import { classById } from './pack-queries.js';

export interface EvaluateUnlocksInput {
  readonly records: readonly StoredHallRecord[];
  readonly lifetime: LifetimeState;
  readonly content: CompiledContentPack;
}

/**
 * The single source of unlock rules, keyed by class id. Each predicate decides whether the
 * profile's Hall records + lifetime state have earned that class, independent of whether the
 * class is currently locked in content.
 */
const UNLOCK_RULES: Readonly<Record<string, (input: EvaluateUnlocksInput) => boolean>> = {
  'class.warden': ({ records }) => records.some((record) => record.deepestDepth >= 10),
  'class.archivist': ({ lifetime }) => lifetime.conqueredChampionRecordIds.length >= 3,
};

/**
 * Evaluates which content-locked class ids a profile has unlocked, from its Hall records +
 * lifetime state. Pure: no I/O, no clock, no randomness. A class id is only ever included if it
 * both satisfies its unlock rule AND exists in `content` as a currently `playable: false` class —
 * a class that is already playable is never returned.
 */
export function evaluateUnlocks(input: EvaluateUnlocksInput): readonly string[] {
  const unlocked = Object.entries(UNLOCK_RULES)
    .filter(([classId, predicate]) => {
      const entry = classById(input.content, classId);
      return entry !== undefined && !entry.playable && predicate(input);
    })
    .map(([classId]) => classId);
  return unlocked.sort();
}
