import { describe, expect, it } from 'vitest';
import {
  ENGINE_GAME_VERSION,
  RECENT_COMMAND_LIMIT,
  SAVE_SCHEMA_VERSION,
  assertOpaqueId,
  createDemoRun,
  tileIndex,
  validateActiveRun,
  type FloorSnapshot,
} from '../src/index.js';

describe('engine model boundary', () => {
  it('publishes the active schema constants', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(3);
    expect(ENGINE_GAME_VERSION).toBe('0.1.0');
    expect(RECENT_COMMAND_LIMIT).toBe(128);
  });

  it('stores gameplay state in schema v3', () => {
    const run = createDemoRun();

    expect(run.schemaVersion).toBe(3);
    expect(run.worldTime).toBe(0);
    expect(run.actors.map((actor) => actor.actorId)).toEqual(['hero.demo']);
    expect(run.items).toEqual([]);
    expect(run.features).toEqual([]);
    expect(run.identification.appearanceByContentId).toEqual({});
    expect(run.hero.actorId).toBe('hero.demo');
  });

  it('rejects duplicate actor identifiers', () => {
    const run = createDemoRun();

    expect(() => validateActiveRun({
      ...run,
      actors: [run.actors[0]!, run.actors[0]!],
    })).toThrow(/actors\.1\.actorId.*strictly increasing/i);
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

    expect(() => validateActiveRun({ ...run, items: [item, item] }))
      .toThrow(/items\.1\.itemId.*strictly increasing/i);
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
