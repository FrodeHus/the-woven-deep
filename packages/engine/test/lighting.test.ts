import { describe, expect, it } from 'vitest';

import type { AmbientLight, LightSource, RgbColor } from '../src/light-model.js';
import { computeIllumination } from '../src/lighting.js';
import type { TileId } from '../src/model.js';

const width = 7;
const height = 5;
const tiles = Array.from({ length: width * height }, () => 1 as TileId);
const at = (x: number, y: number): number => y * width + x;
const dark: AmbientLight = { color: [255, 255, 255], strength: 0 };
const fixed = (lightId: string, x: number, y: number, color: RgbColor): LightSource => ({
  lightId,
  location: { type: 'fixed', x, y },
  color,
  radius: 2,
  strength: 255,
  enabled: true,
  falloff: 'linear',
  vaultPlacementId: null,
  presentation: null,
});

describe('illumination values', () => {
  it('uses exact integer linear falloff', () => {
    const field = computeIllumination({ width, height, tiles, ambient: dark,
      lights: [fixed('light.red', 3, 2, [255, 0, 0])], actors: new Map() });

    expect([field.red[at(3, 2)], field.red[at(4, 2)], field.red[at(5, 2)]]).toEqual([255, 170, 85]);
  });

  it('floors source strength before flooring each colored channel', () => {
    const source = { ...fixed('light.dim', 3, 2, [100, 50, 25]), strength: 100 };
    const field = computeIllumination({ width, height, tiles, ambient: dark, lights: [source], actors: new Map() });

    expect([field.red[at(3, 2)], field.green[at(3, 2)], field.blue[at(3, 2)]]).toEqual([39, 19, 9]);
    expect([field.red[at(4, 2)], field.green[at(4, 2)], field.blue[at(4, 2)]]).toEqual([25, 12, 6]);
  });

  it('uses ceiling Euclidean distance bands', () => {
    const field = computeIllumination({ width, height, tiles, ambient: dark,
      lights: [fixed('light.red', 3, 2, [255, 0, 0])], actors: new Map() });

    expect(field.red[at(4, 3)]).toBe(85);
    expect(field.red[at(5, 4)]).toBe(0);
  });

  it('supports absolute darkness and low colored ambient light', () => {
    const absolute = computeIllumination({ width, height, tiles, ambient: dark, lights: [], actors: new Map() });
    const low = computeIllumination({ width, height, tiles,
      ambient: { color: [80, 100, 120], strength: 5 }, lights: [], actors: new Map() });

    expect([absolute.red[0], absolute.green[0], absolute.blue[0]]).toEqual([0, 0, 0]);
    expect([low.red[0], low.green[0], low.blue[0]]).toEqual([1, 1, 2]);
    expect(low.intensity[0]).toBe(2);
  });

  it('adds differently colored sources and caps every channel', () => {
    const field = computeIllumination({ width, height, tiles, ambient: dark, actors: new Map(), lights: [
      fixed('light.blue', 3, 2, [0, 0, 255]),
      fixed('light.red-a', 3, 2, [255, 0, 0]),
      fixed('light.red-b', 3, 2, [255, 0, 0]),
    ] });

    expect([field.red[at(3, 2)], field.green[at(3, 2)], field.blue[at(3, 2)]]).toEqual([255, 0, 255]);
    expect(field.intensity[at(3, 2)]).toBe(255);
  });

  it('occludes light behind a wall while lighting the wall', () => {
    const blocked = [...tiles];
    blocked[at(3, 2)] = 0;
    const field = computeIllumination({ width, height, tiles: blocked, ambient: dark,
      lights: [fixed('light.red', 3, 3, [255, 0, 0])], actors: new Map() });

    expect(field.red[at(3, 2)]).toBeGreaterThan(0);
    expect(field.red[at(3, 1)]).toBe(0);
  });

  it('resolves actor-attached sources at the actor current position', () => {
    const source: LightSource = {
      ...fixed('light.hero', 0, 0, [255, 255, 255]),
      location: { type: 'actor', actorId: 'hero.demo' },
    };

    const first = computeIllumination({ width, height, tiles, ambient: dark, lights: [source],
      actors: new Map([['hero.demo', { x: 3, y: 2 }]]) });
    const moved = computeIllumination({ width, height, tiles, ambient: dark, lights: [source],
      actors: new Map([['hero.demo', { x: 1, y: 1 }]]) });

    expect(first.intensity[at(3, 2)]).toBe(255);
    expect(moved.intensity[at(1, 1)]).toBe(255);
    expect(moved.intensity[at(2, 1)]).toBe(170);
    expect(moved.intensity[at(3, 2)]).toBe(0);
  });

  it('ignores disabled sources after validating them', () => {
    const disabled = { ...fixed('light.off', 3, 2, [255, 0, 0]), enabled: false };
    const field = computeIllumination({ width, height, tiles, ambient: dark, lights: [disabled], actors: new Map() });

    expect(field.red.every((channel) => channel === 0)).toBe(true);
  });

  it('returns byte-identical results regardless of source input order', () => {
    const sources = [
      fixed('light.red', 2, 2, [255, 30, 0]),
      fixed('light.blue', 4, 2, [0, 30, 255]),
      fixed('light.green', 3, 1, [0, 255, 0]),
    ];

    const forward = computeIllumination({ width, height, tiles, ambient: dark, lights: sources, actors: new Map() });
    const reverse = computeIllumination({ width, height, tiles, ambient: dark, lights: [...sources].reverse(), actors: new Map() });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
  });

  it('does not mutate any supplied value', () => {
    const ambient = Object.freeze({ color: Object.freeze([10, 20, 30] as const), strength: 40 });
    const source = Object.freeze({
      ...fixed('light.safe', 2, 2, Object.freeze([90, 80, 70] as const)),
      location: Object.freeze({ type: 'fixed' as const, x: 2, y: 2 }),
    });
    const floor = Object.freeze([...tiles]);
    const actors = new Map([['hero.demo', Object.freeze({ x: 1, y: 1 })]]);
    const before = JSON.stringify({ ambient, source, floor, actors: [...actors] });

    const field = computeIllumination({ width, height, tiles: floor, ambient, lights: Object.freeze([source]), actors });
    const next = computeIllumination({ width, height, tiles: floor, ambient, lights: Object.freeze([source]), actors });

    expect(JSON.stringify({ ambient, source, floor, actors: [...actors] })).toBe(before);
    expect(new Set([field.red, field.green, field.blue, field.intensity])).toHaveLength(4);
    expect(field.red).not.toBe(next.red);
    expect(field.green).not.toBe(next.green);
    expect(field.blue).not.toBe(next.blue);
    expect(field.intensity).not.toBe(next.intensity);
  });
});

describe('illumination input validation', () => {
  const calculate = (overrides: Record<string, unknown> = {}): unknown => computeIllumination({
    width,
    height,
    tiles,
    ambient: dark,
    lights: [],
    actors: new Map(),
    ...overrides,
  } as Parameters<typeof computeIllumination>[0]);

  it.each([
    ['zero width', { width: 0 }],
    ['fractional height', { height: 2.5 }],
    ['unsafe dimensions', { width: Number.MAX_SAFE_INTEGER }],
    ['wrong tile length', { tiles: tiles.slice(1) }],
  ])('rejects %s', (_label, override) => {
    expect(() => calculate(override)).toThrow();
  });

  it('rejects malformed and sparse tile inputs', () => {
    const invalid = [...tiles];
    invalid[4] = 9 as TileId;
    const sparse = Array<TileId>(width * height);
    sparse.fill(1);
    delete sparse[4];

    expect(() => calculate({ tiles: invalid })).toThrow(/tile 4/);
    expect(() => calculate({ tiles: sparse })).toThrow(/tile 4/);
  });

  it.each([
    ['fractional ambient color', { color: [1.5, 2, 3], strength: 1 }],
    ['out-of-range ambient color', { color: [1, 2, 256], strength: 1 }],
    ['sparse ambient color', { color: Object.assign(Array<number>(3), { 0: 1, 2: 3 }), strength: 1 }],
    ['fractional ambient strength', { color: [1, 2, 3], strength: 1.5 }],
    ['negative ambient strength', { color: [1, 2, 3], strength: -1 }],
    ['excess ambient strength', { color: [1, 2, 3], strength: 256 }],
  ])('rejects %s', (_label, ambient) => {
    expect(() => calculate({ ambient })).toThrow();
  });

  it('rejects malformed and sparse light arrays', () => {
    const sparse = Array<LightSource>(1);
    expect(() => calculate({ lights: sparse })).toThrow(/light source/);
    expect(() => calculate({ lights: [null] })).toThrow(/light source/);
  });

  it.each([
    ['fractional color', { color: [1.5, 2, 3] }],
    ['negative color', { color: [-1, 2, 3] }],
    ['excess color', { color: [1, 2, 256] }],
    ['short color', { color: [1, 2] }],
    ['zero radius', { radius: 0 }],
    ['excess radius', { radius: 33 }],
    ['fractional radius', { radius: 1.5 }],
    ['zero strength', { strength: 0 }],
    ['excess strength', { strength: 256 }],
    ['fractional strength', { strength: 1.5 }],
    ['non-boolean enabled', { enabled: 1 }],
    ['unsupported falloff', { falloff: 'quadratic' }],
    ['invalid light ID', { lightId: 'Light Bad' }],
  ])('rejects a source with %s', (_label, change) => {
    expect(() => calculate({ lights: [{ ...fixed('light.valid', 1, 1, [1, 2, 3]), ...change }] })).toThrow();
  });

  it('validates disabled sources and their actor attachment', () => {
    const invalid = { ...fixed('light.off', 1, 1, [1, 2, 3]), enabled: false, radius: 0 };
    const unresolved: LightSource = {
      ...fixed('light.actor', 1, 1, [1, 2, 3]),
      enabled: false,
      location: { type: 'actor', actorId: 'actor.missing' },
    };

    expect(() => calculate({ lights: [invalid] })).toThrow(/radius/);
    expect(() => calculate({ lights: [unresolved] })).toThrow(/actor.missing/);
  });

  it('rejects duplicate light IDs deterministically', () => {
    const one = fixed('light.same', 1, 1, [1, 2, 3]);
    const two = fixed('light.same', 2, 2, [3, 2, 1]);

    expect(() => calculate({ lights: [two, one] })).toThrow(/light.same/);
  });

  it('reports invalid light IDs independently of source input order', () => {
    const invalid = { ...fixed('Light Bad', 1, 1, [1, 2, 3]) };
    const valid = fixed('light.valid', 2, 2, [1, 2, 3]);
    const errorMessage = (lights: readonly LightSource[]): string => {
      try {
        calculate({ lights });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected invalid sources to be rejected');
    };

    expect(errorMessage([invalid, valid])).toBe(errorMessage([valid, invalid]));
  });

  it('reports malformed sources before invalid IDs regardless of input order', () => {
    const invalidId = { ...fixed('Light Bad', 1, 1, [1, 2, 3]) };
    const errorMessage = (lights: readonly unknown[]): string => {
      try {
        calculate({ lights });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('expected invalid sources to be rejected');
    };

    expect(errorMessage([null, invalidId])).toBe(errorMessage([invalidId, null]));
  });

  it.each([
    ['fractional fixed coordinate', { x: 1.5, y: 1 }],
    ['out-of-bounds fixed coordinate', { x: width, y: 1 }],
  ])('rejects %s', (_label, coordinates) => {
    const source = { ...fixed('light.fixed', 1, 1, [1, 2, 3]), location: { type: 'fixed', ...coordinates } };
    expect(() => calculate({ lights: [source] })).toThrow(/location/);
  });

  it('rejects a fixed source on void terrain', () => {
    const floor = [...tiles];
    floor[at(1, 1)] = 6;
    expect(() => calculate({ tiles: floor, lights: [fixed('light.void', 1, 1, [1, 2, 3])] })).toThrow(/void/);
  });

  it('rejects unresolved and malformed actor locations', () => {
    const source: LightSource = {
      ...fixed('light.actor', 1, 1, [1, 2, 3]),
      location: { type: 'actor', actorId: 'actor.hero' },
    };

    expect(() => calculate({ lights: [source] })).toThrow(/actor.hero/);
    expect(() => calculate({ lights: [source], actors: new Map([['actor.hero', { x: 1.5, y: 1 }]]) })).toThrow(/actor.hero/);
    expect(() => calculate({ lights: [source], actors: new Map([['actor.hero', { x: width, y: 1 }]]) })).toThrow(/actor.hero/);
  });

  it('rejects actor-attached ownership and presentation', () => {
    const actor = {
      ...fixed('light.actor', 1, 1, [1, 2, 3]),
      location: { type: 'actor' as const, actorId: 'actor.hero' },
    };
    const actors = new Map([['actor.hero', { x: 1, y: 1 }]]);

    expect(() => calculate({ actors, lights: [{ ...actor, vaultPlacementId: 'vault.1' }] })).toThrow(/vaultPlacementId/);
    expect(() => calculate({ actors, lights: [{ ...actor, presentation: { glyph: '*', token: 'fixture.lamp' } }] })).toThrow(/presentation/);
  });

  it('requires vault-owned fixed sources to be presented and allows non-vault presentation', () => {
    const base = fixed('light.vault', 1, 1, [1, 2, 3]);
    const presentation = { glyph: '*', token: 'fixture.lamp' };

    expect(() => calculate({ lights: [{ ...base, vaultPlacementId: 'vault.1' }] })).toThrow(/presentation/);
    expect(() => calculate({ lights: [{ ...base, presentation }] })).not.toThrow();
    expect(() => calculate({ lights: [{ ...base, vaultPlacementId: 'vault.1', presentation }] })).not.toThrow();
  });

  it('validates presented source glyphs and tokens', () => {
    const base = { ...fixed('light.vault', 1, 1, [1, 2, 3]), vaultPlacementId: 'vault.1' };

    expect(() => calculate({ lights: [{ ...base, presentation: { glyph: '**', token: 'fixture.lamp' } }] })).toThrow(/glyph/);
    expect(() => calculate({ lights: [{ ...base, presentation: { glyph: '*', token: 'Bad Token' } }] })).toThrow(/token/);
  });
});
