import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, EncounterContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createDemoRun,
  createUnknownKnowledge,
  placePopulation,
  type ActiveRun,
  type FloorSnapshot,
} from '../src/index.js';

let content: CompiledContentPack;

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function encounters(): readonly EncounterContentEntry[] {
  return content.entries.filter(
    (entry): entry is EncounterContentEntry => entry.kind === 'encounter',
  );
}

// A large, fully-open floor so a legal placement always exists when a candidate is eligible.
function openFloor(depth: number): FloorSnapshot {
  const width = 24;
  const height = 16;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? (0 as const) : (1 as const);
  });
  tiles[1 * width + 1] = 4;
  tiles[(height - 2) * width + (width - 2)] = 5;
  return {
    floorId: 'floor.deep',
    seed: [1, 2, 3, 4],
    generatorVersion: 2,
    width,
    height,
    depth,
    tiles,
    entities: [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 1, y: 1 },
    stairDown: { x: width - 2, y: height - 2 },
    vaults: [],
    placementSlots: [],
  };
}

// Mark every encounter eligible so only the depth gate decides the candidate set.
function runWithAllEligible(): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    rng: { ...base.rng, encounters: [1, 2, 3, 4] },
    encounterDecisions: encounters()
      .map((entry) => ({
        encounterId: entry.id,
        baseProbability: entry.runAppearanceChance,
        protectionBonus: 0,
        effectiveProbability: entry.runAppearanceChance,
        eligible: true,
        reachedEligibleDepth: false,
        encountered: false,
        instancesCreated: 0,
      }))
      .sort((left, right) => (left.encounterId < right.encounterId ? -1 : 1)),
  };
}

describe('deep-dungeon depth-band population', () => {
  it.each([13, 15, 17, 19])('has a non-empty candidate encounter set at depth %i', (depth) => {
    const result = placePopulation({
      run: runWithAllEligible(),
      floor: openFloor(depth),
      content,
    });
    // candidates() empty -> status 'skipped' with reason 'no-eligible-encounter'.
    expect(result.reason).not.toBe('no-eligible-encounter');
    expect(result.status).toBe('placed');
    expect(result.encounterId).not.toBeNull();
  });

  it('offers only Bound encounters at depth 13 (previously a total void)', () => {
    const depth = 13;
    const eligible = encounters().filter(
      (entry) => depth >= entry.minDepth && depth <= entry.maxDepth,
    );
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((entry) => entry.tags.includes('the-bound'))).toBe(true);
  });

  it('covers every deep floor 13 through 19 with at least one eligible encounter', () => {
    for (let depth = 13; depth <= 19; depth += 1) {
      const eligible = encounters().filter(
        (entry) => depth >= entry.minDepth && depth <= entry.maxDepth,
      );
      expect(eligible.length, `depth ${depth}`).toBeGreaterThan(0);
    }
  });
});
