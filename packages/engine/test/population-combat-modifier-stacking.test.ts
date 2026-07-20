import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyPopulationCombatModifiers,
  bossCombatModifiers,
  composePopulationCombatModifiers,
  createPopulationDemoRun,
  groupCombatModifiers,
  type BossPopulation,
  type GroupPopulation,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('population combat-modifier additive stacking', () => {
  // `world-step.ts`'s internal `profile()` composes one actor's population combat modifiers via
  // the exported `composePopulationCombatModifiers`, which combines group + swarm + boss +
  // fallen-hero modifier sets into one. Production placement never lets one actor belong to two
  // populations at once (an actor has a single `populationId`), so this test drives the same two
  // *currently co-existing* population models from one real run (a group with its coordination
  // bonus active, and a boss forced into its first combat phase) through their real, exported
  // modifier functions, then calls the real composition function directly and asserts the result
  // is the field-by-field additive sum of the inputs. Because the assertion pins the exact sum
  // (not just linearity), it would fail if `composePopulationCombatModifiers` were changed to
  // max, last-wins, or multiplicative composition.
  it('composes two co-existing population models via the real composePopulationCombatModifiers as an additive sum', () => {
    const run = createPopulationDemoRun(pack);
    const group = run.populations.find(
      (population): population is GroupPopulation => population.model === 'group',
    )!;
    const boss = run.populations.find(
      (population): population is BossPopulation => population.model === 'boss',
    )!;
    expect(group.bonusActive).toBe(true);
    const groupMemberId = group.livingMemberIds[0]!;

    const groupModifiers = groupCombatModifiers({
      state: { actors: run.actors, populations: run.populations, worldTime: run.worldTime },
      content: pack,
      actorId: groupMemberId,
    });
    expect(groupModifiers).toEqual({ accuracy: 1, defense: 1, damage: 0 });

    // The boss only carries phase modifiers once damage crosses a phase threshold; force its
    // first phase directly (a local state override, not a production mutation) to exercise the
    // authored `kindled` phase modifiers.
    const phasedPopulations = run.populations.map((population) =>
      population.populationId === boss.populationId
        ? { ...population, currentPhaseId: 'kindled' }
        : population,
    );
    const bossModifiers = bossCombatModifiers({
      state: { actors: run.actors, populations: phasedPopulations },
      content: pack,
      actorId: boss.actorId,
    });
    expect(bossModifiers).toEqual({ accuracy: 1, defense: 0, damage: 1 });

    // Call the actual production composition function that `world-step.ts`'s `profile()` uses to
    // combine multiple population models' modifiers. If this were reimplemented as max/last-wins,
    // the expectation below (a true field-by-field sum, distinct from either input alone or a
    // max/last-wins result) would fail.
    const composed = composePopulationCombatModifiers([groupModifiers, bossModifiers]);
    expect(composed).toEqual({
      accuracy: groupModifiers.accuracy + bossModifiers.accuracy,
      defense: groupModifiers.defense + bossModifiers.defense,
      damage: groupModifiers.damage + bossModifiers.damage,
    });
    expect(composed).toEqual({ accuracy: 2, defense: 1, damage: 1 });

    const base = { accuracy: 10, defense: 5, damage: { count: 1, sides: 6, bonus: 2 } };
    const appliedTogether = applyPopulationCombatModifiers(base, composed);
    expect(appliedTogether).toEqual({
      accuracy: 12,
      defense: 6,
      damage: { count: 1, sides: 6, bonus: 3 },
    });

    const appliedSequentially = applyPopulationCombatModifiers(
      applyPopulationCombatModifiers(base, groupModifiers),
      bossModifiers,
    );
    expect(appliedSequentially).toEqual(appliedTogether);
  });
});
