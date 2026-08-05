import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { BalanceContentEntry, CompletionType, ContentEntry } from '../src/model.js';

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function balanceOf(entries: readonly ContentEntry[]): BalanceContentEntry {
  const balance = entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
  if (!balance) throw new Error('content pack is missing a balance entry');
  return balance;
}

/**
 * Every completion the engine can conclude with must carry a score bonus. A missing key would
 * score `undefined` and poison the checked-integer sum in `scoreRun`, so the coverage is pinned
 * here rather than left to the `Record<CompletionType, number>` type: the YAML is validated at
 * runtime, and TypeScript never sees it.
 */
const ALL_COMPLETION_TYPES: readonly CompletionType[] = [
  'died',
  'surrendered',
  'refused',
  'became-heart',
  'broke-cycle',
];

describe('balance completion bonus', () => {
  it('covers every completion type', async () => {
    const pack = await loadPack();
    const balance = balanceOf(pack.entries);
    for (const completionType of ALL_COMPLETION_TYPES) {
      expect(balance.score.completionBonus[completionType]).toBeTypeOf('number');
    }
  });

  it('pays a surrendered run nothing', async () => {
    const pack = await loadPack();
    expect(balanceOf(pack.entries).score.completionBonus.surrendered).toBe(0);
  });
});
