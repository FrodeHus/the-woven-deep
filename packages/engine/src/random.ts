import type { RngStreams, Uint32State } from './model.js';
import { RNG_STREAM_NAMES, type RngStreamName } from './versions.js';

const GOLDEN_GAMMA = 0x9e3779b9;
const NON_ZERO_FALLBACK = 0x6d2b79f5;

const STREAM_DISCRIMINATORS: Readonly<Record<RngStreamName, number>> = {
  generation: 1,
  encounters: 2,
  combat: 3,
  loot: 4,
  effects: 5,
  narrative: 6,
};

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

export function splitMixWord(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export function deriveSeed(seed: Uint32State, discriminator: number): Uint32State {
  if (!isNonZeroState(seed)) throw new RangeError('source seed must not be all zero');
  if (!Number.isSafeInteger(discriminator) || discriminator <= 0 || discriminator > 0xffff_ffff) {
    throw new RangeError('seed discriminator must be a nonzero unsigned 32-bit integer');
  }
  let cursor = discriminator >>> 0;
  const words: number[] = [];
  for (let index = 0; index < seed.length; index += 1) {
    cursor = splitMixWord(
      (cursor ^ seed[index]! ^ Math.imul(index + 1, GOLDEN_GAMMA)) >>> 0,
    );
    words.push(cursor);
  }
  const state = words as unknown as Uint32State;
  return isNonZeroState(state) ? state : [0, 0, 0, NON_ZERO_FALLBACK];
}

export function foldSeed(seed: Uint32State): number {
  if (!isNonZeroState(seed)) throw new RangeError('source seed must not be all zero');
  const folded = splitMixWord((seed[0] ^ seed[1] ^ seed[2] ^ seed[3]) >>> 0);
  return folded === 0 ? NON_ZERO_FALLBACK : folded;
}

export interface RandomStep {
  readonly value: number;
  readonly state: Uint32State;
}

export function rollDie(state: Uint32State, sides: number): RandomStep {
  if (!Number.isSafeInteger(sides) || sides <= 0 || sides > 0x1_0000_0000) {
    throw new RangeError('die sides must be a positive safe integer no greater than 2^32');
  }
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  let cursor = state;
  for (;;) {
    const step = nextUint32(cursor);
    cursor = step.state;
    if (step.value < limit) return { value: step.value % sides + 1, state: cursor };
  }
}

export function isNonZeroState(state: Uint32State): boolean {
  return state.some((word) => word !== 0);
}

export function nextUint32(state: Uint32State): RandomStep {
  if (!isNonZeroState(state)) throw new Error('internal invariant: random state must not be all zero');
  const [initial0, initial1, initial2, initial3] = state;
  const value = Math.imul(rotateLeft(Math.imul(initial1, 5) >>> 0, 7), 9) >>> 0;
  const shifted = (initial1 << 9) >>> 0;
  let s2 = (initial2 ^ initial0) >>> 0;
  let s3 = (initial3 ^ initial1) >>> 0;
  let s1 = (initial1 ^ s2) >>> 0;
  let s0 = (initial0 ^ s3) >>> 0;
  s2 = (s2 ^ shifted) >>> 0;
  s3 = rotateLeft(s3, 11);
  return { value, state: [s0, s1, s2, s3] };
}

export function expandLegacySeed(seed: number): Uint32State {
  let cursor = seed >>> 0;
  const words: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    cursor = (cursor + GOLDEN_GAMMA) >>> 0;
    words.push(splitMixWord(cursor));
  }
  const state = words as unknown as Uint32State;
  return isNonZeroState(state) ? state : [0, 0, 0, NON_ZERO_FALLBACK];
}

function deriveStream(runSeed: Uint32State, discriminator: number): Uint32State {
  let cursor = discriminator >>> 0;
  for (let index = 0; index < runSeed.length; index += 1) {
    cursor = splitMixWord(
      (cursor ^ runSeed[index]! ^ Math.imul(index + 1, GOLDEN_GAMMA)) >>> 0,
    );
  }
  const state = expandLegacySeed(cursor);
  return isNonZeroState(state) ? state : [0, 0, 0, NON_ZERO_FALLBACK];
}

export function deriveRngStreams(runSeed: Uint32State): RngStreams {
  return Object.fromEntries(
    RNG_STREAM_NAMES.map((name) => [name, deriveStream(runSeed, STREAM_DISCRIMINATORS[name])]),
  ) as unknown as RngStreams;
}
