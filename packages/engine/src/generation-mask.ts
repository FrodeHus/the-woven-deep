import {
  CLASSIC_THEME_ID,
  GenerationError,
  type ClassicThemeSettings,
  type GenerationTheme,
} from './generation-model.js';

export interface ThemeMaskValidation {
  readonly cellCount: number;
  readonly componentStart: number;
  readonly farthestDistance: number;
}

export function maskWordCount(width: number, height: number): number {
  return Math.ceil(width * height / 32);
}

export function maskHas(maskWords: readonly number[], width: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width) return false;
  const index = y * width + x;
  return ((maskWords[index >>> 5]! >>> (index & 31)) & 1) === 1;
}

export function classicMask(width: number, height: number): readonly number[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 20 || width > 160 || height < 12 || height > 100) {
    throw new GenerationError('generation.invalid-theme', 'mask dimensions are outside the supported range');
  }
  const words = Array(maskWordCount(width, height)).fill(0) as number[];
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x;
    words[index >>> 5] = (words[index >>> 5]! | ((1 << (index & 31)) >>> 0)) >>> 0;
  }
  return words;
}

function neighbors(index: number, width: number, height: number): readonly number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [];
  if (y > 0) result.push(index - width);
  if (x + 1 < width) result.push(index + 1);
  if (y + 1 < height) result.push(index + width);
  if (x > 0) result.push(index - 1);
  return result;
}

function farthest(maskWords: readonly number[], width: number, height: number, start: number): { index: number; distance: number; count: number } {
  const distance = new Int32Array(width * height); distance.fill(-1);
  const queue = [start]; distance[start] = 0;
  let best = start;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const currentDistance = distance[current]!;
    if (currentDistance > distance[best]! || (currentDistance === distance[best]! && current < best)) best = current;
    for (const next of neighbors(current, width, height)) {
      if (distance[next] !== -1 || !maskHas(maskWords, width, next % width, Math.floor(next / width))) continue;
      distance[next] = currentDistance + 1;
      queue.push(next);
    }
  }
  return { index: best, distance: distance[best]!, count: queue.length };
}

export function validateThemeMask(
  width: number,
  height: number,
  maskWords: readonly number[],
  minimumRooms: number,
  minimumStairDistance: number,
): ThemeMaskValidation {
  if (maskWords.length !== maskWordCount(width, height)) {
    throw new GenerationError('generation.invalid-theme', 'theme mask has the wrong word count');
  }
  if (Array.from({ length: maskWords.length }, (_, index) => index).some((index) =>
    !(index in maskWords) || !Number.isInteger(maskWords[index]) || maskWords[index]! < 0 || maskWords[index]! > 0xffff_ffff)) {
    throw new GenerationError('generation.invalid-theme', 'theme mask words must be unsigned 32-bit integers');
  }
  const usedBits = width * height;
  const padding = maskWords.length * 32 - usedBits;
  if (padding > 0 && (maskWords.at(-1)! >>> (32 - padding)) !== 0) {
    throw new GenerationError('generation.invalid-theme', 'theme mask padding must be zero');
  }
  for (let x = 0; x < width; x += 1) {
    if (maskHas(maskWords, width, x, 0) || maskHas(maskWords, width, x, height - 1)) {
      throw new GenerationError('generation.invalid-theme', 'theme mask must exclude the outer border');
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (maskHas(maskWords, width, 0, y) || maskHas(maskWords, width, width - 1, y)) {
      throw new GenerationError('generation.invalid-theme', 'theme mask must exclude the outer border');
    }
  }
  let start = -1;
  let cellCount = 0;
  for (let index = 0; index < usedBits; index += 1) if (maskHas(maskWords, width, index % width, Math.floor(index / width))) {
    if (start === -1) start = index;
    cellCount += 1;
  }
  const requiredCells = Math.max(2, minimumRooms * 12, minimumStairDistance + 1);
  if (start === -1 || cellCount < requiredCells) {
    throw new GenerationError('generation.invalid-theme', 'theme mask has too few playable cells');
  }
  const first = farthest(maskWords, width, height, start);
  if (first.count !== cellCount) throw new GenerationError('generation.invalid-theme', 'theme mask must be four-way connected');
  const second = farthest(maskWords, width, height, first.index);
  if (second.distance < minimumStairDistance) {
    throw new GenerationError('generation.invalid-theme', 'theme mask cannot satisfy the fallback stair distance');
  }
  return { cellCount, componentStart: start, farthestDistance: second.distance };
}

export function createClassicTheme(width: number, height: number, settings: ClassicThemeSettings): GenerationTheme {
  if (!Number.isSafeInteger(width) || width < 20 || width > 160 || !Number.isSafeInteger(height) || height < 12 || height > 100) {
    throw new GenerationError('generation.invalid-theme', 'classic theme dimensions are outside the supported range');
  }
  const minimumRooms = settings.minimumRooms ?? 6;
  const minimumStairDistance = settings.minimumStairDistance ?? 20;
  const { color, strength } = settings.ambient;
  if (!Number.isSafeInteger(minimumRooms) || minimumRooms < 1 || !Number.isSafeInteger(minimumStairDistance) || minimumStairDistance < 1
    || color.length !== 3 || color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
    || !Number.isInteger(strength) || strength < 0 || strength > 255) {
    throw new GenerationError('generation.invalid-theme', 'classic theme settings are invalid');
  }
  const maskWords = classicMask(width, height);
  validateThemeMask(width, height, maskWords, minimumRooms, minimumStairDistance);
  return { themeId: CLASSIC_THEME_ID, maskWords, ambient: settings.ambient, minimumRooms, minimumStairDistance };
}
