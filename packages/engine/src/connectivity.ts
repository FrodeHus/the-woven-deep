import type { FloorSnapshot, Point, TileId } from './model.js';
import { tileDefinition } from './terrain.js';

export interface ConnectivityInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly start?: Readonly<{ x: number; y: number }>;
  readonly target?: Readonly<{ x: number; y: number }>;
  /**
   * Which edges the walk follows. `'orthogonal'` (the default) is the conservative 4-way graph
   * every generation-time cull uses. `'movement'` is the graph the hero actually walks: 8-way
   * with the corner rule (a diagonal step needs at least one traversable orthogonal flank) --
   * `movementAction`'s truth, restated over tiles. Routes differ between the two; components do
   * not (a diagonal edge always implies a two-step orthogonal detour through a flank).
   */
  readonly graph?: 'orthogonal' | 'movement';
}

export interface RequiredRouteInput {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly TileId[];
  readonly requiredPoints: readonly Readonly<{ x: number; y: number }>[];
  readonly blockedPoints: readonly Readonly<{ x: number; y: number }>[];
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

/**
 * The hero's step graph from `index`: the four orthogonals plus each diagonal whose corner rule
 * holds -- the diagonal target may be entered only when at least one of its two orthogonal flanks
 * is itself traversable (`movementAction`'s `blocked.corner`). Orthogonal candidates are emitted
 * unfiltered like `candidateNeighbors` (the caller re-checks traversability); diagonals must be
 * flank-checked here because the rule reads two OTHER cells the caller never looks at.
 */
function movementNeighbors(
  index: number,
  width: number,
  height: number,
  traversable: (index: number) => boolean,
): readonly number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [...candidateNeighbors(index, width, height)];
  for (const [dx, dy] of [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (traversable(y * width + nx) || traversable(ny * width + x)) {
      result.push(ny * width + nx);
    }
  }
  return result;
}

export function analyzeConnectivity(input: ConnectivityInput): ConnectivityAnalysis {
  const { width, height, tiles } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    tiles.length !== width * height
  ) {
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
    if (
      !Number.isSafeInteger(point.x) ||
      !Number.isSafeInteger(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= width ||
      point.y >= height
    ) {
      throw new RangeError(`${label} is out of bounds`);
    }
    const index = point.y * width + point.x;
    if (!tileDefinition(tiles[index]!).potentiallyTraversable)
      throw new RangeError(`${label} is not traversable`);
    return index;
  };
  const start = input.start ? pointIndex(input.start, 'start') : first;
  const target = input.target ? pointIndex(input.target, 'target') : -1;
  const visitedWords = Array(Math.ceil(tiles.length / 32)).fill(0) as number[];
  if (start === -1)
    return {
      visitedWords,
      componentSize: 0,
      traversableCellCount: 0,
      connected: true,
      distance: null,
      route: [],
    };
  const distance = new Int32Array(tiles.length);
  distance.fill(-1);
  const previous = new Int32Array(tiles.length);
  previous.fill(-1);
  const queue = [start];
  distance[start] = 0;
  visitedWords[start >>> 5] = (visitedWords[start >>> 5]! | ((1 << (start & 31)) >>> 0)) >>> 0;
  const traversable = (index: number): boolean =>
    tileDefinition(tiles[index]!).potentiallyTraversable;
  const neighbors =
    input.graph === 'movement'
      ? (index: number): readonly number[] => movementNeighbors(index, width, height, traversable)
      : (index: number): readonly number[] => candidateNeighbors(index, width, height);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of neighbors(current)) {
      if (distance[next] !== -1 || !traversable(next)) continue;
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

/**
 * Every traversable cell whose removal would split the component it belongs to -- the articulation
 * points of the floor's walkable graph, in one linear pass (iterative Tarjan lowlink, so a large
 * floor can never blow the call stack).
 *
 * A cell in here is a cell nothing that permanently blocks movement may stand on: block it and some
 * other pair of cells stops being mutually reachable. Chest placement culls its candidate pool with
 * this; a one-wide ledge is exactly such a cell, and a chest dropped there strands the hero behind
 * the diagonal-corner rule with no way through.
 *
 * The graph is the `potentiallyTraversable` one `analyzeConnectivity` walks, not the `walkable` one:
 * doors open, so a closed door must not be read as a cut in the floor.
 *
 * `blockedIndexes` overlays cells that already hold a permanent movement block (a committed locked
 * chest, an earlier placement in the same pass) as walls: two placements can jointly seal a
 * two-wide passage with neither cell a cut of the BARE graph, so each subsequent placement must
 * analyze the graph its predecessors actually left behind (#194).
 */
export function articulationIndexes(
  input: Readonly<{ width: number; height: number; tiles: readonly TileId[] }>,
  blockedIndexes?: ReadonlySet<number>,
): ReadonlySet<number> {
  const { width, height, tiles } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    tiles.length !== width * height
  ) {
    throw new RangeError('articulation dimensions and dense tile count must agree');
  }
  const traversable = (index: number): boolean =>
    tileDefinition(tiles[index]!).potentiallyTraversable &&
    !(blockedIndexes?.has(index) ?? false);
  const discovered = new Int32Array(tiles.length).fill(-1);
  const low = new Int32Array(tiles.length).fill(-1);
  const result = new Set<number>();
  let timer = 0;

  for (let root = 0; root < tiles.length; root += 1) {
    if (discovered[root] !== -1 || !traversable(root)) continue;
    discovered[root] = timer;
    low[root] = timer;
    timer += 1;
    let rootChildren = 0;
    const stack: { node: number; parent: number; cursor: number }[] = [
      { node: root, parent: -1, cursor: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = candidateNeighbors(frame.node, width, height);
      if (frame.cursor < neighbors.length) {
        const next = neighbors[frame.cursor]!;
        frame.cursor += 1;
        if (!traversable(next)) continue;
        if (discovered[next] === -1) {
          discovered[next] = timer;
          low[next] = timer;
          timer += 1;
          if (frame.node === root) rootChildren += 1;
          stack.push({ node: next, parent: frame.node, cursor: 0 });
        } else if (next !== frame.parent) {
          low[frame.node] = Math.min(low[frame.node]!, discovered[next]!);
        }
        continue;
      }
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent === undefined) continue;
      low[parent.node] = Math.min(low[parent.node]!, low[frame.node]!);
      if (parent.node !== root && low[frame.node]! >= discovered[parent.node]!)
        result.add(parent.node);
    }
    if (rootChildren > 1) result.add(root);
  }
  return result;
}

export function preservesRequiredRoutes(input: RequiredRouteInput): boolean {
  const { width, height, tiles } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    tiles.length !== width * height
  ) {
    throw new RangeError('required route dimensions and dense tile count must agree');
  }
  if (input.requiredPoints.length < 2) return true;
  const indexOf = (point: Readonly<{ x: number; y: number }>, label: string): number => {
    if (
      !Number.isSafeInteger(point.x) ||
      !Number.isSafeInteger(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= width ||
      point.y >= height
    ) {
      throw new RangeError(`${label} is out of bounds`);
    }
    return point.y * width + point.x;
  };
  const blocked = new Set(input.blockedPoints.map((point) => indexOf(point, 'blocked point')));
  const required = input.requiredPoints.map((point) => indexOf(point, 'required point'));
  if (
    required.some(
      (index) => blocked.has(index) || !tileDefinition(tiles[index]!).potentiallyTraversable,
    )
  )
    return false;
  const visited = new Uint8Array(tiles.length);
  const queue = [required[0]!];
  visited[required[0]!] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of candidateNeighbors(current, width, height)) {
      if (
        visited[next] === 1 ||
        blocked.has(next) ||
        !tileDefinition(tiles[next]!).potentiallyTraversable
      )
        continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  return required.every((index) => visited[index] === 1);
}

export function requiredPoints(floor: FloorSnapshot): readonly Point[] {
  return [
    floor.stairUp,
    floor.stairDown,
    ...floor.placementSlots.filter((slot) => slot.kind === 'objective'),
  ].filter((point): point is Point => point !== null);
}

export function protectedRouteIndexes(floor: FloorSnapshot): ReadonlySet<number> {
  const points = requiredPoints(floor);
  const protectedIndexes = new Set<number>();
  const start = points[0];
  if (!start) return protectedIndexes;
  for (const target of points.slice(1)) {
    // The movement graph, not the 4-way one: the protected route exists so the hero can actually
    // walk between the required points, and the hero steps diagonally under the corner rule. A
    // 4-way route protects a staircase shape the hero never walks (#194).
    const route = analyzeConnectivity({
      width: floor.width,
      height: floor.height,
      tiles: floor.tiles,
      start,
      target,
      graph: 'movement',
    }).route;
    for (const point of route) protectedIndexes.add(point.y * floor.width + point.x);
  }
  return protectedIndexes;
}
