import { RNG } from 'rot-js';
import { describe, expect, it } from 'vitest';

import * as engine from '../src/index.js';
import { withRotSeed } from '../src/rot-adapter.js';

describe('ROT.js adapter', () => {
  it('repeats the same values for the same seed', () => {
    const draw = (): readonly number[] => withRotSeed(123, () => [RNG.getUniform(), RNG.getUniform()]);

    expect(draw()).toEqual(draw());
  });

  it('restores the caller state after success', () => {
    const callerState = [...RNG.getState()];

    withRotSeed(123, () => [RNG.getUniform(), RNG.getUniform()]);

    expect(RNG.getState()).toEqual(callerState);
  });

  it('restores the caller state when the operation throws', () => {
    const callerState = [...RNG.getState()];
    const failure = new Error('operation failed');

    expect(() => withRotSeed(123, () => {
      RNG.getUniform();
      throw failure;
    })).toThrow(failure);
    expect(RNG.getState()).toEqual(callerState);
  });

  it.each([0, -1, 1.5, 0x1_0000_0000, Number.NaN])('rejects invalid seed %s', (seed) => {
    expect(() => withRotSeed(seed, () => undefined)).toThrow(
      new RangeError('ROT seed must be a nonzero unsigned 32-bit integer'),
    );
  });

  it('restores an immediate caller state after a nested successful call', () => {
    const expected = withRotSeed(321, () => [RNG.getUniform(), RNG.getUniform()]);

    const actual = withRotSeed(321, () => {
      const first = RNG.getUniform();
      withRotSeed(123, () => RNG.getUniform());
      return [first, RNG.getUniform()];
    });

    expect(actual).toEqual(expected);
  });

  it('restores an immediate caller state after a nested failing call', () => {
    const expected = withRotSeed(321, () => [RNG.getUniform(), RNG.getUniform()]);

    const actual = withRotSeed(321, () => {
      const first = RNG.getUniform();
      try {
        withRotSeed(123, () => {
          RNG.getUniform();
          throw new Error('nested failure');
        });
      } catch {
        // The outer operation continues from its own state.
      }
      return [first, RNG.getUniform()];
    });

    expect(actual).toEqual(expected);
  });

  it('does not expose ROT.js objects from the engine package', () => {
    expect(engine).not.toHaveProperty('RNG');
    expect(engine).not.toHaveProperty('FOV');
  });
});
