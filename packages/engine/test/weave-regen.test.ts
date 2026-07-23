import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BalanceContentEntry } from '@woven-deep/content';
import {
  advanceSurvival,
  createDemoContentPack,
  createDemoRun,
  hungerStage,
  tickConditions,
} from '../src/index.js';

// Regression coverage for Task 10: per-turn Weave regen in `advanceSurvival` (survival.ts,
// commit 6984265). That regen already exists; this file proves it still behaves correctly
// after the Task 8 dependency-injection refactor (`tickConditions`/`mitigationFor` as params).

const noMitigation = () => ({ armor: 0, resistance: 0, immune: false });

const thresholds = { hungry: 70, weak: 30, starving: 0 } as const;

function balance(overrides: Partial<BalanceContentEntry> = {}): BalanceContentEntry {
  const base = createDemoContentPack().entries.find((entry) => entry.kind === 'balance')!;
  return {
    ...base,
    hungerMaximum: 100,
    hungerThresholds: thresholds,
    recoveryInterval: 5,
    recoveryAmount: 0,
    weaveRegenAmount: 2,
    recoveryByHungerStage: { sated: 100, hungry: 100, weak: 100, starving: 100 },
    ...overrides,
  } as BalanceContentEntry;
}

function fixtureInput(overrides: Readonly<{ elapsed?: number; danger?: boolean }> = {}) {
  const elapsed = overrides.elapsed ?? 10;
  const base = createDemoRun();
  const content = {
    ...createDemoContentPack(),
    entries: [
      balance(),
      ...createDemoContentPack().entries.filter((entry) => entry.kind !== 'balance'),
    ],
  };
  const state = {
    ...base,
    worldTime: elapsed,
    survival: {
      ...base.survival,
      hungerReserve: 90,
      hungerStage: hungerStage({ reserve: 90, thresholds }),
    },
  };
  return {
    state,
    content,
    elapsed,
    eventId: 'event.survival',
    danger: overrides.danger ?? false,
    tickConditions,
    mitigationFor: noMitigation,
  };
}

describe('per-turn Weave regen (advanceSurvival)', () => {
  it('accrues weaveRegen per crossed recovery interval as world time advances turn by turn', () => {
    const input = fixtureInput({ elapsed: 5 });
    const drained = { ...input.state.actors[0]!, weave: 0, maxWeave: 20 };

    // First tick crosses exactly one 5-tick recovery interval.
    const first = advanceSurvival({ ...input, state: { ...input.state, actors: [drained] } });
    expect(first.state.actors[0]?.weave).toBe(2);

    // Second tick (same elapsed, world time advanced again) crosses a second interval.
    const second = advanceSurvival({
      ...input,
      elapsed: 5,
      state: { ...first.state, worldTime: 10 },
    });
    expect(second.state.actors[0]?.weave).toBe(4);
  });

  it('never exceeds maxWeave even when accrued regen would overshoot it', () => {
    const input = fixtureInput({ elapsed: 50 }); // 10 crossed intervals * 2 = +20 potential
    const nearFull = { ...input.state.actors[0]!, weave: 15, maxWeave: 16 };
    const result = advanceSurvival({ ...input, state: { ...input.state, actors: [nearFull] } });
    expect(result.state.actors[0]?.weave).toBe(16);
    expect(result.state.actors[0]!.weave).toBeLessThanOrEqual(result.state.actors[0]!.maxWeave);
  });

  it('does not regenerate Weave while in danger', () => {
    const input = fixtureInput({ elapsed: 10, danger: true });
    const drained = { ...input.state.actors[0]!, weave: 0, maxWeave: 20 };
    const result = advanceSurvival({ ...input, state: { ...input.state, actors: [drained] } });
    expect(result.state.actors[0]?.weave).toBe(0);
  });

  it('does not regenerate Weave while an active condition blocks recovery', () => {
    const input = fixtureInput({ elapsed: 10 });
    const condition = {
      kind: 'condition' as const,
      id: 'condition.no-recovery',
      name: 'No recovery',
      description: 'No recovery',
      tags: [],
      color: '#ffffff',
      duration: { mode: 'timed' as const, default: 20, maximum: 20 },
      stacking: { mode: 'refresh' as const, maximumStacks: 1 },
      modifiersPerStack: {},
      traits: ['condition-trait.blocks-recovery' as const],
    };
    const drained = {
      ...input.state.actors[0]!,
      weave: 0,
      maxWeave: 20,
      conditions: [
        { conditionId: condition.id, sourceActorId: null, appliedAt: 0, expiresAt: 20, stacks: 1 },
      ],
    };
    const content = { ...input.content, entries: [...input.content.entries, condition] };
    const result = advanceSurvival({
      ...input,
      content,
      state: { ...input.state, actors: [drained] },
    });
    expect(result.state.actors[0]?.weave).toBe(0);
  });

  it('is deterministic: identical inputs always accrue identical Weave, with no RNG involved', () => {
    const input = fixtureInput({ elapsed: 10 });
    const drained = { ...input.state.actors[0]!, weave: 0, maxWeave: 20 };
    const runOnce = () =>
      advanceSurvival({ ...input, state: { ...input.state, actors: [drained] } }).state.actors[0]
        ?.weave;
    const results = Array.from({ length: 5 }, runOnce);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(4);

    // Static guard: the regen path in survival.ts must stay pure integer accrual + clamp,
    // never reaching for `Math.random` (or any other RNG source).
    const source = readFileSync(new URL('../src/survival.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('Math.random');
  });
});
