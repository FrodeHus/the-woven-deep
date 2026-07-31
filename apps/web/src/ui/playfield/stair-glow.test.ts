import { describe, expect, it } from 'vitest';
import type { ObservableCell } from '@woven-deep/engine';
import {
  stairGlowAlpha,
  stairGlowsForFloor,
  STAIR_GLOW_MAX_ALPHA,
  STAIR_GLOW_MIN_ALPHA,
  STAIR_DOWN_GLOW_COLOR,
  STAIR_UP_GLOW_COLOR,
} from './stair-glow.js';

function cell(
  index: number,
  x: number,
  y: number,
  knowledge: ObservableCell['knowledge'],
  glyph: string,
  token: string,
): ObservableCell {
  return { index, x, y, knowledge, intensity: 200, glyph, token };
}

describe('stairGlowsForFloor', () => {
  it('emits one glow per discovered stair cell, keyed down/up by glyph', () => {
    const glows = stairGlowsForFloor([
      cell(0, 0, 0, 'visible', '>', 'terrain.stair'),
      cell(1, 1, 0, 'remembered', '<', 'terrain.stair'),
      cell(2, 2, 0, 'visible', '.', 'terrain.floor'),
    ]);
    expect(glows).toHaveLength(2);
    expect(glows[0]).toMatchObject({ x: 0, y: 0, direction: 'down' });
    expect(glows[1]).toMatchObject({ x: 1, y: 0, direction: 'up' });
  });

  it('never glows an undiscovered stair, so the glow cannot leak hidden terrain', () => {
    expect(stairGlowsForFloor([cell(0, 3, 4, 'unknown', '>', 'terrain.stair')])).toEqual([]);
  });

  it('gives neighbouring stairs different breathing phases', () => {
    const glows = stairGlowsForFloor([
      cell(0, 0, 0, 'visible', '>', 'terrain.stair'),
      cell(1, 1, 0, 'visible', '>', 'terrain.stair'),
    ]);
    expect(glows[0]!.phase).not.toBe(glows[1]!.phase);
  });

  it('uses a warm tint for stairs down and a cool one for stairs up', () => {
    expect(STAIR_DOWN_GLOW_COLOR).not.toBe(STAIR_UP_GLOW_COLOR);
    // Warm = red channel dominant; cool = blue channel dominant.
    expect((STAIR_DOWN_GLOW_COLOR >> 16) & 0xff).toBeGreaterThan(STAIR_DOWN_GLOW_COLOR & 0xff);
    expect(STAIR_UP_GLOW_COLOR & 0xff).toBeGreaterThan((STAIR_UP_GLOW_COLOR >> 16) & 0xff);
  });
});

describe('stairGlowAlpha', () => {
  it('breathes strictly inside the subtle alpha band', () => {
    for (let ms = 0; ms < 12_000; ms += 137) {
      const alpha = stairGlowAlpha(0, ms);
      expect(alpha).toBeGreaterThanOrEqual(STAIR_GLOW_MIN_ALPHA - 1e-9);
      expect(alpha).toBeLessThanOrEqual(STAIR_GLOW_MAX_ALPHA + 1e-9);
    }
  });

  it('stays subtle: never opaque enough to read as UI', () => {
    expect(STAIR_GLOW_MAX_ALPHA).toBeLessThan(0.3);
  });

  it('is deterministic for the same phase and time', () => {
    expect(stairGlowAlpha(1.5, 4321)).toBe(stairGlowAlpha(1.5, 4321));
  });

  it('actually moves over time', () => {
    expect(stairGlowAlpha(0, 0)).not.toBeCloseTo(stairGlowAlpha(0, 1400), 5);
  });
});
