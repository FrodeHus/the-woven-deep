import { RNG } from 'rot-js';

export function withRotSeed<T>(seed: number, operation: () => T): T {
  if (!Number.isInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new RangeError('ROT seed must be a nonzero unsigned 32-bit integer');
  }

  const previous = [...RNG.getState()] as ReturnType<typeof RNG.getState>;
  try {
    RNG.setSeed(seed);
    return operation();
  } finally {
    RNG.setState(previous);
  }
}
