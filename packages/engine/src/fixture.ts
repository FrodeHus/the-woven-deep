import type { ActiveRun, TileId } from './model.js';
import { deriveRngStreams } from './random.js';
import { createUnknownKnowledge } from './knowledge.js';
import { refreshKnowledge } from './perception.js';
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
  const hero = { heroId: 'hero.demo', name: 'Ada', floorId: 'floor.demo', x: 1, y: 1, sightRadius: 12 } as const;
  const floor = {
    floorId: 'floor.demo', seed, generatorVersion: 1 as const, width: 7, height: 5, depth: 1, tiles, entities: [],
    themeId: 'theme.demo', ambient: { color: [255, 255, 255] as const, strength: 255 },
    knowledge: createUnknownKnowledge(tiles.length), lights: [], stairUp: null, stairDown: null, vaults: [], placementSlots: [],
  };
  const knowledge = refreshKnowledge({ floor, hero, actors: new Map([[hero.heroId, hero]]) }).knowledge;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: ENGINE_GAME_VERSION,
    contentHash: 'a'.repeat(64),
    runId: 'run.demo',
    runSeed: seed,
    rng: deriveRngStreams(seed),
    revision: 0,
    turn: 0,
    hero,
    activeFloorId: 'floor.demo',
    floors: [{ ...floor, knowledge }],
    recentCommands: [],
  };
}
