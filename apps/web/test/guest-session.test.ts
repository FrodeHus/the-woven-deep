import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, emptyEquipment, encodeActiveRun,
  RECENT_COMMAND_LIMIT, type ActiveRun, type ActorState, type Uint32State,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { COMMAND_SEQUENCE_KEY, SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

// Found by scanning candidate seeds `[a, a+1, a+2, a+3]` for a==743 in a small throwaway script:
// createNewRun a depth-1 floor, then `findPath` (topology 8) from the hero's spawn to the floor's
// `stairDown`. This seed's path is 16 steps and crosses no other actor's starting position, so
// walking it with plain `move` intents never bumps into anything.
const DESCEND_SEED: Uint32State = [743, 744, 745, 746];
const DESCEND_PATH = [
  'east', 'southeast', 'southeast', 'southeast', 'southeast', 'southeast', 'southeast', 'east',
  'east', 'southeast', 'southwest', 'southeast', 'southeast', 'southeast', 'southeast', 'southeast',
] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
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
    set: (key: string, value: string) => { values.set(key, value); },
    peek: (key: string = SAVE_KEY) => values.get(key) ?? null,
  };
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

  it('discards a restored save whose content hash no longer matches the served pack', () => {
    const storage = fakeStorage();
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    storage.set(SAVE_KEY, encodeActiveRun(run));
    const mismatchedPack: CompiledContentPack = { ...pack, hash: 'f'.repeat(64) };

    const session = new GuestSession({ pack: mismatchedPack, storage, seed: SEED });
    expect(session.getSnapshot().notice).toEqual({ kind: 'save-discarded', reason: 'content_hash_mismatch' });
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
    expect(restored.activeFloorId).toBe('floor.depth-002');
  });

  it('exposes lastEvents for one snapshot generation and pendingDecision for decision_required results', () => {
    const storage = fakeStorage();
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = run.actors.find((actor) => actor.playerControlled)!;

    // Douse the hero's torch and place a neutral actor one tile east, in the dark, so it never
    // appears in the hero's own projection (`visiblyOccupied` excludes unlit cells). The client
    // therefore believes the target cell is empty and issues a plain `move`, which the engine
    // resolves against the *actual* occupant: a neutral actor triggers `decision_required`
    // instead of either moving or attacking. See `packages/engine/src/movement.ts`.
    const doused = run.items.map((item) => item.location.type === 'equipped' && item.location.slot === 'off-hand'
      ? { ...item, enabled: false } : item);
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
      actors: [...run.actors, hiddenNeighbor].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
    };
    storage.set(SAVE_KEY, encodeActiveRun(withHiddenNeighbor));

    const session = new GuestSession({ pack, storage });
    session.dispatch({ type: 'move', direction: 'east' });

    const snapshot = session.getSnapshot();
    expect(snapshot.pendingDecision).toEqual({ type: 'confirm-aggression', targetActorId: 'npc.hidden-bystander' });
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
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = run.actors.find((actor) => actor.playerControlled)!;
    const doused = run.items.map((item) => item.location.type === 'equipped' && item.location.slot === 'off-hand'
      ? { ...item, enabled: false } : item);
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
      actors: [...run.actors, hiddenNeighbor].sort((left, right) => (left.actorId < right.actorId ? -1 : 1)),
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
      set: (key: string, value: string) => { setCalls += 1; storage.set(key, value); },
    };
    const session = new GuestSession({ pack, storage: countingStorage, seed: SEED });
    const sessionInternals = session as unknown as { run: ActiveRun; persist(): void };

    sessionInternals.run = {
      ...sessionInternals.run,
      populations: [{
        populationId: 'population.corrupt', encounterId: 'encounter.corrupt', model: 'individual',
        floorId: sessionInternals.run.activeFloorId, createdAt: 0,
        livingMemberIds: ['monster.does-not-exist'], formerMemberIds: [],
      }],
    };

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
    expect(restored.recentCommands.map((entry) => entry.command.commandId))
      .toEqual(['command.guest-0000000000', 'command.guest-0000000001']);
    expect(storage.peek(COMMAND_SEQUENCE_KEY)).toBe('2');
  });

  it('recovers from a wall bump instead of soft-locking on a reused command id', () => {
    // Regression coverage for the final-review finding that motivated the first fix attempt:
    // deriving commandId from `revision + 1` alone collides forever after any `invalid` result,
    // because the engine records invalid results into `recentCommands` WITHOUT advancing revision
    // (reducer.ts recordInvalid), and rejects any later same-id/different-payload command as
    // `command_id_conflict`. From this seed's start position, `north` is a wall (verified against
    // the compiled floor's tiles), so it is guaranteed to produce an `invalid` result without
    // moving the hero.
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    const logBefore = session.getSnapshot().log.length;

    session.dispatch({ type: 'move', direction: 'north' });

    const afterBump = session.getSnapshot();
    expect(afterBump.log.length).toBe(logBefore + 1);
    expect(afterBump.log.at(-1)?.tone).toBe('system');
    expect(afterBump.projection.metrics.turnsElapsed).toBe(0);

    session.dispatch({ type: 'wait' });
    const afterWait = session.getSnapshot();
    expect(afterWait.projection.metrics.turnsElapsed).toBe(1);

    // Persist + restore, then dispatch again: the restored counter must still be able to advance.
    const saved = storage.peek();
    const restoredSession = new GuestSession({ pack, storage: { ...storage, get: () => saved } });
    restoredSession.dispatch({ type: 'wait' });
    expect(restoredSession.getSnapshot().projection.metrics.turnsElapsed).toBe(2);
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

    // From this seed's spawn tile, `north` is a wall (see the wall-bump test above), so both
    // dispatches below produce `invalid` results without moving the hero or advancing revision.
    session.dispatch({ type: 'move', direction: 'north' });
    session.dispatch({ type: 'move', direction: 'north' });

    session.dispatch({ type: 'wait' });
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(RECENT_COMMAND_LIMIT + 1);
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
});
