import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  deriveRunActorStats,
  heroActor,
  scoreRun,
  type ActiveRun,
  type HungerStage,
} from '../src/index.js';

// These assertions are about the BUNDLED pack's authored numbers, not the engine formulas the
// fixture-based suites cover. They are the regression guard for issue #158: hunger has to bite
// before it kills, and the turn-efficiency line has to distinguish a fast run from a slow one.

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function runAtStage(stage: HungerStage): ActiveRun {
  const run = createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO });
  return { ...run, survival: { ...run.survival, hungerStage: stage } };
}

function searchAt(stage: HungerStage): number {
  const run = runAtStage(stage);
  return deriveRunActorStats({ state: run, content: pack, actor: heroActor(run) }).search;
}

describe('bundled hunger pressure', () => {
  it('costs the hero a point of perception the moment hunger sets in', () => {
    expect(searchAt('hungry')).toBe(searchAt('sated') - 1);
  });

  it('escalates the ladder past hungry rather than plateauing', () => {
    const balance = pack.entries.find((entry) => entry.kind === 'balance')!;
    if (balance.kind !== 'balance') throw new Error('expected the balance entry');
    // Each stage must cost at least as much as the one before it, and starving must cost strictly
    // more than merely being hungry -- otherwise the later stages are decoration.
    expect(balance.hungerStageModifiers.sated).toEqual({});
    expect(Object.keys(balance.hungerStageModifiers.hungry).length).toBeGreaterThan(0);
    expect(balance.hungerStageModifiers.starving.defense).toBeLessThan(
      balance.hungerStageModifiers.weak.defense!,
    );
  });

  it('lets starvation actually kill a starting hero inside a single run', () => {
    const balance = pack.entries.find((entry) => entry.kind === 'balance')!;
    if (balance.kind !== 'balance') throw new Error('expected the balance entry');
    const run = createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO });
    const maxHealth = heroActor(run).maxHealth;

    let health = maxHealth;
    let ticks = 0;
    while (health > 0) {
      ticks += 1;
      health -= Math.min(
        balance.starvationDamage + (ticks - 1) * balance.starvationDamageIncrement,
        balance.starvationDamageMaximum,
      );
      if (ticks > 10_000) throw new Error('starvation never kills');
    }
    // Reaching starving costs the whole reserve; the ladder then has to finish the job well inside
    // the ~14,000 turns an honest twenty-floor descent takes, or ignoring food costs nothing.
    const turnsToDeath = balance.hungerMaximum + ticks * balance.starvationInterval;
    expect(turnsToDeath).toBeLessThan(14_000);
  });
});

describe('bundled turn-efficiency scoring', () => {
  function turnEfficiencyAt(turnsElapsed: number): number {
    const base = createNewRun({ pack, seed: [11, 22, 33, 44], hero: DEFAULT_GUEST_HERO });
    const run: ActiveRun = {
      ...base,
      metrics: { ...base.metrics, turnsElapsed },
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 1, turn: 1, worldTime: 1 },
        concludedAtRevision: base.revision,
        finalized: false,
      },
    };
    return scoreRun({ run, content: pack }).lines.find((line) => line.lineId === 'turn-efficiency')!
      .amount;
  }

  it('separates a brisk run from a thorough one from a grind', () => {
    const brisk = turnEfficiencyAt(8_000);
    const thorough = turnEfficiencyAt(14_000);
    const grind = turnEfficiencyAt(30_000);
    expect(brisk).toBeGreaterThan(thorough);
    expect(thorough).toBeGreaterThan(0);
    expect(grind).toBe(0);
  });
});
