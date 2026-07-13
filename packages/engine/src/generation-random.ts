import type { FloorSeedAllocation } from './generation-model.js';
import type { Uint32State } from './model.js';
import { deriveSeed, isNonZeroState, nextUint32 } from './random.js';

const NON_ZERO_FALLBACK = 0x6d2b79f5;

export function allocateFloorSeed(generationState: Uint32State): FloorSeedAllocation {
  if (!isNonZeroState(generationState)) throw new RangeError('generation state must not be all zero');
  let state = generationState;
  const words: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const step = nextUint32(state);
    words.push(step.value);
    state = step.state;
  }
  const candidate = words as unknown as Uint32State;
  const floorSeed: Uint32State = isNonZeroState(candidate) ? candidate : [0, 0, 0, NON_ZERO_FALLBACK];
  return { floorSeed, nextGenerationState: state };
}

export function deriveAttemptSeed(floorSeed: Uint32State, attempt: number): Uint32State {
  if (!isNonZeroState(floorSeed)) throw new RangeError('floor seed must not be all zero');
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= 0xffff_ffff) {
    throw new RangeError('attempt must be a safe zero-based unsigned 32-bit integer');
  }
  return deriveSeed(floorSeed, attempt + 1);
}
