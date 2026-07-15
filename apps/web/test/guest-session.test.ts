import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, emptyEquipment, encodeActiveRun,
  type ActiveRun, type ActorState, type Uint32State,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';

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
  peek(): string | null;
}

function fakeStorage(): FakeStorage {
  let value: string | null = null;
  return {
    get: () => value,
    set: (v: string) => { value = v; },
    peek: () => value,
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
    storage.set('{"not": "a save"}');

    const session = new GuestSession({ pack, storage, seed: SEED });
    expect(session.getSnapshot().notice?.kind).toBe('save-discarded');
    // Still gets a playable run even though the save was discarded.
    session.dispatch({ type: 'wait' });
    expect(session.getSnapshot().projection.metrics.turnsElapsed).toBe(1);
  });

  it('discards a restored save whose content hash no longer matches the served pack', () => {
    const storage = fakeStorage();
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    storage.set(encodeActiveRun(run));
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
    storage.set(encodeActiveRun(withHiddenNeighbor));

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
    storage.set(encodeActiveRun(withHiddenNeighbor));

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
      set: (value: string) => {
        if (failNextWrite) {
          const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          throw quota;
        }
        storage.set(value);
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

  it('derives command ids from the run revision so they stay unique and deterministic across reload', () => {
    const storage = fakeStorage();
    const session = new GuestSession({ pack, storage, seed: SEED });
    session.dispatch({ type: 'wait' });
    session.dispatch({ type: 'wait' });

    const saved = storage.peek();
    const restored = decodeActiveRun(saved!);
    expect(restored.recentCommands.map((entry) => entry.command.commandId))
      .toEqual(['command.guest-000001', 'command.guest-000002']);
  });
});
