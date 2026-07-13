import { describe, expect, it } from 'vitest';
import {
  ENGINE_GAME_VERSION,
  RECENT_COMMAND_LIMIT,
  SAVE_SCHEMA_VERSION,
  assertOpaqueId,
  tileIndex,
  type FloorSnapshot,
} from '../src/index.js';

describe('engine model boundary', () => {
  it('publishes the initial compatibility constants', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(1);
    expect(ENGINE_GAME_VERSION).toBe('0.1.0');
    expect(RECENT_COMMAND_LIMIT).toBe(128);
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
