import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ClassContentEntry, CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { GameplayProjection, RunMetrics, StoredHallRecord } from '@woven-deep/engine';
import { emptyRunMetrics } from '@woven-deep/engine';
import {
  accumulateSightings,
  deriveCodexState,
  loadSightings,
  saveSightings,
  sortedClassEntries,
  SIGHTINGS_KEY,
  type CodexEntry,
  type Sightings,
} from '../src/session/codex.js';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function fakeStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
  };
}

function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return { ...emptyRunMetrics(), ...overrides };
}

function record(overrides: Partial<StoredHallRecord> = {}): StoredHallRecord {
  return {
    recordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    heroName: 'Ada',
    classTags: ['wayfarer'],
    completionType: 'died',
    cause: { killerContentId: 'monster.cave-rat', depth: 3, turn: 12, worldTime: 12 },
    deepestDepth: 3,
    score: { lines: [], total: 40 },
    metrics: metrics({ deepestDepth: 3 }),
    reputations: [],
    heirloom: {
      contentId: 'item.iron-sword',
      sourceItemId: null,
      enchantment: null,
      condition: 100,
      charges: null,
      fuel: null,
      qualityRank: 1,
      displayName: "Ada's Iron Sword",
      glyph: ')',
      color: '#d8d8d8',
      originatingHallRecordId: 'record.aaaaaaaa00000000.aaaaaaaaaaaaaaaa',
    },
    build: {
      attributes: { might: 14, agility: 12, vitality: 16, wits: 10, resolve: 12 },
      equippedItemContentIds: ['item.iron-sword'],
      signatureAbilityIds: [],
    },
    runSeed: 'aaaaaaaa00000000',
    contentHash: 'b'.repeat(64),
    enrichment: { achievedAt: 'Run #1', portraitGlyph: '@' },
    ...overrides,
  };
}

function snapshotWithClassTags(classTags: readonly string[]): SessionSnapshot {
  return {
    projection: {} as GameplayProjection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: classTags,
    onboarding: { counts: {}, dismissed: [] },
  };
}

const EMPTY_SIGHTINGS: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };

/** A minimal floor projection with no cells/slots -- landmark capture then contributes nothing,
 * so tests that don't care about landmarks can ignore them entirely. */
const EMPTY_FLOOR = { floorId: 'floor.town', town: false, cells: [] };

describe('loadSightings', () => {
  it('returns the empty cache, uncorrupted, when the key is absent', () => {
    expect(loadSightings(fakeStorage())).toEqual({ sightings: EMPTY_SIGHTINGS, corrupted: false });
  });

  it('round-trips a saved cache', () => {
    const storage = fakeStorage();
    saveSightings(storage, {
      monsterIds: ['monster.cave-rat'],
      itemIds: ['item.iron-sword'],
      landmarks: [{ floorId: 'floor.town', kind: 'house', name: 'The house', x: 1, y: 1 }],
    });
    expect(loadSightings(storage)).toEqual({
      sightings: {
        monsterIds: ['monster.cave-rat'],
        itemIds: ['item.iron-sword'],
        landmarks: [{ floorId: 'floor.town', kind: 'house', name: 'The house', x: 1, y: 1 }],
      },
      corrupted: false,
    });
  });

  it('is forward-tolerant of an OLD blob written before landmarks existed -- loads with [] landmarks, NOT corrupted', () => {
    const storage = fakeStorage();
    storage.set(SIGHTINGS_KEY, JSON.stringify({ monsterIds: ['monster.cave-rat'], itemIds: [] }));
    expect(loadSightings(storage)).toEqual({
      sightings: { monsterIds: ['monster.cave-rat'], itemIds: [], landmarks: [] },
      corrupted: false,
    });
  });

  it('falls back to the empty cache and reports corrupted for malformed JSON', () => {
    const storage = fakeStorage();
    storage.set(SIGHTINGS_KEY, '{not json');
    expect(loadSightings(storage)).toEqual({ sightings: EMPTY_SIGHTINGS, corrupted: true });
  });

  it('falls back to the empty cache and reports corrupted for a wrong-shaped blob', () => {
    const storage = fakeStorage();
    storage.set(SIGHTINGS_KEY, JSON.stringify({ monsterIds: 'not-an-array', itemIds: [] }));
    expect(loadSightings(storage)).toEqual({ sightings: EMPTY_SIGHTINGS, corrupted: true });
  });

  it('falls back to the empty cache and reports corrupted for a present but malformed landmarks field', () => {
    const storage = fakeStorage();
    storage.set(
      SIGHTINGS_KEY,
      JSON.stringify({ monsterIds: [], itemIds: [], landmarks: 'not-an-array' }),
    );
    expect(loadSightings(storage)).toEqual({ sightings: EMPTY_SIGHTINGS, corrupted: true });
  });
});

function projectionWith(
  overrides: Partial<{
    actors: readonly Readonly<{
      contentId: string | null;
      x?: number;
      y?: number;
      name?: string;
      factionName?: string;
    }>[];
    backpack: readonly Readonly<{ contentId?: string }>[];
    equipment: Readonly<Record<string, Readonly<{ contentId?: string }> | null>>;
    groundItems: readonly Readonly<{ contentId?: string }>[];
    trade: Readonly<{ stock: readonly Readonly<{ item: Readonly<{ contentId?: string }> }>[] }>;
    floor: Readonly<{
      floorId: string;
      town: boolean;
      cells: readonly Readonly<{
        knowledge: 'unknown' | 'remembered' | 'visible';
        tileId?: number;
        x: number;
        y: number;
      }>[];
    }>;
    slots: readonly Readonly<{ tags: readonly string[]; x: number; y: number }>[];
  }>,
): GameplayProjection {
  return {
    actors: overrides.actors ?? [],
    hero: { backpack: overrides.backpack ?? [], equipment: overrides.equipment ?? {} },
    groundItems: overrides.groundItems ?? [],
    floor: overrides.floor ?? EMPTY_FLOOR,
    slots: overrides.slots ?? [],
    ...(overrides.trade ? { trade: overrides.trade } : {}),
  } as unknown as GameplayProjection;
}

describe('accumulateSightings', () => {
  it("adds a visible actor's contentId", () => {
    const projection = projectionWith({ actors: [{ contentId: 'monster.cave-rat' }] });
    expect(accumulateSightings(EMPTY_SIGHTINGS, projection)).toEqual({
      monsterIds: ['monster.cave-rat'],
      itemIds: [],
      landmarks: [],
    });
  });

  it('ignores a null actor contentId (hero/fallen-champion/echo)', () => {
    const projection = projectionWith({
      actors: [{ contentId: null }, { contentId: 'monster.cave-rat' }],
    });
    expect(accumulateSightings(EMPTY_SIGHTINGS, projection)).toEqual({
      monsterIds: ['monster.cave-rat'],
      itemIds: [],
      landmarks: [],
    });
  });

  it('adds identified items from backpack, equipment, ground, and merchant stock', () => {
    const projection = projectionWith({
      backpack: [{ contentId: 'item.travel-ration' }, {}],
      equipment: { 'main-hand': { contentId: 'item.iron-sword' }, 'off-hand': null },
      groundItems: [{ contentId: 'item.wooden-arrows' }],
      trade: { stock: [{ item: { contentId: 'item.lamp-oil' } }, { item: {} }] },
    });
    expect(accumulateSightings(EMPTY_SIGHTINGS, projection).itemIds).toEqual([
      'item.iron-sword',
      'item.lamp-oil',
      'item.travel-ration',
      'item.wooden-arrows',
    ]);
  });

  it('is monotone: never drops a previously accumulated id', () => {
    const prev: Sightings = {
      monsterIds: ['monster.cave-rat'],
      itemIds: ['item.iron-sword'],
      landmarks: [],
    };
    const projection = projectionWith({ actors: [], backpack: [] });
    expect(accumulateSightings(prev, projection)).toEqual(prev);
  });

  it('dedupes and sorts', () => {
    const prev: Sightings = { monsterIds: ['monster.cave-rat'], itemIds: [], landmarks: [] };
    const projection = projectionWith({
      actors: [{ contentId: 'monster.cave-rat' }, { contentId: 'monster.training-beetle' }],
    });
    expect(accumulateSightings(prev, projection).monsterIds).toEqual([
      'monster.cave-rat',
      'monster.training-beetle',
    ]);
  });

  describe('landmarks', () => {
    it('captures a stair-up and a stair-down landmark once their cells are non-unknown', () => {
      const projection = projectionWith({
        floor: {
          floorId: 'floor.dungeon-1',
          town: false,
          cells: [
            { knowledge: 'remembered', tileId: 4, x: 3, y: 1 },
            { knowledge: 'visible', tileId: 5, x: 7, y: 2 },
            { knowledge: 'unknown', tileId: 4, x: 9, y: 9 },
          ],
        },
      });
      const { landmarks } = accumulateSightings(EMPTY_SIGHTINGS, projection);
      expect(landmarks).toEqual([
        { floorId: 'floor.dungeon-1', kind: 'stair-up', name: 'Stairs up', x: 3, y: 1 },
        { floorId: 'floor.dungeon-1', kind: 'stair-down', name: 'Stairs down', x: 7, y: 2 },
      ]);
    });

    it("captures the house landmark from the town's house-door slot", () => {
      const projection = projectionWith({
        floor: { floorId: 'floor.town', town: true, cells: [] },
        slots: [{ tags: ['town', 'house-door'], x: 4, y: 4 }],
      });
      const { landmarks } = accumulateSightings(EMPTY_SIGHTINGS, projection);
      expect(landmarks).toEqual([
        { floorId: 'floor.town', kind: 'house', name: 'The house', x: 4, y: 4 },
      ]);
    });

    it("captures a merchant landmark from a visible actor's factionName, naming it from the actor at sighting time", () => {
      const projection = projectionWith({
        floor: { floorId: 'floor.town', town: true, cells: [] },
        actors: [
          { contentId: null, x: 2, y: 2, name: 'Old Marta', factionName: 'faction.provisioners' },
        ],
      });
      const { landmarks } = accumulateSightings(EMPTY_SIGHTINGS, projection);
      expect(landmarks).toEqual([
        { floorId: 'floor.town', kind: 'merchant', name: 'Old Marta', x: 2, y: 2 },
      ]);
    });

    it('falls back to factionName when the merchant actor discloses no name', () => {
      const projection = projectionWith({
        floor: { floorId: 'floor.town', town: true, cells: [] },
        actors: [{ contentId: null, x: 2, y: 2, factionName: 'faction.provisioners' }],
      });
      const { landmarks } = accumulateSightings(EMPTY_SIGHTINGS, projection);
      expect(landmarks).toEqual([
        { floorId: 'floor.town', kind: 'merchant', name: 'faction.provisioners', x: 2, y: 2 },
      ]);
    });

    it('persists a merchant landmark met on a floor that is later left -- a later projection without that actor keeps it', () => {
      const met = projectionWith({
        floor: { floorId: 'floor.dungeon-1', town: false, cells: [] },
        actors: [
          {
            contentId: null,
            x: 5,
            y: 5,
            name: 'Wandering Peddler',
            factionName: 'faction.lampwrights',
          },
        ],
      });
      const afterMeeting = accumulateSightings(EMPTY_SIGHTINGS, met);

      const gone = projectionWith({
        floor: { floorId: 'floor.dungeon-1', town: false, cells: [] },
        actors: [],
      });
      const afterLeaving = accumulateSightings(afterMeeting, gone);

      expect(afterLeaving.landmarks).toEqual([
        { floorId: 'floor.dungeon-1', kind: 'merchant', name: 'Wandering Peddler', x: 5, y: 5 },
      ]);
    });

    it('dedupes by (floorId, kind, x, y), keeping the first-captured name', () => {
      const first = projectionWith({
        floor: { floorId: 'floor.town', town: true, cells: [] },
        actors: [
          { contentId: null, x: 2, y: 2, name: 'Old Marta', factionName: 'faction.provisioners' },
        ],
      });
      const afterFirst = accumulateSightings(EMPTY_SIGHTINGS, first);

      // A different actor object, but the SAME floor/kind/position -- the persisted name must not change.
      const second = projectionWith({
        floor: { floorId: 'floor.town', town: true, cells: [] },
        actors: [
          {
            contentId: null,
            x: 2,
            y: 2,
            name: 'Someone Else',
            factionName: 'faction.provisioners',
          },
        ],
      });
      const afterSecond = accumulateSightings(afterFirst, second);

      expect(afterSecond.landmarks).toEqual([
        { floorId: 'floor.town', kind: 'merchant', name: 'Old Marta', x: 2, y: 2 },
      ]);
    });

    it('is forward-tolerant: accumulating onto a prior Sightings with no landmarks field works (loadSightings already defaults it to [])', () => {
      const prev: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };
      const projection = projectionWith({});
      expect(accumulateSightings(prev, projection).landmarks).toEqual([]);
    });
  });
});

function findEntry(entries: readonly CodexEntry[], contentId: string): CodexEntry | undefined {
  return entries.find((entry) => entry.discovered && entry.contentId === contentId);
}

describe('deriveCodexState', () => {
  it('renders every category, one per content kind, in class/item/spell/monster order', () => {
    const state = deriveCodexState({
      records: [],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    expect(state.categories.map((category) => category.kind)).toEqual([
      'class',
      'item',
      'spell',
      'monster',
    ]);
  });

  it("discovers a monster from a record's killerContentId, with firstSeenRun as the 1-based record index", () => {
    const records = [
      record({
        recordId: 'record.1',
        cause: { killerContentId: 'monster.cave-rat', depth: 1, turn: 1, worldTime: 1 },
      }),
    ];
    const state = deriveCodexState({ records, snapshot: null, sightings: EMPTY_SIGHTINGS, pack });
    const monsters = state.categories.find((category) => category.kind === 'monster')!;
    const caveRat = findEntry(monsters.entries, 'monster.cave-rat');
    expect(caveRat).toBeDefined();
    expect(caveRat).toMatchObject({
      discovered: true,
      contentId: 'monster.cave-rat',
      firstSeenRun: 1,
    });
  });

  it('discovers a monster from a sighting alone, with a null firstSeenRun (active-run/sighting-only)', () => {
    const sightings: Sightings = {
      monsterIds: ['monster.training-beetle'],
      itemIds: [],
      landmarks: [],
    };
    const state = deriveCodexState({ records: [], snapshot: null, sightings, pack });
    const monsters = state.categories.find((category) => category.kind === 'monster')!;
    const beetle = findEntry(monsters.entries, 'monster.training-beetle');
    expect(beetle).toMatchObject({ discovered: true, firstSeenRun: null });
  });

  it('a monster never sighted or killed stays undiscovered, with no id/name and a generic silhouette', () => {
    const state = deriveCodexState({
      records: [],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const monsters = state.categories.find((category) => category.kind === 'monster')!;
    expect(monsters.entries.length).toBeGreaterThan(0);
    for (const entry of monsters.entries) {
      expect(entry.discovered).toBe(false);
      if (!entry.discovered) expect(entry.silhouetteGlyph).toBe('?');
    }
  });

  it("discovers an item from a record's equippedItemContentIds", () => {
    const records = [
      record({
        recordId: 'record.1',
        build: {
          attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
          equippedItemContentIds: ['item.iron-sword'],
          signatureAbilityIds: [],
        },
      }),
    ];
    const state = deriveCodexState({ records, snapshot: null, sightings: EMPTY_SIGHTINGS, pack });
    const items = state.categories.find((category) => category.kind === 'item')!;
    expect(findEntry(items.entries, 'item.iron-sword')).toMatchObject({
      discovered: true,
      firstSeenRun: 1,
    });
  });

  it('discovers an item from an identified sighting alone', () => {
    const sightings: Sightings = { monsterIds: [], itemIds: ['item.wooden-shield'], landmarks: [] };
    const state = deriveCodexState({ records: [], snapshot: null, sightings, pack });
    const items = state.categories.find((category) => category.kind === 'item')!;
    expect(findEntry(items.entries, 'item.wooden-shield')).toMatchObject({
      discovered: true,
      firstSeenRun: null,
    });
  });

  it('renders every spell fully undiscovered -- no cast-tracking source exists yet', () => {
    const state = deriveCodexState({
      records: [record()],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const spells = state.categories.find((category) => category.kind === 'spell')!;
    expect(spells.entries.length).toBeGreaterThan(0);
    for (const entry of spells.entries) expect(entry.discovered).toBe(false);
  });

  it("discovers a class from the active hero's classTags", () => {
    const state = deriveCodexState({
      records: [],
      snapshot: snapshotWithClassTags(['wayfarer']),
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const classes = state.categories.find((category) => category.kind === 'class')!;
    expect(findEntry(classes.entries, 'class.wayfarer')).toMatchObject({
      discovered: true,
      firstSeenRun: null,
    });
  });

  it("discovers a class from a past record's classTags, with firstSeenRun as the 1-based record index", () => {
    const records = [record({ recordId: 'record.1', classTags: ['lamplighter'] })];
    const state = deriveCodexState({ records, snapshot: null, sightings: EMPTY_SIGHTINGS, pack });
    const classes = state.categories.find((category) => category.kind === 'class')!;
    expect(findEntry(classes.entries, 'class.lamplighter')).toMatchObject({
      discovered: true,
      firstSeenRun: 1,
    });
  });

  it('a locked, never-unlocked class stays undiscovered but keeps its own (already chargen-disclosed) silhouette glyph', () => {
    const state = deriveCodexState({
      records: [],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const classes = state.categories.find((category) => category.kind === 'class')!;
    const archivistIndex = sortedClassEntries(pack).findIndex(
      (entry) => entry.id === 'class.archivist',
    );
    const archivist = classes.entries[archivistIndex]!;
    expect(archivist.discovered).toBe(false);
    if (!archivist.discovered) expect(archivist.silhouetteGlyph).toBe('A');
  });

  it('is monotone across an ever-growing record list: nothing already discovered ever un-discovers', () => {
    const first = deriveCodexState({
      records: [record({ recordId: 'record.1' })],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    const second = deriveCodexState({
      records: [
        record({ recordId: 'record.1' }),
        record({
          recordId: 'record.2',
          cause: { killerContentId: 'monster.training-beetle', depth: 1, turn: 1, worldTime: 1 },
        }),
      ],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    for (const category of first.categories) {
      const before = category.entries.filter((entry) => entry.discovered).length;
      const matching = second.categories.find((candidate) => candidate.kind === category.kind)!;
      const after = matching.entries.filter((entry) => entry.discovered).length;
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });

  it('never puts a content id or name into an undiscovered entry -- structurally spoiler-free (whole-state grep)', () => {
    const state = deriveCodexState({
      records: [],
      snapshot: null,
      sightings: EMPTY_SIGHTINGS,
      pack,
    });
    for (const category of state.categories) {
      for (const entry of category.entries) {
        if (entry.discovered) continue;
        expect(entry).not.toHaveProperty('contentId');
        expect(entry).not.toHaveProperty('name');
      }
    }
  });

  it('is safe with a null snapshot (title screen, no live run) -- the active-hero-class source is simply unavailable', () => {
    expect(() =>
      deriveCodexState({ records: [], snapshot: null, sightings: EMPTY_SIGHTINGS, pack }),
    ).not.toThrow();
  });
});

describe('bundled class content fixture', () => {
  it(
    "has distinctive classTags per class -- no class's classTags are a subset of a DIFFERENT class's, so tag-subset " +
      'matching (the discovery rule) can never ambiguously match more than the one intended class',
    () => {
      const classes: readonly ClassContentEntry[] = sortedClassEntries(pack);
      expect(classes.length).toBeGreaterThan(1);
      for (const left of classes) {
        for (const right of classes) {
          if (left.id === right.id) continue;
          const leftCoversRight = left.classTags.every((tag) => right.classTags.includes(tag));
          expect(leftCoversRight).toBe(false);
        }
      }
    },
  );
});
