import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  descendToNextFloor,
  emptyEquipment,
  emptyLifetimeState,
  encodeActiveRun,
  newRunRecords,
  RECENT_COMMAND_LIMIT,
  SaveLoadError,
  type ActiveRun,
  type ActorState,
  type ItemInstance,
  type NewRunRecordsInput,
  type RunRecordRepository,
  type Uint32State,
} from '@woven-deep/engine';
import { SIGHTINGS_KEY } from '../src/session/codex.js';
import { GUEST_SESSION_STORAGE_KEYS } from '../src/session/clear-guest-session.js';
import { GuestSession } from '../src/session/guest-session.js';
import { ONBOARDING_KEY } from '../src/session/onboarding.js';
import { createSessionRunRecordRepository } from '../src/session/run-records-storage.js';
import {
  CHECKPOINT_KEY,
  COMMAND_SEQUENCE_KEY,
  SAVE_KEY,
  type SessionStorageLike,
} from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

// The town is authored, fixed layout (not generated), so this path is the same for every seed:
// from the town's entrance plaza, the dungeon entrance (the town's stair-down) sits a single
// diagonal step southeast (verified against the compiled town vault's tiles).
const DESCEND_SEED: Uint32State = [743, 744, 745, 746];
const DESCEND_PATH = ['southeast'] as const;

/** A run whose hero has already descended once, standing on the depth-1 floor's stair-up tile
 * (arrival position from `descendToNextFloor`). Built directly (not by dispatching through the
 * session) so tests that need a dark, non-town floor — where the town's always-on ambient light
 * doesn't defeat the "doused torch keeps a neighbor hidden" trick below — can start there without
 * re-deriving the town-to-dungeon walk in every test. */
function depth1Run(seed: Uint32State): ActiveRun {
  const fresh = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  const town = fresh.floors.find((floor) => floor.floorId === hero.floorId)!;
  const atStairDown: ActiveRun = {
    ...fresh,
    actors: fresh.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y }
        : actor,
    ),
  };
  return descendToNextFloor(atStairDown, { content: pack }).state;
}

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

interface FakeStorage extends SessionStorageLike {
  /** Reads back the save by default; pass a key to inspect anything else stored beside it
   * (e.g. `COMMAND_SEQUENCE_KEY`). */
  peek(key?: string): string | null;
}

function fakeStorage(): FakeStorage {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
    peek: (key: string = SAVE_KEY) => values.get(key) ?? null,
  };
}

/** Same in-memory `SessionStorageLike` double as `fakeStorage` -- named for the checkpoint tests
 * below, which read arbitrary keys via `get` rather than `peek`. */
const memoryStorage = fakeStorage;

/** Wraps `memoryStorage()` so `set` throws a `QuotaExceededError` for exactly `failingKey`, while
 * every other key (notably `SAVE_KEY`) writes through normally -- isolates a checkpoint write
 * failure from the run save it must never affect. */
function quotaFailingStorage(failingKey: string): FakeStorage {
  const storage = memoryStorage();
  return {
    ...storage,
    set: (key: string, value: string) => {
      if (key === failingKey) throw new DOMException('quota', 'QuotaExceededError');
      storage.set(key, value);
    },
  };
}

/** A fresh Wanderer-mode session seeded and positioned exactly like the file's other descend
 * cases (`DESCEND_SEED`/`DEFAULT_GUEST_HERO`), so `DESCEND_PATH` + a `descend` dispatch reaches
 * the depth-1 stair from town in every checkpoint test below. */
function wandererSession(storage: SessionStorageLike): GuestSession {
  return new GuestSession({
    pack,
    storage,
    seed: DESCEND_SEED,
    hero: DEFAULT_GUEST_HERO,
    startFresh: true,
    mode: 'wanderer',
  });
}

/** Walks the hero from town onto the dungeon entrance via `DESCEND_PATH` and descends. */
function walkAndDescend(session: GuestSession): void {
  for (const direction of DESCEND_PATH) session.dispatch({ type: 'move', direction });
  session.dispatch({ type: 'descend' });
}

/**
 * A second, distinct floor-entry transition after an initial `walkAndDescend`: from depth-1's
 * stair-up arrival tile (where `descendToNextFloor` lands the hero), ascending back to town lands
 * exactly on town's own stair-down tile (`ascendToPreviousFloor`'s arrival is always the
 * departure floor's `stairDown`) -- so the immediately following `descend` needs no further
 * movement, and exercises the *stored* re-descent path onto the same depth-1 floor rather than
 * the first (generated) descend, without pathfinding across a randomly generated maze.
 */
function descendAgain(session: GuestSession): void {
  session.dispatch({ type: 'ascend' });
  session.dispatch({ type: 'descend' });
}

describe('GuestSession', () => {
  it('starts a fresh seeded run when storage is empty and persists after each applied command', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });

    expect(session.getSnapshot().notice).toEqual({ kind: 'fresh' });
    const before = storage.peek();
    session.dispatch({ type: 'wait' });

    expect(storage.peek()).not.toBe(before);
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(1);
  });

  it('forwards an optional hero override into createNewRun for a fresh run', () => {
    const storage = fakeStorage();
    const customHero = { ...DEFAULT_GUEST_HERO, name: 'Rin' };
    const session = new GuestSession({ pack, storage, seed: SEED, hero: customHero });

    expect(session.getSnapshot().projection.hero.name).toBe('Rin');
  });

  it('defaults to DEFAULT_GUEST_HERO when no hero override is given', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });

    expect(session.getSnapshot().projection.hero.name).toBe(DEFAULT_GUEST_HERO.name);
  });

  it('creates a wanderer run when constructed with that mode', () => {
    const storage = fakeStorage();
    const session = new GuestSession({
      pack,
      storage,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      startFresh: true,
      mode: 'wanderer',
    });

    expect(session.getSnapshot().projection.mode).toBe('wanderer');
  });

  it('defaults to classic when no mode is given', () => {
    const storage = fakeStorage();
    const session = new GuestSession({
      pack,
      storage,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      startFresh: true,
    });

    expect(session.getSnapshot().projection.mode).toBe('classic');
  });

  it('restores a stored run byte-for-byte', () => {
    const storage = fakeStorage();
    const first = new GuestSession({ pack, storage, seed: SEED });
    first.dispatch({ type: 'wait' });
    const saved = storage.peek();

    const second = new GuestSession({ pack, storage });
    expect(second.getSnapshot().notice).toEqual({ kind: 'restored' });
    second.dispatch({ type: 'wait' }); // dispatch works from the restored state
    expect(saved).not.toBeNull();
  });

  it('falls back to a fresh run with a save-discarded notice on corrupt saves', () => {
    const storage = fakeStorage();
    storage.set(SAVE_KEY, '{"not": "a save"}');

    const session = new GuestSession({ pack, storage, seed: SEED });
    expect(session.getSnapshot().notice?.kind).toBe('save-discarded');
    // Still gets a playable run even though the save was discarded.
    session.dispatch({ type: 'wait' });
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(1);
  });

  it('startFresh skips restoring a decodable save for a DIFFERENT hero and overwrites it on first persist', () => {
    // Regression coverage for the final-review finding: `boot()` used to unconditionally restore
    // any decodable, hash-matching save, so entering the wizard for a brand-new hero while a live
    // save existed silently discarded the wizard's choices and resumed the OLD run instead.
    const storage = fakeStorage();
    const oldHero = { ...DEFAULT_GUEST_HERO, name: 'Old Hero' };
    const oldRun = createNewRun({ pack, seed: SEED, hero: oldHero });
    storage.set(SAVE_KEY, encodeActiveRun(oldRun));

    const newHero = { ...DEFAULT_GUEST_HERO, name: 'New Hero' };
    const session = new GuestSession({
      pack,
      storage,
      seed: SEED,
      hero: newHero,
      startFresh: true,
    });

    expect(session.getSnapshot().projection.hero.name).toBe('New Hero');
    expect(session.getSnapshot().notice).toEqual({ kind: 'fresh' });

    session.dispatch({ type: 'wait' });
    const overwritten = decodeActiveRun(storage.peek()!);
    expect(overwritten.hero.name).toBe('New Hero');
  });

  it('discards a restored save whose content hash no longer matches the served pack', () => {
    const storage = fakeStorage();
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    storage.set(SAVE_KEY, encodeActiveRun(run));
    const mismatchedPack: CompiledContentPack = { ...pack, hash: 'f'.repeat(64) };

    const session = new GuestSession({ pack: mismatchedPack, storage, seed: SEED });
    expect(session.getSnapshot().notice).toEqual({
      kind: 'save-discarded',
      reason: 'content_hash_mismatch',
    });
  });

  it('surfaces intent rejections as log lines without touching the run', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    const before = session.getSnapshot().projection;
    const logBefore = session.getSnapshot().log.length;

    // The hero never starts on a stair-down tile, so this is rejected client-side before ever
    // reaching the engine.
    session.dispatch({ type: 'descend' });

    const after = session.getSnapshot();
    expect(after.projection.hero).toEqual(before.hero);
    expect(after.log.length).toBe(logBefore + 1);
    expect(after.log.at(-1)?.tone).toBe('system');
  });

  it('routes descend through the engine transition and persists the new floor', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: DESCEND_SEED });

    for (const direction of DESCEND_PATH) {
      session.dispatch({ type: 'move', direction });
    }
    session.dispatch({ type: 'descend' });

    const saved = storage.peek();
    expect(saved).not.toBeNull();
    const restored: ActiveRun = decodeActiveRun(saved!);
    expect(restored.floors.length).toBe(2);
    expect(restored.activeFloorId).toBe('floor.depth-001');
  });

  it('routes ascend through the engine transition and persists the trip back to town, mirroring descend', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: DESCEND_SEED });

    for (const direction of DESCEND_PATH) session.dispatch({ type: 'move', direction });
    session.dispatch({ type: 'descend' });
    expect(decodeActiveRun(storage.peek()!).activeFloorId).toBe('floor.depth-001');

    session.dispatch({ type: 'ascend' });

    const restored = decodeActiveRun(storage.peek()!);
    expect(restored.floors.length).toBe(2);
    expect(restored.activeFloorId).toBe('floor.depth-000');
    expect(session.getSnapshot().projection.floor.town).toBe(true);
  });

  it('surfaces an ascend rejection as a log line when the hero is not on stair-up', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    const logBefore = session.getSnapshot().log.length;

    session.dispatch({ type: 'ascend' });

    expect(session.getSnapshot().log.length).toBe(logBefore + 1);
    expect(session.getSnapshot().log.at(-1)?.tone).toBe('system');
  });

  it('opens the house screen via a "house" intent only when adjacent to the house door', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });

    expect(session.getSnapshot().houseOpen).toBe(false);
    session.dispatch({ type: 'house' });
    expect(session.getSnapshot().houseOpen).toBe(false);
    expect(session.getSnapshot().log.at(-1)?.tone).toBe('system');

    session.setHouseOpen(true);
    expect(session.getSnapshot().houseOpen).toBe(true);
    session.setHouseOpen(false);
    expect(session.getSnapshot().houseOpen).toBe(false);
  });

  it('opens the house screen through a "house" intent dispatch when the hero is adjacent to the house door', () => {
    const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = fresh.actors.find((actor) => actor.playerControlled)!;
    const town = fresh.floors.find((floor) => floor.floorId === hero.floorId)!;
    const door = town.placementSlots.find((slot) => slot.tags.includes('house-door'))!;
    const adjacentRun: ActiveRun = {
      ...fresh,
      actors: fresh.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, x: door.x - 1, y: door.y - 1 } : actor,
      ),
    };
    const storage = fakeStorage();
    storage.set(SAVE_KEY, encodeActiveRun(adjacentRun));
    const session = new GuestSession({ pack, storage });

    session.dispatch({ type: 'house' });

    expect(session.getSnapshot().houseOpen).toBe(true);
  });

  it('exposes lastEvents for one snapshot generation and pendingDecision for decision_required results', () => {
    const storage = fakeStorage();
    const run = depth1Run(SEED);
    const hero = run.actors.find((actor) => actor.playerControlled)!;

    // Douse the hero's torch and place a neutral actor one tile east, in the dark, so it never
    // appears in the hero's own projection (`visiblyOccupied` excludes unlit cells). The client
    // therefore believes the target cell is empty and issues a plain `move`, which the engine
    // resolves against the *actual* occupant: a neutral actor triggers `decision_required`
    // instead of either moving or attacking. See `packages/engine/src/movement.ts`.
    const doused = run.items.map((item) =>
      item.location.type === 'equipped' && item.location.slot === 'off-hand'
        ? { ...item, enabled: false }
        : item,
    );
    const hiddenNeighbor: ActorState = {
      ...hero,
      actorId: 'npc.hidden-bystander',
      contentId: 'monster.cave-rat',
      playerControlled: false,
      x: hero.x + 1,
      y: hero.y,
      disposition: 'neutral',
      energy: 0,
      equipment: emptyEquipment(),
      behaviorId: null,
    };
    const withHiddenNeighbor: ActiveRun = {
      ...run,
      items: doused,
      actors: [...run.actors, hiddenNeighbor].sort((left, right) =>
        left.actorId < right.actorId ? -1 : 1,
      ),
    };
    storage.set(SAVE_KEY, encodeActiveRun(withHiddenNeighbor));

    const session = new GuestSession({ pack, storage });
    session.dispatch({ type: 'move', direction: 'east' });

    const snapshot = session.getSnapshot();
    expect(snapshot.pendingDecision).toEqual({
      type: 'confirm-aggression',
      targetActorId: 'npc.hidden-bystander',
    });
    expect(snapshot.lastEvents).toEqual([]);
    const beforeConfirm = decodeActiveRun(storage.peek()!);

    session.answerDecision(true);
    const confirmed = session.getSnapshot();
    expect(confirmed.pendingDecision).toBeNull();
    // The strike lands on a target the hero cannot see, so it produces no observable public
    // event (there is nothing to narrate about something you can't see) — but the confirmed
    // attack still advances the run, which the persisted save proves.
    const afterConfirm = decodeActiveRun(storage.peek()!);
    expect(afterConfirm.revision).toBe(beforeConfirm.revision + 1);
  });

  it('clears the pending decision with a log line when the player declines', () => {
    const storage = fakeStorage();
    const run = depth1Run(SEED);
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const doused = run.items.map((item) =>
      item.location.type === 'equipped' && item.location.slot === 'off-hand'
        ? { ...item, enabled: false }
        : item,
    );
    const hiddenNeighbor: ActorState = {
      ...hero,
      actorId: 'npc.hidden-bystander',
      contentId: 'monster.cave-rat',
      playerControlled: false,
      x: hero.x + 1,
      y: hero.y,
      disposition: 'neutral',
      energy: 0,
      equipment: emptyEquipment(),
      behaviorId: null,
    };
    const withHiddenNeighbor: ActiveRun = {
      ...run,
      items: doused,
      actors: [...run.actors, hiddenNeighbor].sort((left, right) =>
        left.actorId < right.actorId ? -1 : 1,
      ),
    };
    storage.set(SAVE_KEY, encodeActiveRun(withHiddenNeighbor));

    const session = new GuestSession({ pack, storage });
    session.dispatch({ type: 'move', direction: 'east' });
    expect(session.getSnapshot().pendingDecision).not.toBeNull();

    session.answerDecision(false);
    const snapshot = session.getSnapshot();
    expect(snapshot.pendingDecision).toBeNull();
    expect(snapshot.log.at(-1)?.tone).toBe('system');
  });

  it('reports storage-full failures as a storage notice while play continues', () => {
    const storage = fakeStorage();
    let failNextWrite = false;
    const failingStorage: SessionStorageLike = {
      get: storage.get,
      set: (key: string, value: string) => {
        if (failNextWrite) {
          const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          throw quota;
        }
        storage.set(key, value);
      },
    };

    const session = new GuestSession({ pack, storage: failingStorage, seed: SEED });
    failNextWrite = true;
    session.dispatch({ type: 'wait' });

    const snapshot = session.getSnapshot();
    expect(snapshot.notice).toEqual({ kind: 'storage', failure: 'full' });
    // Play continues even though persistence failed.
    expect(snapshot.projection.metrics.turnsElapsed).toBe(1);
  });

  it('lets an engine invariant failure from encodeActiveRun propagate out of persist instead of reporting a storage notice', () => {
    // Regression coverage for the bug reconcileIndividualDeaths (packages/engine/src/
    // individual-behavior.ts) fixes: a dead actor left in a population's livingMemberIds makes
    // encodeActiveRun (via validateActiveRun) throw a SaveLoadError. That is an engine bug, not a
    // storage problem, so `persist()` must let it propagate rather than swallow it into a storage
    // notice. `resolveCommand` itself re-validates content-bound state on every call, so a
    // corrupted run can only be observed by exercising the private `persist()` method directly —
    // this is the most honest way to isolate persist's classification behavior without an
    // engine-level seam.
    const storage = fakeStorage();
    let setCalls = 0;
    const countingStorage: SessionStorageLike = {
      get: storage.get,
      set: (key: string, value: string) => {
        setCalls += 1;
        storage.set(key, value);
      },
    };
    const session = new GuestSession({ pack, storage: countingStorage, seed: SEED });
    const sessionInternals = session as unknown as { run: ActiveRun; persist(): void };

    sessionInternals.run = {
      ...sessionInternals.run,
      populations: [
        {
          populationId: 'population.corrupt',
          encounterId: 'encounter.corrupt',
          model: 'individual',
          floorId: sessionInternals.run.activeFloorId,
          createdAt: 0,
          livingMemberIds: ['monster.does-not-exist'],
          formerMemberIds: [],
        },
      ],
    };

    // Construction itself already wrote once (`syncSightings`'s boot-restore sync, Task 8) --
    // reset the counter so this assertion isolates `persist()`'s OWN behaviour, per the test's
    // stated intent, rather than conflating it with an unrelated write from an earlier step.
    setCalls = 0;
    expect(() => sessionInternals.persist()).toThrow();
    expect(setCalls).toBe(0);
    expect(session.getSnapshot().notice).not.toEqual({ kind: 'storage', failure: 'unavailable' });
    expect(session.getSnapshot().notice).not.toEqual({ kind: 'storage', failure: 'full' });
  });

  it('keeps a stable snapshot reference between notifications', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    const first = session.getSnapshot();
    expect(session.getSnapshot()).toBe(first);

    session.dispatch({ type: 'wait' });
    const second = session.getSnapshot();
    expect(second).not.toBe(first);
    expect(session.getSnapshot()).toBe(second);
  });

  it('derives command ids from a session-owned monotonic counter, persisted beside the save', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    session.dispatch({ type: 'wait' });
    session.dispatch({ type: 'wait' });

    const saved = storage.peek();
    const restored = decodeActiveRun(saved!);
    expect(restored.recentCommands.map((entry) => entry.command.commandId)).toEqual([
      'command.guest-0000000000',
      'command.guest-0000000001',
    ]);
    expect(storage.peek(COMMAND_SEQUENCE_KEY)).toBe('2');
  });

  it('recovers from a wall bump instead of soft-locking on a reused command id', () => {
    // Regression coverage for the final-review finding that motivated the first fix attempt:
    // deriving commandId from `revision + 1` alone collides forever after any `invalid` result,
    // because the engine records invalid results into `recentCommands` WITHOUT advancing revision
    // (reducer.ts recordInvalid), and rejects any later same-id/different-payload command as
    // `command_id_conflict`. The town's entrance plaza sits in a large open room, so unlike an
    // ungenerated dungeon spawn there is no wall in any of the hero's 8 starting neighbors — but
    // walking west 4 times reaches the room's western wall (verified against the compiled town
    // vault's tiles), so a 5th `west` is guaranteed to produce an `invalid` result without moving
    // the hero further.
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });

    for (let step = 0; step < 4; step += 1) session.dispatch({ type: 'move', direction: 'west' });
    const beforeBump = session.getSnapshot();
    const turnsBeforeBump = beforeBump.projection.metrics.turnsElapsed;
    const logBefore = beforeBump.log.length;

    session.dispatch({ type: 'move', direction: 'west' });

    const afterBump = session.getSnapshot();
    expect(afterBump.log.length).toBe(logBefore + 1);
    expect(afterBump.log.at(-1)?.tone).toBe('system');
    expect(afterBump.projection.metrics.turnsElapsed).toBe(turnsBeforeBump);

    session.dispatch({ type: 'wait' });
    const afterWait = session.getSnapshot();
    expect(afterWait.projection.metrics.turnsElapsed).toBe(turnsBeforeBump + 1);

    // Persist + restore, then dispatch again: the restored counter must still be able to advance.
    const saved = storage.peek();
    const restoredSession = new GuestSession({ pack, storage: { ...storage, get: () => saved } });
    restoredSession.dispatch({ type: 'wait' });
    expect(restoredSession.getSnapshot().projection.metrics.turnsElapsed).toBe(turnsBeforeBump + 2);
  });

  it('keeps applying valid commands after the engine prunes recentCommands past RECENT_COMMAND_LIMIT', () => {
    // This is the production soft-lock: once the run has recorded RECENT_COMMAND_LIMIT commands,
    // the engine's `recentCommands.slice(-RECENT_COMMAND_LIMIT)` (reducer.ts) keeps its length
    // CONSTANT forever after. The previous commandId scheme derived ids from
    // `revision + 1` and `recentCommands.length` — once length is pinned, two consecutive
    // `invalid` dispatches (which don't advance revision either) produce IDENTICAL ids, so the
    // next, entirely different command collides with one of them and is rejected forever as
    // `command_id_conflict`. A session-owned monotonic counter never repeats, so it must survive
    // this scenario.
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });

    for (let i = 0; i < RECENT_COMMAND_LIMIT; i += 1) {
      session.dispatch({ type: 'wait' });
    }
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(RECENT_COMMAND_LIMIT);

    // Walk to the town's western wall (see the wall-bump test above for why the entrance plaza
    // itself has no adjacent wall), then bump into it twice: both dispatches produce `invalid`
    // results without moving the hero or advancing revision.
    for (let step = 0; step < 4; step += 1) session.dispatch({ type: 'move', direction: 'west' });
    const turnsAtWall = session.getSnapshot().projection.metrics.turnsElapsed;
    session.dispatch({ type: 'move', direction: 'west' });
    session.dispatch({ type: 'move', direction: 'west' });

    session.dispatch({ type: 'wait' });
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(turnsAtWall + 1);
  });

  it('restores the persisted command-sequence counter on reload, so ids keep advancing past what a fresh counter would produce', () => {
    const storage = fakeStorage();
    const first = new GuestSession({ pack, storage, seed: SEED });
    for (let i = 0; i < 5; i += 1) first.dispatch({ type: 'wait' });
    expect(storage.peek(COMMAND_SEQUENCE_KEY)).toBe('5');

    const second = new GuestSession({ pack, storage });
    second.dispatch({ type: 'wait' });

    const restored = decodeActiveRun(storage.peek()!);
    expect(restored.recentCommands.at(-1)?.command.commandId).toBe('command.guest-0000000005');
    expect(storage.peek(COMMAND_SEQUENCE_KEY)).toBe('6');
  });

  it('falls back to a safe counter floor when a save exists but its counter is missing (an older session)', () => {
    const storage = fakeStorage();
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    storage.set(SAVE_KEY, encodeActiveRun(run));
    // No COMMAND_SEQUENCE_KEY entry at all — simulates a save persisted before this counter existed.

    const session = new GuestSession({ pack, storage });
    session.dispatch({ type: 'wait' });

    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(1);
    // Seeded at `revision (0) + RECENT_COMMAND_LIMIT + 1`, then incremented once.
    expect(storage.peek(COMMAND_SEQUENCE_KEY)).toBe(String(RECENT_COMMAND_LIMIT + 2));
  });

  describe('onboarding wiring (Task 8 review Finding 2)', () => {
    it('(a) an applied "move" command increments the movement mastery count and persists to the provided localStorage', () => {
      const storage = fakeStorage();
      const localStorage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED, localStorage });

      expect(session.getSnapshot().onboarding.counts.move ?? 0).toBe(0);
      session.dispatch({ type: 'move', direction: 'west' }); // valid: no wall/occupant this direction (see wall-bump test above)

      expect(session.getSnapshot().onboarding.counts.move).toBe(1);
      const stored = localStorage.peek(ONBOARDING_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({ counts: { move: 1 }, dismissed: [] });
    });

    it('(b) a client-side REJECTED command (occupied by a visible non-hostile actor) does NOT increment mastery', () => {
      const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
      const hero = fresh.actors.find((actor) => actor.playerControlled)!;
      const neighbor: ActorState = {
        ...hero,
        actorId: 'npc.visible-bystander',
        contentId: 'monster.cave-rat',
        playerControlled: false,
        x: hero.x + 1,
        y: hero.y,
        disposition: 'neutral',
        energy: 0,
        equipment: emptyEquipment(),
        behaviorId: null,
      };
      const withNeighbor: ActiveRun = {
        ...fresh,
        actors: [...fresh.actors, neighbor].sort((left, right) =>
          left.actorId < right.actorId ? -1 : 1,
        ),
      };
      const storage = fakeStorage();
      storage.set(SAVE_KEY, encodeActiveRun(withNeighbor));
      const localStorage = fakeStorage();
      const session = new GuestSession({ pack, storage, localStorage });

      session.dispatch({ type: 'move', direction: 'east' });

      expect(session.getSnapshot().log.at(-1)?.text).toBe('Something is in the way.');
      expect(session.getSnapshot().onboarding.counts.move ?? 0).toBe(0);
      expect(localStorage.peek(ONBOARDING_KEY)).toBeNull();
    });

    it('(c) dismissOnboardingHint persists the dismissal', () => {
      const storage = fakeStorage();
      const localStorage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED, localStorage });

      session.dismissOnboardingHint('movement');

      expect(session.getSnapshot().onboarding.dismissed).toEqual(['movement']);
      const stored = localStorage.peek(ONBOARDING_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!).dismissed).toEqual(['movement']);
    });

    it('(d) constructing WITHOUT the optional localStorage falls back to in-memory: counts still work in-session, nothing thrown', () => {
      const storage = fakeStorage();

      expect(() => {
        const session = new GuestSession({ pack, storage, seed: SEED });
        session.dispatch({ type: 'move', direction: 'west' });
        expect(session.getSnapshot().onboarding.counts.move).toBe(1);
      }).not.toThrow();
    });
  });

  describe('corruption notices (Task 8 review Finding 3 -- milestone-wide error-handling debt)', () => {
    it('a corrupted onboarding blob resets to the empty ledger AND surfaces a dismissible data-reset notice, once', () => {
      const storage = fakeStorage();
      const localStorage = fakeStorage();
      localStorage.set(ONBOARDING_KEY, 'not json{{{');

      const session = new GuestSession({ pack, storage, seed: SEED, localStorage });

      expect(session.getSnapshot().onboarding).toEqual({ counts: {}, dismissed: [] });
      expect(session.getSnapshot().notice).toEqual({ kind: 'data-reset', source: 'onboarding' });

      // Guarded, not re-fired on a subsequent publish (dispatch resets `notice` to null first).
      session.dispatch({ type: 'wait' });
      expect(session.getSnapshot().notice).not.toEqual({
        kind: 'data-reset',
        source: 'onboarding',
      });
    });

    it('a corrupted sighting-cache blob resets to the empty cache AND surfaces a dismissible data-reset notice', () => {
      const storage = fakeStorage();
      storage.set(SIGHTINGS_KEY, 'not json{{{');

      const session = new GuestSession({ pack, storage, seed: SEED });

      // The corrupted cache resets to empty, then re-accumulates from THIS boot's own fresh
      // projection (per `syncSightings`'s "accumulates on boot restore" contract) -- it is not
      // expected to stay empty, only to have discarded whatever was in the corrupted blob.
      expect(session.getSnapshot().notice).toEqual({ kind: 'data-reset', source: 'sightings' });
    });
  });

  describe('death and finalization', () => {
    /** A run already concluded by hero death (`health: 0`, a `died` conclusion at the fresh run's
     * own revision/turn), built from the real compiled content pack this suite already loads.
     * Constructed directly (rather than driven to death by dispatching commands) because this
     * pack's fresh run spawns population actors alongside the hero, and forcing a natural
     * mid-transition starvation death drags in unrelated multi-actor world-step machinery that
     * has nothing to do with what this suite is testing; the engine's own `resolveCommand`-driven
     * death path is covered by `run-finalize.test.ts`/`reducer.test.ts` in the engine package, and
     * by `run-records-storage.test.ts`'s genuine death-and-finalize fixture. */
    function deadRun(seed: Uint32State): ActiveRun {
      const fresh = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
      const hero = fresh.actors.find((actor) => actor.playerControlled)!;
      return {
        ...fresh,
        actors: fresh.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
        ),
        conclusion: {
          completionType: 'died',
          // The fresh guest run starts in town (depth 0), and this fixture never moves the hero
          // anywhere else before killing them.
          cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
          concludedAtRevision: fresh.revision,
          finalized: false,
        },
      };
    }

    it('is null for a living run, and a non-finalized projection once restored into an already-died run', () => {
      const storage = fakeStorage();
      const living = new GuestSession({ pack, storage, seed: SEED });
      expect(living.getSnapshot().conclusion).toBeNull();

      storage.set(SAVE_KEY, encodeActiveRun(deadRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const conclusion = session.getSnapshot().conclusion;
      expect(conclusion).not.toBeNull();
      expect(conclusion?.completionType).toBe('died');
      expect(conclusion?.finalized).toBe(false);
      expect(conclusion?.score).toBeNull();
      expect(conclusion?.heirloom).toBeNull();
    });

    it('finalizeConcludedRun produces the full projection, appends exactly one record, and is idempotent on a second call', () => {
      const storage = fakeStorage();
      storage.set(SAVE_KEY, encodeActiveRun(deadRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const repository = createSessionRunRecordRepository(storage);
      const projection = session.finalizeConcludedRun(repository, {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });

      expect(projection.finalized).toBe(true);
      expect(projection.score).not.toBeNull();
      expect(projection.heirloom).not.toBeNull();
      expect(repository.records()).toHaveLength(1);

      const second = session.finalizeConcludedRun(repository, {
        achievedAt: 'Run #2',
        portraitGlyph: '&',
      });
      expect(repository.records()).toHaveLength(1);
      expect(second).toEqual(projection);
    });

    it('applies the lifetime deltas before the artifact deltas so conquest is visible at reconcile', () => {
      const storage = fakeStorage();
      storage.set(SAVE_KEY, encodeActiveRun(deadRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const repository = createSessionRunRecordRepository(storage);
      const calls: string[] = [];
      const recording: RunRecordRepository = {
        ...repository,
        appendRecord(stored) {
          calls.push('appendRecord');
          repository.appendRecord(stored);
        },
        applyDeltas(deltas) {
          calls.push('applyDeltas');
          repository.applyDeltas(deltas);
        },
        applyArtifactDeltas(deltas) {
          calls.push('applyArtifactDeltas');
          repository.applyArtifactDeltas(deltas);
        },
      };

      session.finalizeConcludedRun(recording, { achievedAt: 'Run #1', portraitGlyph: '@' });

      expect(calls).toEqual(['appendRecord', 'applyDeltas', 'applyArtifactDeltas']);
    });

    it('finalizing a became-heart conclusion records the guest Hearth lineage', () => {
      /** Mirrors `deadRun` above, but concluded voluntarily (`became-heart`) rather than by death:
       * the hero stays alive, matching the Final Chamber choice's non-death conclusion shape. */
      function heartRun(seed: Uint32State): ActiveRun {
        const fresh = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
        return {
          ...fresh,
          conclusion: {
            completionType: 'became-heart',
            cause: {
              killerContentId: null,
              depth: 0,
              turn: fresh.turn,
              worldTime: fresh.worldTime,
            },
            concludedAtRevision: fresh.revision,
            finalized: false,
          },
        };
      }

      const storage = fakeStorage();
      storage.set(SAVE_KEY, encodeActiveRun(heartRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const repository = createSessionRunRecordRepository(storage);
      expect(repository.currentHeart()).toBeNull();

      session.finalizeConcludedRun(repository, { achievedAt: 'Run #1', portraitGlyph: '@' });

      const heart = repository.currentHeart();
      expect(heart).not.toBeNull();
      expect(heart?.heroName).toBe(DEFAULT_GUEST_HERO.name);
      expect(heart?.classTags).toEqual(DEFAULT_GUEST_HERO.classTags);
      expect(heart?.hallRecordId).toBe(repository.records()[0]!.recordId);
      expect(heart?.enrichment).toEqual({ achievedAt: 'Run #1', portraitGlyph: '@' });
    });

    it('persists the finalized run (reload sees the engine finalized flag) and does not re-append on finalizeConcludedRun after reload', () => {
      const storage = fakeStorage();
      storage.set(SAVE_KEY, encodeActiveRun(deadRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const repository = createSessionRunRecordRepository(storage);
      const projection = session.finalizeConcludedRun(repository, {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });

      const reloadedRun = decodeActiveRun(storage.peek()!);
      expect(reloadedRun.conclusion?.finalized).toBe(true);

      const reloadedSession = new GuestSession({ pack, storage });
      const reloadedRepository = createSessionRunRecordRepository(storage);
      const reloadedProjection = reloadedSession.finalizeConcludedRun(reloadedRepository, {
        achievedAt: 'Run #2',
        portraitGlyph: '&',
      });

      expect(reloadedRepository.records()).toHaveLength(1);
      expect(reloadedProjection).toEqual(projection);
    });

    it('degrades to a null-record projection instead of throwing when an already-finalized run has no matching Hall record (e.g. after a Hall reset)', () => {
      // Regression coverage: App's corrupt-Hall handling resets the Hall while the save survives,
      // so Continue into a dead run whose engine `conclusion.finalized` flag is already `true`
      // must not crash with an "internal invariant" error just because the record is gone.
      const storage = fakeStorage();
      const deadFinalizedRun: ActiveRun = {
        ...deadRun(SEED),
        conclusion: {
          completionType: 'died',
          cause: { killerContentId: null, depth: 0, turn: 0, worldTime: 0 },
          concludedAtRevision: 0,
          finalized: true,
        },
      };
      storage.set(SAVE_KEY, encodeActiveRun(deadFinalizedRun));
      const session = new GuestSession({ pack, storage });
      const emptyRepository = createSessionRunRecordRepository(storage);

      let projection: ReturnType<typeof session.finalizeConcludedRun>;
      expect(() => {
        projection = session.finalizeConcludedRun(emptyRepository, {
          achievedAt: 'Run #1',
          portraitGlyph: '@',
        });
      }).not.toThrow();

      expect(projection!.finalized).toBe(false);
      expect(projection!.score).toBeNull();
      expect(projection!.heirloom).toBeNull();
    });
  });

  describe('hall records seeding', () => {
    /** A run that really descended to depth 1 and died there — so the Hall record it finalizes
     * into carries a `deathDepth` an actual floor can host the champion on. */
    function deadRunAtDepth1(seed: Uint32State): ActiveRun {
      const descended = depth1Run(seed);
      const hero = descended.actors.find((actor) => actor.playerControlled)!;
      return {
        ...descended,
        actors: descended.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
        ),
        conclusion: {
          completionType: 'died',
          cause: {
            killerContentId: null,
            depth: 1,
            turn: descended.turn,
            worldTime: descended.worldTime,
          },
          concludedAtRevision: descended.revision,
          finalized: false,
        },
      };
    }

    /** The session only writes the save on its first applied command, so a fresh run is read back
     * through one harmless `wait` dispatch. */
    function persistedRun(session: GuestSession, storage: FakeStorage): ActiveRun {
      session.dispatch({ type: 'wait' });
      return decodeActiveRun(storage.peek()!, pack);
    }

    /** Exactly what App.tsx hands the session: a thunk over the live Hall repository, through the
     * one shared builder both hosts use. */
    function recordsThunk(repository: RunRecordRepository): () => NewRunRecordsInput {
      return () => newRunRecords(repository, pack);
    }

    it('carries the repository standings and undiscovered artifacts into a fresh run', () => {
      const storage = fakeStorage();
      const repository = createSessionRunRecordRepository(storage);
      storage.set(SAVE_KEY, encodeActiveRun(deadRunAtDepth1(SEED)));
      new GuestSession({ pack, storage }).finalizeConcludedRun(repository, {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });
      const recordId = repository.records()[0]!.recordId;

      const session = new GuestSession({
        pack,
        storage,
        seed: SEED,
        startFresh: true,
        records: recordsThunk(repository),
      });

      const run = persistedRun(session, storage);
      expect(run.fallenHeroStandings.map((standing) => standing.hallRecordId)).toEqual([recordId]);
      expect(run.fallenHeroDecisions[0]).toMatchObject({ role: 'champion', retained: true });
      expect(run.artifactsUndiscovered).toEqual(
        newRunRecords(repository, pack).undiscoveredArtifactIds,
      );
      expect(session.getSnapshot().conclusion).toBeNull();
    });

    it('reads the records provider on every fresh run, so a run started after a finalize sees the updated standings', () => {
      const storage = fakeStorage();
      const repository = createSessionRunRecordRepository(storage);
      // The provider value is created ONCE, before any record exists -- a construction-time
      // snapshot would freeze the empty Hall into every later run.
      const records = recordsThunk(repository);

      const first = new GuestSession({ pack, storage, seed: SEED, startFresh: true, records });
      expect(persistedRun(first, storage).fallenHeroStandings).toEqual([]);

      storage.set(SAVE_KEY, encodeActiveRun(deadRunAtDepth1(SEED)));
      new GuestSession({ pack, storage }).finalizeConcludedRun(repository, {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });
      const recordId = repository.records()[0]!.recordId;

      const second = new GuestSession({ pack, storage, seed: SEED, startFresh: true, records });

      expect(
        persistedRun(second, storage).fallenHeroStandings.map((standing) => standing.hallRecordId),
      ).toEqual([recordId]);
    });

    it('degrades to a history-free run with a data-reset notice when the Hall cannot seed one', () => {
      const storage = fakeStorage();
      const repository = createSessionRunRecordRepository(storage);
      storage.set(SAVE_KEY, encodeActiveRun(deadRunAtDepth1(SEED)));
      new GuestSession({ pack, storage }).finalizeConcludedRun(repository, {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });
      // A standing the run schema rejects — the shape a hand-edited or older-build Hall blob can
      // realistically reach `createNewRun` with.
      const poisoned = () => ({
        ...newRunRecords(repository, pack),
        standings: newRunRecords(repository, pack).standings.map((standing) => ({
          ...standing,
          heirloom: null as unknown as (typeof standing)['heirloom'],
        })),
      });

      // The notice cannot distinguish corrupt history from an engine regression in the records
      // path, so the original error must still reach the console before play degrades.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      let session!: GuestSession;
      try {
        expect(() => {
          session = new GuestSession({
            pack,
            storage,
            seed: SEED,
            startFresh: true,
            records: poisoned,
          });
        }).not.toThrow();
        expect(logged).toHaveBeenCalledTimes(1);
        expect(logged.mock.calls[0]![1]).toBeInstanceOf(SaveLoadError);
      } finally {
        logged.mockRestore();
      }

      expect(session.getSnapshot().notice).toEqual({ kind: 'data-reset', source: 'hall' });
      const run = persistedRun(session, storage);
      expect(run.fallenHeroStandings).toEqual([]);
      expect(run.fallenHeroDecisions).toEqual([]);
      // Still a playable run on the requested seed, not a half-built one.
      expect(run.runSeed).toEqual(SEED);
      expect(encodeActiveRun(run)).toBe(
        encodeActiveRun(
          persistedRun(new GuestSession({ pack, storage, seed: SEED, startFresh: true }), storage),
        ),
      );
    });

    it('propagates a run-creation failure that is not about the history at all, rather than degrading', () => {
      const storage = fakeStorage();
      const repository = createSessionRunRecordRepository(storage);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        // An all-zero seed is rejected by `createNewRun` with or without records, so the
        // recordless retry throws too: a bug that has nothing to do with the Hall must surface as
        // itself, never as a silently history-free run blamed on the player's save.
        expect(
          () =>
            new GuestSession({
              pack,
              storage,
              seed: [0, 0, 0, 0],
              startFresh: true,
              records: recordsThunk(repository),
            }),
        ).toThrow(RangeError);
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    });

    it('creates a history-free run when no records provider is supplied', () => {
      const storage = fakeStorage();
      const run = persistedRun(new GuestSession({ pack, storage, seed: SEED }), storage);
      expect(run.fallenHeroStandings).toEqual([]);
      expect(run.artifactsUndiscovered).toEqual([]);
      expect(run.offeredArtifact).toBeNull();
    });
  });

  describe('lore first-reveal log lines (Task 4)', () => {
    const REVEAL_TEXT = 'The threads whisper of Cave rat.';

    /** Places a visible, hostile `monster.cave-rat` (a bundled fixture with authored `lore`) one
     * tile east of the hero -- `behaviorId: null` so it never acts on its own turn, mirroring the
     * hidden-neighbor fixtures earlier in this suite. Unlike those, this one is NOT hidden by a
     * doused torch: the ambient/lit conditions of a fresh town run already make it visible, so its
     * `contentId` reaches the projection (and therefore `accumulateSightings`) immediately. */
    function withVisibleRat(run: ActiveRun): ActiveRun {
      const hero = run.actors.find((actor) => actor.playerControlled)!;
      const rat: ActorState = {
        ...hero,
        actorId: 'npc.lore-reveal-rat',
        contentId: 'monster.cave-rat',
        playerControlled: false,
        x: hero.x + 1,
        y: hero.y,
        disposition: 'hostile',
        energy: 0,
        equipment: emptyEquipment(),
        behaviorId: null,
      };
      return {
        ...run,
        actors: [...run.actors, rat].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
      };
    }

    it('appends exactly one reveal line the first time a lore-bearing monster becomes visible, and none on re-sighting', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });
      // Mutating the private `run` directly (like the encodeActiveRun regression test above) is the
      // simplest way to make a NEW monster visible mid-session without re-deriving the engine's own
      // perception/movement rules.
      const internals = session as unknown as { run: ActiveRun };
      internals.run = withVisibleRat(internals.run);

      session.dispatch({ type: 'wait' });
      const afterFirst = session.getSnapshot().log;
      expect(afterFirst.filter((line) => line.text === REVEAL_TEXT)).toHaveLength(1);

      session.dispatch({ type: 'wait' });
      const afterSecond = session.getSnapshot().log;
      expect(afterSecond.filter((line) => line.text === REVEAL_TEXT)).toHaveLength(1);
    });

    it('does not emit a reveal line for the initial boot-restore sync of a session whose save already has this monster visible', () => {
      const storage = fakeStorage();
      const seedRun = withVisibleRat(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
      storage.set(SAVE_KEY, encodeActiveRun(seedRun));

      const session = new GuestSession({ pack, storage });

      expect(session.getSnapshot().log.filter((line) => line.text === REVEAL_TEXT)).toHaveLength(0);
    });

    it('a restored session with a pre-seen sighting cache does not re-announce the already-seen set', () => {
      const storage = fakeStorage();
      const seedRun = withVisibleRat(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
      storage.set(SAVE_KEY, encodeActiveRun(seedRun));
      // The sighting cache already records this monster from a prior page life.
      storage.set(SIGHTINGS_KEY, JSON.stringify({ monsterIds: ['monster.cave-rat'], itemIds: [] }));

      const session = new GuestSession({ pack, storage });
      expect(session.getSnapshot().log.filter((line) => line.text === REVEAL_TEXT)).toHaveLength(0);

      // Nor does the next ordinary turn, since the monster is still merely visible, not newly so.
      session.dispatch({ type: 'wait' });
      expect(session.getSnapshot().log.filter((line) => line.text === REVEAL_TEXT)).toHaveLength(0);
    });

    it('appends exactly one reveal line the first time a lore-bearing item becomes identified in the backpack', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });
      const internals = session as unknown as { run: ActiveRun };
      const hero = internals.run.actors.find((actor) => actor.playerControlled)!;
      // `item.hunting-bow` (not `item.iron-sword`, which `DEFAULT_GUEST_HERO` starts already
      // equipped -- see `new-run.ts` -- and so is already in the sighting cache from boot) is a
      // lore-bearing item the starting kit never carries, so its first appearance here is genuinely
      // new.
      const bow: ItemInstance = {
        // Sorts after every bundled item id (`z` last-in-run.items, per the save codec's
        // strictly-increasing-itemId invariant), so appending it keeps the run encodable.
        itemId: 'item.zzz-lore-reveal-bow',
        contentId: 'item.hunting-bow',
        quantity: 1,
        condition: 100,
        enchantment: null,
        identified: true,
        charges: null,
        fuel: null,
        enabled: null,
        location: { type: 'backpack', actorId: hero.actorId },
      };
      internals.run = { ...internals.run, items: [...internals.run.items, bow] };

      session.dispatch({ type: 'wait' });

      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Hunting bow.'),
      ).toHaveLength(1);

      session.dispatch({ type: 'wait' });
      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Hunting bow.'),
      ).toHaveLength(1);
    });
  });

  describe('revealLore (Task 3, dialogue reveal-lore consequence)', () => {
    it('inserts the content id into sightings and appends exactly one reveal line', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });

      session.revealLore('monster.cave-rat');

      expect(session.getSnapshot().sightings.monsterIds).toContain('monster.cave-rat');
      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Cave rat.'),
      ).toHaveLength(1);
    });

    it('is idempotent: revealing the same content id twice appends no duplicate line', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });

      session.revealLore('monster.cave-rat');
      session.revealLore('monster.cave-rat');

      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Cave rat.'),
      ).toHaveLength(1);
    });

    it('persists the reveal to storage so it survives a reload', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });

      // `item.hunting-bow` (not `item.iron-sword`, which `DEFAULT_GUEST_HERO` starts already
      // equipped, and so is already in the sighting cache from boot -- see the lore first-reveal
      // suite above) is an item the starting kit never carries.
      session.revealLore('item.hunting-bow');

      const persisted = JSON.parse(storage.peek(SIGHTINGS_KEY) ?? '{}') as { itemIds?: string[] };
      expect(persisted.itemIds).toContain('item.hunting-bow');
    });
  });

  describe('noteSystemLine (auto-explore stop reports)', () => {
    it('appends a system-tone line, notifies subscribers, and never clears lastEvents', () => {
      const storage = fakeStorage();
      const session = new GuestSession({ pack, storage, seed: SEED });

      // A resolved turn leaves `lastEvents` populated -- `ui/playfield/scene-state.ts` derives the
      // hero hurt flash and the event particles from it. An auto-explore stop note is written a
      // step-interval later, against that very snapshot, so it must not erase them.
      session.dispatch({ type: 'wait' });
      const events = session.getSnapshot().lastEvents;
      expect(events.length).toBeGreaterThan(0);

      let notified = 0;
      session.subscribe(() => {
        notified += 1;
      });

      session.noteSystemLine('You have explored this floor.');

      const snapshot = session.getSnapshot();
      expect(snapshot.log.at(-1)).toMatchObject({
        text: 'You have explored this floor.',
        tone: 'system',
      });
      expect(notified).toBe(1);
      expect(snapshot.lastEvents).toEqual(events);
    });
  });

  describe('Wanderer checkpoints', () => {
    it('writes a checkpoint after a descend transition in wanderer mode', () => {
      const storage = memoryStorage();
      const session = wandererSession(storage);
      walkAndDescend(session);

      const checkpoint = storage.get(CHECKPOINT_KEY);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint).toBe(storage.get(SAVE_KEY));
    });

    it('writes a checkpoint on every transition kind', () => {
      const storage = memoryStorage();
      const session = wandererSession(storage);
      walkAndDescend(session);
      const first = storage.get(CHECKPOINT_KEY);

      descendAgain(session); // second floor: stored/generated descend
      expect(storage.get(CHECKPOINT_KEY)).not.toBe(first);

      session.dispatch({ type: 'ascend' });
      expect(storage.get(CHECKPOINT_KEY)).toBe(storage.get(SAVE_KEY));
    });

    it('does not move the checkpoint on a non-transition dispatch', () => {
      const storage = memoryStorage();
      const session = wandererSession(storage);
      walkAndDescend(session);
      const atFloorEntry = storage.get(CHECKPOINT_KEY);

      session.dispatch({ type: 'wait' });

      expect(storage.get(CHECKPOINT_KEY)).toBe(atFloorEntry);
      expect(storage.get(SAVE_KEY)).not.toBe(atFloorEntry);
    });

    it('never writes a checkpoint in classic mode', () => {
      const storage = memoryStorage();
      const session = new GuestSession({
        pack,
        storage,
        seed: DESCEND_SEED,
        hero: DEFAULT_GUEST_HERO,
        startFresh: true,
      });
      walkAndDescend(session);
      session.dispatch({ type: 'wait' });

      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
    });

    it('clears a stale checkpoint when a fresh run starts', () => {
      const storage = memoryStorage();
      storage.set(CHECKPOINT_KEY, 'stale');

      new GuestSession({
        pack,
        storage,
        seed: DESCEND_SEED,
        hero: DEFAULT_GUEST_HERO,
        startFresh: true,
        mode: 'wanderer',
      });

      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
    });

    it('degrades gracefully when the checkpoint write hits quota', () => {
      const storage = quotaFailingStorage(CHECKPOINT_KEY);
      const session = wandererSession(storage);

      expect(() => walkAndDescend(session)).not.toThrow();
      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
      expect(session.getSnapshot().log.at(-1)?.text).toBe('The Deep will not promise a return.');
    });

    it('keeps playing after a checkpoint quota failure', () => {
      const storage = quotaFailingStorage(CHECKPOINT_KEY);
      const session = wandererSession(storage);
      walkAndDescend(session);

      session.dispatch({ type: 'wait' });

      expect(session.getSnapshot().projection.conclusion).toBeNull();
    });

    it('lists the checkpoint key as a guest wipe target', () => {
      expect(GUEST_SESSION_STORAGE_KEYS).toContain(CHECKPOINT_KEY);
    });
  });

  describe('Wanderer rise again', () => {
    /**
     * Drives the run in `storage` to a real, engine-produced hero death and returns the session it
     * died in.
     *
     * Killing the hero has to go through the engine (a synthesized `died` conclusion would prove
     * nothing about the rewind), but this pack's hunger reserve is thousands of world-time units
     * deep, so waiting one out is not a test. Instead the persisted save is rewritten into a
     * one-hit-from-starvation shape and the session is REBOOTED over the same storage -- a plain
     * `restored` boot, exactly like a page reload mid-run, which by contract leaves the Wanderer
     * checkpoint (and the command-sequence counter) untouched. The single `wait` that follows is
     * then a genuine `resolveCommand` death.
     */
    function killHero(storage: FakeStorage): GuestSession {
      const run = decodeActiveRun(storage.peek()!, pack);
      const hero = run.actors.find((actor) => actor.playerControlled)!;
      const doomed: ActiveRun = {
        ...run,
        actors: run.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 1 } : actor,
        ),
        survival: {
          ...run.survival,
          hungerReserve: 0,
          hungerStage: 'starving',
          nextStarvationAt: run.worldTime,
        },
      };
      storage.set(SAVE_KEY, encodeActiveRun(doomed));
      const session = new GuestSession({ pack, storage });
      session.dispatch({ type: 'wait' });
      return session;
    }

    /** The encoded save with the session-owned command ids blanked out: `recentCommands` keeps the
     * id of every command that produced it (on the command, its result, and its events), and those
     * ids deliberately do NOT rewind across a rise (see `GuestSession.riseAgain`) -- so identity of
     * the ENGINE state is asserted with them normalized away, and nothing else. */
    function engineStateWithoutCommandIds(encoded: string): string {
      return encoded.replaceAll(/command\.guest-\d+/g, 'command.normalized');
    }

    it('rises again to the exact floor-entry state', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      const atFloorEntry = storage.get(CHECKPOINT_KEY)!;

      const session = killHero(storage);
      expect(session.getSnapshot().projection.conclusion?.completionType).toBe('died');

      expect(session.riseAgain()).toBe(true);
      expect(session.getSnapshot().projection.conclusion).toBeNull();
      expect(storage.get(SAVE_KEY)).toBe(atFloorEntry);
    });

    it('replays byte-identically after a rise until the player diverges', () => {
      const storage = memoryStorage();
      const first = wandererSession(storage);
      walkAndDescend(first);
      first.dispatch({ type: 'wait' });
      const afterOneWait = storage.get(SAVE_KEY)!;

      const session = killHero(storage);
      expect(session.riseAgain()).toBe(true);
      session.dispatch({ type: 'wait' });

      expect(engineStateWithoutCommandIds(storage.get(SAVE_KEY)!)).toEqual(
        engineStateWithoutCommandIds(afterOneWait),
      );
    });

    it('rises twice from the same floor-entry checkpoint', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      const atFloorEntry = storage.get(CHECKPOINT_KEY)!;

      expect(killHero(storage).riseAgain()).toBe(true);
      // A rise consumes nothing: the rewind point stands until the next floor entry rewrites it,
      // so dying again on the same floor can rise again.
      expect(storage.get(CHECKPOINT_KEY)).toBe(atFloorEntry);

      const second = killHero(storage);
      expect(second.riseAgain()).toBe(true);
      expect(second.getSnapshot().projection.conclusion).toBeNull();
      expect(storage.get(SAVE_KEY)).toBe(atFloorEntry);
    });

    it('refuses a checkpoint belonging to a different run', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      // Same content pack, same mode, decodes cleanly -- but a different run's seed. Swapping it
      // in would drop the player into a run they never played, and a later accept-death would
      // write a Hall record for it.
      storage.set(
        CHECKPOINT_KEY,
        encodeActiveRun(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO })),
      );

      const session = killHero(storage);

      expect(session.riseAgain()).toBe(false);
      expect(session.getSnapshot().projection.conclusion?.completionType).toBe('died');
      expect(session.getSnapshot().log.at(-1)?.text).toBe(
        'The Deep offers no way back. This death stands.',
      );
      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
    });

    it('keeps advancing the command sequence across a rise, so no commandId repeats', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      const before = Number(storage.get(COMMAND_SEQUENCE_KEY));

      const session = killHero(storage);
      session.riseAgain();

      expect(Number(storage.get(COMMAND_SEQUENCE_KEY))).toBeGreaterThan(before);
    });

    it('returns false and logs when no checkpoint exists', () => {
      // Quota refused every checkpoint write, so this floor entry left no rewind point at all --
      // the same shape as a death before any floor entry, and the one a real browser produces.
      const storage = quotaFailingStorage(CHECKPOINT_KEY);
      walkAndDescend(wandererSession(storage));
      expect(storage.get(CHECKPOINT_KEY)).toBeNull();

      const session = killHero(storage);

      expect(session.riseAgain()).toBe(false);
      expect(session.getSnapshot().log.at(-1)?.text).toBe(
        'The Deep offers no way back. This death stands.',
      );
    });

    it('returns false and logs when the checkpoint is corrupt', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      storage.set(CHECKPOINT_KEY, '{"schemaVersion":15,"nonsense":true}');

      const session = killHero(storage);

      expect(session.riseAgain()).toBe(false);
      expect(session.getSnapshot().projection.conclusion?.completionType).toBe('died');
      expect(session.getSnapshot().log.at(-1)?.text).toBe(
        'The Deep offers no way back. This death stands.',
      );
    });

    it('drops the unusable checkpoint when it refuses to rise', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      storage.set(CHECKPOINT_KEY, 'not a save');

      const session = killHero(storage);
      expect(session.riseAgain()).toBe(false);

      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
    });

    it('refuses to rise a classic run', () => {
      const storage = memoryStorage();
      const classic = new GuestSession({
        pack,
        storage,
        seed: DESCEND_SEED,
        hero: DEFAULT_GUEST_HERO,
        startFresh: true,
      });
      walkAndDescend(classic);

      const session = killHero(storage);

      expect(session.riseAgain()).toBe(false);
    });

    it('refuses to rise a run that has not concluded', () => {
      const storage = memoryStorage();
      const session = wandererSession(storage);
      walkAndDescend(session);

      expect(session.riseAgain()).toBe(false);
      expect(storage.get(CHECKPOINT_KEY)).not.toBeNull();
    });

    it('clears the checkpoint when the run ends for good', () => {
      const storage = memoryStorage();
      walkAndDescend(wandererSession(storage));
      const session = killHero(storage);
      expect(storage.get(CHECKPOINT_KEY)).not.toBeNull();

      session.finalizeConcludedRun(createSessionRunRecordRepository(storage), {
        achievedAt: 'Run #1',
        portraitGlyph: '@',
      });

      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
    });
  });

  describe('Wanderer finalize gating (Task 6)', () => {
    /** Same engine-driven death as `killHero` in the "Wanderer rise again" describe above, kept
     * local here so this describe stays self-contained. */
    function killHero(storage: FakeStorage): GuestSession {
      const run = decodeActiveRun(storage.peek()!, pack);
      const hero = run.actors.find((actor) => actor.playerControlled)!;
      const doomed: ActiveRun = {
        ...run,
        actors: run.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 1 } : actor,
        ),
        survival: {
          ...run.survival,
          hungerReserve: 0,
          hungerStage: 'starving',
          nextStarvationAt: run.worldTime,
        },
      };
      storage.set(SAVE_KEY, encodeActiveRun(doomed));
      const session = new GuestSession({ pack, storage });
      session.dispatch({ type: 'wait' });
      return session;
    }

    const enrichment = { achievedAt: 'Run #1', portraitGlyph: '@' };

    /** A wanderer run synthesized straight into a `broke-cycle` victory conclusion -- mirrors
     * `heartRun`/`deadRun` in the "death and finalization" describe above, which likewise build
     * the conclusion directly rather than actually playing to the Final Chamber. */
    function wandererBrokeCycleRun(seed: Uint32State): ActiveRun {
      const fresh = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' });
      return {
        ...fresh,
        conclusion: {
          completionType: 'broke-cycle',
          cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
          concludedAtRevision: fresh.revision,
          finalized: false,
        },
      };
    }

    it('writes nothing to the Hall when a wanderer run ends in death', () => {
      const storage = memoryStorage();
      const repository = createSessionRunRecordRepository(storage);
      walkAndDescend(wandererSession(storage));
      const session = killHero(storage);

      const projection = session.finalizeConcludedRun(repository, enrichment);

      expect(repository.records()).toEqual([]);
      expect(repository.lifetime()).toEqual(emptyLifetimeState());
      expect(projection.finalized).toBe(false);
      expect(projection.score).toBeNull();
      expect(projection.heirloom).toBeNull();
      expect(projection.mode).toBe('wanderer');
    });

    it('writes nothing to the Hall when a wanderer run WINS', () => {
      const storage = memoryStorage();
      const repository = createSessionRunRecordRepository(storage);
      storage.set(SAVE_KEY, encodeActiveRun(wandererBrokeCycleRun(SEED)));
      const session = new GuestSession({ pack, storage });

      const projection = session.finalizeConcludedRun(repository, enrichment);

      expect(repository.records()).toEqual([]);
      expect(projection.completionType).toBe('broke-cycle');
      expect(projection.finalized).toBe(false);
    });

    /** `finalizeConcludedRun`'s wanderer branch removes `SAVE_KEY` before returning, so the
     * encoded save can no longer prove anything about the RNG state post-call -- reading it back
     * would either be `null` or (worse) silently compare `before` against itself. The concluded
     * run itself still lives in memory on the session (`GuestSession.run`, private), so this
     * reaches through that private field directly rather than round-tripping through storage. */
    function runRecordsRngStream(session: GuestSession): unknown {
      return (session as unknown as { run: ActiveRun }).run.rng['run-records'];
    }

    it('leaves the run-records rng stream untouched for a wanderer conclusion', () => {
      const storage = memoryStorage();
      const repository = createSessionRunRecordRepository(storage);
      walkAndDescend(wandererSession(storage));
      const session = killHero(storage);
      const before = runRecordsRngStream(session);

      session.finalizeConcludedRun(repository, enrichment);

      expect(runRecordsRngStream(session)).toEqual(before);
    });

    it('clears the run save and the checkpoint when a wanderer run ends', () => {
      const storage = memoryStorage();
      const repository = createSessionRunRecordRepository(storage);
      walkAndDescend(wandererSession(storage));
      const session = killHero(storage);

      session.finalizeConcludedRun(repository, enrichment);

      expect(storage.get(CHECKPOINT_KEY)).toBeNull();
      expect(storage.get(SAVE_KEY)).toBeNull();
    });

    it('still finalizes a classic run into the Hall', () => {
      const storage = memoryStorage();
      const repository = createSessionRunRecordRepository(storage);
      const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
      const hero = fresh.actors.find((actor) => actor.playerControlled)!;
      const dead: ActiveRun = {
        ...fresh,
        actors: fresh.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
        ),
        conclusion: {
          completionType: 'died',
          cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
          concludedAtRevision: fresh.revision,
          finalized: false,
        },
      };
      storage.set(SAVE_KEY, encodeActiveRun(dead));
      const session = new GuestSession({ pack, storage });

      const projection = session.finalizeConcludedRun(repository, enrichment);

      expect(repository.records()).toHaveLength(1);
      expect(projection.finalized).toBe(true);
      expect(projection.mode).toBe('classic');
    });
  });
});
