import { describe, expect, it } from 'vitest';
import {
  ENGINE_GAME_VERSION,
  RECENT_COMMAND_LIMIT,
  SAVE_SCHEMA_VERSION,
  assertOpaqueId,
  createDemoRun,
  emptyRunMetrics,
  tileIndex,
  validateActiveRun,
  type FloorSnapshot,
} from '../src/index.js';

describe('engine model boundary', () => {
  it('publishes the active schema constants', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(8);
    expect(ENGINE_GAME_VERSION).toBe('0.1.0');
    expect(RECENT_COMMAND_LIMIT).toBe(128);
  });

  it('stores merchant-ready population state in schema v8', () => {
    const run = createDemoRun();

    expect(run.schemaVersion).toBe(8);
    expect(run.worldTime).toBe(0);
    expect(run.actors.map((actor) => actor.actorId)).toEqual(['hero.demo']);
    expect(run.items).toEqual([]);
    expect(run.features).toEqual([]);
    expect(run.identification.appearanceByContentId).toEqual({});
    expect(run.hero.actorId).toBe('hero.demo');
    expect(run.hero.currency).toBe(40);
    expect(run.hero.classTags).toEqual([]);
    expect(run.hero.statModifiers).toEqual({});
    expect(run.reputations).toEqual([]);
    expect(run.activeTrade).toBeNull();
    expect(run.encounterDecisions).toEqual([]);
    expect(run.populations).toEqual([]);
    expect(run.fallenHeroStandings).toEqual([]);
    expect(run.fallenHeroDecisions).toEqual([]);
    expect(run.metrics).toEqual(emptyRunMetrics());
    expect(run.conclusion).toBeNull();
    expect(run.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(run.restockedMilestones).toEqual([]);
    expect(run.rng).toHaveProperty('population-gates');
    expect(run.rng).toHaveProperty('merchant-stock');
    expect(run.rng).toHaveProperty('merchant-runtime');
    expect(run.rng).toHaveProperty('run-records');
    expect(run.actors[0]?.behaviorState).toEqual({
      intent: 'hold',
      goal: null,
      lastKnownTargets: [],
      investigation: null,
    });
  });

  it('rejects population membership that does not resolve in both directions', () => {
    const run = createDemoRun();
    expect(() =>
      validateActiveRun({
        ...run,
        actors: [{ ...run.actors[0]!, populationId: 'population.missing', populationRoleId: null }],
      }),
    ).toThrow(/populationId|population membership/i);
  });

  it('rejects duplicate actor identifiers', () => {
    const run = createDemoRun();

    expect(() =>
      validateActiveRun({
        ...run,
        actors: [run.actors[0]!, run.actors[0]!],
      }),
    ).toThrow(/actors\.1\.actorId.*strictly increasing/i);
  });

  it('rejects duplicate item identifiers', () => {
    const run = createDemoRun();
    const item = {
      itemId: 'item.demo.1',
      contentId: 'item.demo',
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'backpack' as const, actorId: run.hero.actorId },
    };

    expect(() => validateActiveRun({ ...run, items: [item, item] })).toThrow(
      /items\.1\.itemId.*strictly increasing/i,
    );
  });

  it.each(['run.demo', 'command:001', 'hero-1'])('accepts opaque identifier %s', (id) => {
    expect(() => assertOpaqueId(id, 'id')).not.toThrow();
  });

  it.each(['', 'Uppercase', 'has space', `a${'b'.repeat(128)}`])(
    'rejects opaque identifier %j',
    (id) => expect(() => assertOpaqueId(id, 'id')).toThrow(),
  );

  it('maps in-bounds coordinates to row-major tile indexes', () => {
    const floor = { width: 3, height: 2 } as FloorSnapshot;
    expect(tileIndex(floor, 2, 1)).toBe(5);
    expect(tileIndex(floor, -1, 0)).toBeUndefined();
    expect(tileIndex(floor, 3, 0)).toBeUndefined();
  });
});
