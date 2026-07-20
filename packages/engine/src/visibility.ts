import { FOV } from 'rot-js';

import type { TileId } from './model.js';
import { isTileId, tileDefinition } from './terrain.js';

export interface FieldOfViewInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly origin: Readonly<{ x: number; y: number }>;
  readonly radius: number;
}

const UNSIGNED_32_BIT_MAX = 0xffff_ffff;

function assertPositiveDimension(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertTileId(tile: unknown, tileIndex: number): asserts tile is TileId {
  if (!isTileId(tile)) {
    throw new TypeError(`tile ${tileIndex} must be a valid tile ID`);
  }
}

function validateInput(input: FieldOfViewInput): number {
  assertPositiveDimension(input.width, 'field width');
  assertPositiveDimension(input.height, 'field height');
  const cellCount = input.width * input.height;
  if (!Number.isSafeInteger(cellCount)) {
    throw new RangeError('field cell count must be a safe integer');
  }

  if (
    !Number.isSafeInteger(input.origin.x) ||
    !Number.isSafeInteger(input.origin.y) ||
    input.origin.x < 0 ||
    input.origin.x >= input.width ||
    input.origin.y < 0 ||
    input.origin.y >= input.height
  ) {
    throw new RangeError('field origin must be an integer point within the field');
  }
  if (!Number.isSafeInteger(input.radius) || input.radius < 0) {
    throw new RangeError('field radius must be a nonnegative safe integer');
  }
  if (input.tiles.length !== cellCount) {
    throw new RangeError(`tile length must be ${cellCount}`);
  }
  for (let tileIndex = 0; tileIndex < input.tiles.length; tileIndex += 1) {
    assertTileId(input.tiles[tileIndex]!, tileIndex);
  }
  return cellCount;
}

function crossesSealedCorner(input: FieldOfViewInput, targetX: number, targetY: number): boolean {
  const deltaX = targetX - input.origin.x;
  const deltaY = targetY - input.origin.y;
  const stepX = Math.sign(deltaX);
  const stepY = Math.sign(deltaY);
  const horizontalSteps = Math.abs(deltaX);
  const verticalSteps = Math.abs(deltaY);
  let completedHorizontal = 0;
  let completedVertical = 0;
  let x = input.origin.x;
  let y = input.origin.y;

  while (completedHorizontal < horizontalSteps || completedVertical < verticalSteps) {
    const decision =
      (1 + 2 * completedHorizontal) * verticalSteps - (1 + 2 * completedVertical) * horizontalSteps;
    if (decision === 0) {
      const horizontalSide = input.tiles[y * input.width + x + stepX]!;
      const verticalSide = input.tiles[(y + stepY) * input.width + x]!;
      if (tileDefinition(horizontalSide).opaque && tileDefinition(verticalSide).opaque) return true;
      x += stepX;
      y += stepY;
      completedHorizontal += 1;
      completedVertical += 1;
    } else if (decision < 0) {
      x += stepX;
      completedHorizontal += 1;
    } else {
      y += stepY;
      completedVertical += 1;
    }
  }

  return false;
}

function setVisible(words: number[], cellIndex: number): void {
  const wordIndex = Math.floor(cellIndex / 32);
  words[wordIndex] = (words[wordIndex]! | (1 << (cellIndex % 32))) >>> 0;
}

export function computeFieldOfView(input: FieldOfViewInput): readonly number[] {
  const cellCount = validateInput(input);
  const candidates = new Set<number>();
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < input.width && y >= 0 && y < input.height;
  const sight = new FOV.PreciseShadowcasting(
    (x, y) => {
      if (!inBounds(x, y)) return false;
      return !tileDefinition(input.tiles[y * input.width + x]!).opaque;
    },
    { topology: 8 },
  );

  sight.compute(input.origin.x, input.origin.y, input.radius, (x, y) => {
    if (!inBounds(x, y)) return;
    const distance = Math.ceil(Math.sqrt((x - input.origin.x) ** 2 + (y - input.origin.y) ** 2));
    if (distance <= input.radius) candidates.add(y * input.width + x);
  });

  const words = Array<number>(Math.ceil(cellCount / 32)).fill(0);
  for (const candidate of candidates) {
    const targetX = candidate % input.width;
    const targetY = Math.floor(candidate / input.width);
    if (!crossesSealedCorner(input, targetX, targetY)) setVisible(words, candidate);
  }
  return words;
}

export function isVisible(words: readonly number[], index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index >= words.length * 32) {
    throw new RangeError(
      'visibility index must be a nonnegative safe integer within the packed storage',
    );
  }
  const word = words[Math.floor(index / 32)]!;
  if (!Number.isInteger(word) || word < 0 || word > UNSIGNED_32_BIT_MAX) {
    throw new TypeError('visibility word must be an unsigned 32-bit integer');
  }
  return ((word >>> (index % 32)) & 1) === 1;
}
