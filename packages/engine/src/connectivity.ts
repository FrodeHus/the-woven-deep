import type { TileId } from './model.js';
import { tileDefinition } from './terrain.js';

export interface ConnectivityInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly start?: Readonly<{ x: number; y: number }>;
  readonly target?: Readonly<{ x: number; y: number }>;
}

export interface ConnectivityAnalysis {
  readonly visitedWords: readonly number[];
  readonly componentSize: number;
  readonly traversableCellCount: number;
  readonly connected: boolean;
  readonly distance: number | null;
  readonly route: readonly Readonly<{ x: number; y: number }>[];
}

function candidateNeighbors(index: number, width: number, height: number): readonly number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [];
  if (y > 0) result.push(index - width);
  if (x + 1 < width) result.push(index + 1);
  if (y + 1 < height) result.push(index + width);
  if (x > 0) result.push(index - 1);
  return result;
}

export function analyzeConnectivity(input: ConnectivityInput): ConnectivityAnalysis {
  const { width, height, tiles } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || tiles.length !== width * height) {
    throw new RangeError('connectivity dimensions and dense tile count must agree');
  }
  let traversableCellCount = 0;
  let first = -1;
  for (let index = 0; index < tiles.length; index += 1) {
    if (!(index in tiles)) throw new RangeError('connectivity tiles must be dense');
    if (tileDefinition(tiles[index]!).potentiallyTraversable) {
      traversableCellCount += 1;
      if (first === -1) first = index;
    }
  }
  const pointIndex = (point: Readonly<{ x: number; y: number }>, label: string): number => {
    if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
      throw new RangeError(`${label} is out of bounds`);
    }
    const index = point.y * width + point.x;
    if (!tileDefinition(tiles[index]!).potentiallyTraversable) throw new RangeError(`${label} is not traversable`);
    return index;
  };
  const start = input.start ? pointIndex(input.start, 'start') : first;
  const target = input.target ? pointIndex(input.target, 'target') : -1;
  const visitedWords = Array(Math.ceil(tiles.length / 32)).fill(0) as number[];
  if (start === -1) return { visitedWords, componentSize: 0, traversableCellCount: 0, connected: true, distance: null, route: [] };
  const distance = new Int32Array(tiles.length); distance.fill(-1);
  const previous = new Int32Array(tiles.length); previous.fill(-1);
  const queue = [start]; distance[start] = 0;
  visitedWords[start >>> 5] = (visitedWords[start >>> 5]! | ((1 << (start & 31)) >>> 0)) >>> 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of candidateNeighbors(current, width, height)) {
      if (distance[next] !== -1 || !tileDefinition(tiles[next]!).potentiallyTraversable) continue;
      distance[next] = distance[current]! + 1;
      previous[next] = current;
      visitedWords[next >>> 5] = (visitedWords[next >>> 5]! | ((1 << (next & 31)) >>> 0)) >>> 0;
      queue.push(next);
    }
  }
  const routeIndices: number[] = [];
  if (target !== -1 && distance[target] !== -1) {
    for (let cursor = target; cursor !== -1; cursor = previous[cursor]!) routeIndices.push(cursor);
    routeIndices.reverse();
  }
  return {
    visitedWords,
    componentSize: queue.length,
    traversableCellCount,
    connected: queue.length === traversableCellCount,
    distance: target === -1 || distance[target] === -1 ? null : distance[target]!,
    route: routeIndices.map((index) => ({ x: index % width, y: Math.floor(index / width) })),
  };
}
