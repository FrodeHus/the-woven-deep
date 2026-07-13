import type { ActiveRun, TileId } from './model.js';
import { deriveRngStreams } from './random.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

const FLOOR_LINES = [
  '#######',
  '#.....#',
  '#..#..#',
  '#.....#',
  '#######',
] as const;

const tiles = FLOOR_LINES.flatMap((line) => [...line].map<TileId>((glyph) => glyph === '#' ? 0 : 1));
const seed = [1, 2, 3, 4] as const;

export function createDemoRun(): ActiveRun {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: ENGINE_GAME_VERSION,
    contentHash: 'a'.repeat(64),
    runId: 'run.demo',
    runSeed: seed,
    rng: deriveRngStreams(seed),
    revision: 0,
    turn: 0,
    hero: { heroId: 'hero.demo', name: 'Ada', floorId: 'floor.demo', x: 1, y: 1 },
    activeFloorId: 'floor.demo',
    floors: [{
      floorId: 'floor.demo', seed, generatorVersion: 1, width: 7, height: 5, depth: 1, tiles, entities: [],
    }],
    recentCommands: [],
  };
}
