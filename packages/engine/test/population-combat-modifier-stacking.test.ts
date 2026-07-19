import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyPopulationCombatModifiers, bossCombatModifiers, createPopulationDemoRun, groupCombatModifiers,
  type BossPopulation, type GroupPopulation,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

describe('population combat-modifier additive stacking', () => {
  // `world-step.ts`'s internal `profile()` computes one actor's population combat modifiers by
  // hand-summing group + swarm + boss + fallen-hero modifiers component-wise, then applies the
  // total once via `applyPopulationCombatModifiers`. Production placement never lets one actor
  // belong to two populations at once (an actor has a single `populationId`), so that composition
  // is otherwise pinned only by the hand-sum itself. This test drives the same two *currently
  // co-existing* population models from one real run (a group with its coordination bonus active,
  // and a boss forced into its first combat phase) through their real, exported modifier
  // functions, then proves the arithmetic `profile()` relies on is a true additive sum: applying
  // the combined modifier set in one call is identical to applying each contributor's set
  // sequentially.
  it('sums two co-existing population models additively, matching the world-step.profile hand-sum', () => {
    const run = createPopulationDemoRun(pack);
    const group = run.populations.find((population): population is GroupPopulation => population.model === 'group')!;
    const boss = run.populations.find((population): population is BossPopulation => population.model === 'boss')!;
    expect(group.bonusActive).toBe(true);
    const groupMemberId = group.livingMemberIds[0]!;

    const groupModifiers = groupCombatModifiers({
      state: { actors: run.actors, populations: run.populations, worldTime: run.worldTime },
      content: pack, actorId: groupMemberId,
    });
    expect(groupModifiers).toEqual({ accuracy: 1, defense: 1, damage: 0 });

    // The boss only carries phase modifiers once damage crosses a phase threshold; force its
    // first phase directly (a local state override, not a production mutation) to exercise the
    // authored `kindled` phase modifiers.
    const phasedPopulations = run.populations.map((population) =>
      population.populationId === boss.populationId ? { ...population, currentPhaseId: 'kindled' } : population);
    const bossModifiers = bossCombatModifiers({
      state: { actors: run.actors, populations: phasedPopulations }, content: pack, actorId: boss.actorId,
    });
    expect(bossModifiers).toEqual({ accuracy: 1, defense: 0, damage: 1 });

    const combined = {
      accuracy: groupModifiers.accuracy + bossModifiers.accuracy,
      defense: groupModifiers.defense + bossModifiers.defense,
      damage: groupModifiers.damage + bossModifiers.damage,
    };
    expect(combined).toEqual({ accuracy: 2, defense: 1, damage: 1 });

    const base = { accuracy: 10, defense: 5, damage: { count: 1, sides: 6, bonus: 2 } };
    const appliedTogether = applyPopulationCombatModifiers(base, combined);
    expect(appliedTogether).toEqual({ accuracy: 12, defense: 6, damage: { count: 1, sides: 6, bonus: 3 } });

    const appliedSequentially = applyPopulationCombatModifiers(
      applyPopulationCombatModifiers(base, groupModifiers), bossModifiers,
    );
    expect(appliedSequentially).toEqual(appliedTogether);
  });
});
