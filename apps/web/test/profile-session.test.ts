import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  finalizeRunRecordsDemo,
  FINAL_CHAMBER_DEPTH,
  isHeartBossActive,
  projectGameplayState,
  projectRunConclusion,
  type ActiveRun,
  type PublicDecision,
  type PublicEvent,
  type Uint32State,
} from '@woven-deep/engine';
import {
  ProfileSession,
  type ServerMessage,
  type ServerRunSnapshot,
} from '../src/session/profile-session.js';
import type { WebSocketLike } from '../src/session/ws-client.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function freshRun(seed: Uint32State = SEED): ActiveRun {
  return createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
}

function snapshotOf(
  run: ActiveRun,
  overrides: Partial<
    Pick<ServerRunSnapshot, 'lastEvents' | 'pendingDecision' | 'houseOpen' | 'bossActive'>
  > = {},
): ServerRunSnapshot {
  return {
    projection: projectGameplayState({ state: run, content: pack }),
    lastEvents: overrides.lastEvents ?? [],
    revision: run.revision,
    pendingDecision: overrides.pendingDecision ?? null,
    conclusion:
      run.conclusion === null
        ? null
        : projectRunConclusion({ run, record: null, achievements: [] }),
    houseOpen: overrides.houseOpen ?? false,
    heroClassTags: [...run.hero.classTags],
    bossActive: overrides.bossActive ?? isHeartBossActive(run),
  };
}

/** A fully in-memory `WebSocketLike` -- `emit` lets a test push a `ServerMessage` straight through
 * as if the (real) server had just sent it; `sentMessages` decodes everything the client sent. */
class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly rawSent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: Readonly<{ data: unknown }>) => void) | null = null;

  send(data: string): void {
    this.rawSent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  get sentMessages(): readonly unknown[] {
    return this.rawSent.map((raw) => JSON.parse(raw));
  }
}

interface Harness {
  readonly sockets: FakeSocket[];
  readonly socket: () => FakeSocket;
  readonly connectPromise: Promise<ProfileSession>;
  readonly outcomePromise: ReturnType<typeof ProfileSession.connect>;
}

function harness(): Harness {
  const sockets: FakeSocket[] = [];
  const outcomePromise = ProfileSession.connect({
    pack,
    url: 'ws://test/ws/play',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  // Every pre-existing test connects into a run that already exists, so the harness unwraps the
  // session outcome; the chargen outcome has its own tests below.
  const connectPromise = outcomePromise.then((outcome) => {
    if (outcome.kind !== 'session') throw new Error('expected a session outcome');
    return outcome.session;
  });
  // The chargen-outcome tests never await connectPromise; swallow its expected rejection so it
  // can't surface as an unhandled rejection after the test body has already passed.
  void connectPromise.catch(() => {});
  return { sockets, socket: () => sockets[sockets.length - 1]!, connectPromise, outcomePromise };
}

const HELLO: ServerMessage = {
  type: 'hello',
  protocolVersion: 1,
  contentHash: 'test-hash',
  gameVersion: 'test-version',
  saveSchemaVersion: 1,
};

describe('ProfileSession chargen handshake', () => {
  const CHOICES = {
    name: 'Chosen',
    method: 'roll' as const,
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    classId: 'class.wayfarer',
    kitId: 'blade',
    backgroundId: 'background.caravan-guard',
    traitIds: [],
  };

  it('resolves the chargen outcome on no-run, and startRun sends choices then yields the session', async () => {
    const { socket, outcomePromise } = harness();
    socket().emit(HELLO);
    socket().emit({ type: 'no-run' });
    const outcome = await outcomePromise;
    expect(outcome.kind).toBe('chargen');
    if (outcome.kind !== 'chargen') return;

    const sessionPromise = outcome.pending.startRun(CHOICES, 'classic');
    expect(socket().sentMessages.at(-1)).toMatchObject({
      type: 'start-run',
      expectedRevision: 0,
      choices: CHOICES,
      mode: 'classic',
    });

    socket().emit({ type: 'state', snapshot: snapshotOf(freshRun()) });
    const session = await sessionPromise;
    expect(session.getSnapshot().projection.floor).toBeDefined();
  });

  it('a refused start-run rejects but leaves the connection open for a corrected resend', async () => {
    const { socket, outcomePromise } = harness();
    socket().emit(HELLO);
    socket().emit({ type: 'no-run' });
    const outcome = await outcomePromise;
    if (outcome.kind !== 'chargen') throw new Error('expected chargen outcome');

    const first = outcome.pending.startRun(CHOICES, 'classic');
    socket().emit({ type: 'error', code: 'invalid-choices', message: 'no such class' });
    await expect(first).rejects.toThrow(/invalid-choices/);
    expect(socket().readyState).toBe(1);

    const second = outcome.pending.startRun(CHOICES, 'classic');
    socket().emit({ type: 'state', snapshot: snapshotOf(freshRun()) });
    await expect(second).resolves.toBeInstanceOf(ProfileSession);
  });
});

describe('ProfileSession', () => {
  it('sends nothing until hello + state arrive, then resolves with a full snapshot', async () => {
    const { socket, connectPromise } = harness();
    expect(socket().rawSent).toEqual([]);

    let resolved = false;
    void connectPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(socket().rawSent).toEqual([]);

    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });

    const session = await connectPromise;
    const snapshot = session.getSnapshot();
    expect(snapshot.projection.floor).toBeDefined();
    expect(snapshot.log).toEqual([]);
    expect(snapshot.sightings.monsterIds).toBeInstanceOf(Array);
    expect(snapshot.heroClassTags).toEqual([...run.hero.classTags]);
    expect(snapshot.pendingDecision).toBeNull();
    expect(snapshot.notice).toBeNull();
    expect(snapshot.houseOpen).toBe(false);
    expect(snapshot.conclusion).toBeNull();
  });

  it('dispatch sends a command with the minted commandId + expectedRevision, and the reply advances the snapshot', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    let notified = 0;
    session.subscribe(() => {
      notified += 1;
    });

    session.dispatch({ type: 'wait' });

    expect(socket().sentMessages).toEqual([
      {
        type: 'command',
        commandId: expect.any(String),
        expectedRevision: run.revision,
        intent: { type: 'wait' },
      },
    ]);

    const advancedRun: ActiveRun = { ...run, revision: run.revision + 1 };
    const events: readonly PublicEvent[] = [{ type: 'hero.moved' } as unknown as PublicEvent];
    socket().emit({
      type: 'state',
      snapshot: snapshotOf(advancedRun, { lastEvents: events }),
    });

    expect(notified).toBe(1);
    const snapshot = session.getSnapshot();
    expect(snapshot.projection.metrics).toEqual(
      projectGameplayState({ state: advancedRun, content: pack }).metrics,
    );
  });

  describe('in-flight gating (held-key navigation)', () => {
    it('queues an intent dispatched while another awaits its reply, sending it with the fresh revision', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      session.dispatch({ type: 'move', direction: 'east' });
      // A held key repeats before the reply arrives. Sending it now would carry a stale
      // expectedRevision and be rejected -- the very spam that made signed-in navigation crawl.
      session.dispatch({ type: 'move', direction: 'east' });
      expect(socket().sentMessages).toHaveLength(1);

      const advanced: ActiveRun = { ...run, revision: run.revision + 1 };
      socket().emit({ type: 'state', snapshot: snapshotOf(advanced) });

      expect(socket().sentMessages).toHaveLength(2);
      expect(socket().sentMessages.at(-1)).toMatchObject({
        type: 'command',
        expectedRevision: advanced.revision,
        intent: { type: 'move', direction: 'east' },
      });
    });

    it('keeps only the newest queued intent (latest-wins) so a released key never rubber-bands', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      session.dispatch({ type: 'move', direction: 'east' });
      session.dispatch({ type: 'move', direction: 'east' });
      session.dispatch({ type: 'move', direction: 'south' });
      expect(socket().sentMessages).toHaveLength(1);

      const advanced: ActiveRun = { ...run, revision: run.revision + 1 };
      socket().emit({ type: 'state', snapshot: snapshotOf(advanced) });

      // Only the latest repeat went out; the backlog never replays.
      expect(socket().sentMessages).toHaveLength(2);
      expect(socket().sentMessages.at(-1)).toMatchObject({
        intent: { type: 'move', direction: 'south' },
      });
      const settled: ActiveRun = { ...run, revision: run.revision + 2 };
      socket().emit({ type: 'state', snapshot: snapshotOf(settled) });
      expect(socket().sentMessages).toHaveLength(2);
    });

    it('a rejected reply also releases the queue', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      session.dispatch({ type: 'pick-lock' });
      session.dispatch({ type: 'move', direction: 'north' });
      expect(socket().sentMessages).toHaveLength(1);

      socket().emit({ type: 'rejected', reason: 'no lock here', snapshot: snapshotOf(run) });

      expect(socket().sentMessages).toHaveLength(2);
      expect(socket().sentMessages.at(-1)).toMatchObject({
        intent: { type: 'move', direction: 'north' },
      });
    });

    it('a decision-required reply drops the queued intent instead of firing it into the modal', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      session.dispatch({ type: 'move', direction: 'north' });
      session.dispatch({ type: 'move', direction: 'north' });
      const decision: PublicDecision = {
        kind: 'confirm-aggression',
        targetActorId: 'actor.some-monster',
      } as unknown as PublicDecision;
      socket().emit({
        type: 'decision-required',
        decision,
        snapshot: snapshotOf(run, { pendingDecision: decision }),
      });

      expect(socket().sentMessages).toHaveLength(1);
      // The queue is also idle again: the next explicit dispatch goes straight out.
      session.answerDecision(true);
      expect(socket().sentMessages).toHaveLength(2);
    });
  });

  it('surfaces a rejected command as a log line without a pending decision', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    session.dispatch({ type: 'pick-lock' });
    socket().emit({
      type: 'rejected',
      reason: 'not adjacent to a lockable feature',
      snapshot: snapshotOf(run),
    });

    const snapshot = session.getSnapshot();
    expect(snapshot.log.at(-1)).toMatchObject({
      text: 'not adjacent to a lockable feature',
      tone: 'system',
    });
    expect(snapshot.pendingDecision).toBeNull();
    expect(snapshot.lastEvents).toEqual([]);
  });

  it('exposes pendingDecision from a decision-required reply', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    const decision: PublicDecision = {
      kind: 'confirm-aggression',
      targetActorId: 'actor.some-monster',
    } as unknown as PublicDecision;
    session.dispatch({ type: 'move', direction: 'north' });
    socket().emit({
      type: 'decision-required',
      decision,
      snapshot: snapshotOf(run, { pendingDecision: decision }),
    });

    expect(session.getSnapshot().pendingDecision).toEqual(decision);
  });

  it('does not offer the Final Chamber choice when the server reports the boss active, even though no boss actor is visible on the projection (hero standing in the dark)', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    // `bossActive: true` simulates the engine-authoritative `isHeartBossActive` while the
    // projection's visible-actor list stays empty -- exactly what the illumination-gated
    // projection looks like when the hero's own tile is at 0 illumination. The OLD logic (deriving
    // "boss active" from `actorsOf(projection).some(...)`) would see no visible boss actor and
    // wrongly re-offer the choice; the fix must trust `snapshot.bossActive` instead.
    const base = snapshotOf(run, { bossActive: true });
    const chamberSnapshot: ServerRunSnapshot = {
      ...base,
      projection: {
        ...base.projection,
        floor: { ...base.projection.floor, depth: FINAL_CHAMBER_DEPTH },
      },
    };
    socket().emit({ type: 'state', snapshot: chamberSnapshot });
    const session = await connectPromise;

    expect(session.getSnapshot().pendingFinalChamberChoice).toBeNull();
  });

  it('flips to a terminal, read-only notice on superseded and stops reconnecting', async () => {
    const { sockets, socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    socket().emit({ type: 'superseded' });

    expect(session.getSnapshot().notice).toEqual({ kind: 'superseded' });
    expect(socket().readyState).toBe(3);

    // The close triggered by `superseded` must not schedule a reconnect.
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
    expect(sockets).toHaveLength(1);
  });

  it('sets a terminal protocol-error notice on a version/content-mismatch error', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    socket().emit({ type: 'error', code: 'content-mismatch', message: 'content hash differs' });

    expect(session.getSnapshot().notice).toEqual({
      kind: 'protocol-error',
      code: 'content-mismatch',
      message: 'content hash differs',
    });
  });

  it('rejects connect() when the server errors before ever sending a state', async () => {
    const { socket, connectPromise } = harness();
    socket().emit(HELLO);
    socket().emit({ type: 'error', code: 'content-mismatch', message: 'content hash differs' });

    await expect(connectPromise).rejects.toThrow(/content-mismatch/);
  });

  it('reconnects after an unexpected close and re-syncs from the fresh state', async () => {
    vi.useFakeTimers();
    try {
      const { sockets, socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      // An unexpected close (not caller-requested) must trigger a reconnect.
      socket().onclose?.();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(2);

      const resumedRun: ActiveRun = { ...run, revision: run.revision + 5 };
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(resumedRun) });

      expect(session.getSnapshot().projection.metrics).toEqual(
        projectGameplayState({ state: resumedRun, content: pack }).metrics,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the house screen when a house intent is applied, and setHouseOpen(false) closes it locally', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;
    expect(session.getSnapshot().houseOpen).toBe(false);

    session.dispatch({ type: 'house' });
    socket().emit({ type: 'state', snapshot: snapshotOf(run, { houseOpen: true }) });
    expect(session.getSnapshot().houseOpen).toBe(true);

    session.setHouseOpen(false);
    expect(session.getSnapshot().houseOpen).toBe(false);

    // A later, unrelated `state` reply must not reopen it just because the server's own
    // `houseOpen` flag never resets to false.
    session.dispatch({ type: 'wait' });
    socket().emit({
      type: 'state',
      snapshot: snapshotOf({ ...run, revision: run.revision + 1 }, { houseOpen: true }),
    });
    expect(session.getSnapshot().houseOpen).toBe(false);
  });

  it('finalizeConcludedRun throws when the run has not concluded', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    expect(() => session.finalizeConcludedRun({} as never, {} as never)).toThrow(
      /requires a concluded run/,
    );
  });

  it('finalizeConcludedRun surfaces the real, non-null score/heirloom/achievements the server already finalized', async () => {
    const { socket, connectPromise } = harness();
    const fresh = freshRun();
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
    // Mirrors what the server does before ever sending a concluded run's `state` reply: finalize
    // it into a `HallRecord` (so `score`/`heirloom` are real, not the `record: null` this suite's
    // `snapshotOf` helper otherwise defaults to) and project the real conclusion from that record.
    const finalized = finalizeRunRecordsDemo(dead, pack);
    const conclusion = projectRunConclusion({
      run: finalized.state,
      record: finalized.record,
      achievements: finalized.deltas.achievementGrants,
    });

    socket().emit(HELLO);
    socket().emit({
      type: 'state',
      snapshot: { ...snapshotOf(finalized.state), conclusion },
    });
    const session = await connectPromise;

    const projection = session.finalizeConcludedRun({} as never, {} as never);
    expect(projection.finalized).toBe(true);
    expect(projection.score).not.toBeNull();
    expect(projection.heirloom).not.toBeNull();
    expect(projection.score).toEqual(finalized.record.score);
    expect(projection.heirloom).toEqual(finalized.record.heirloom);
  });

  describe('wanderer rise and accept (Task 8)', () => {
    /** A connected session sitting on a concluded (died) run of the given mode -- the state the
     * client's death overlay is rendered from. */
    async function sessionAtDeath(mode: 'classic' | 'wanderer'): Promise<{
      session: ProfileSession;
      socket: () => FakeSocket;
      /** The concluded snapshot the server pushed -- what it re-pushes when it refuses a rise. */
      deadSnapshot: ServerRunSnapshot;
    }> {
      const { socket, connectPromise } = harness();
      const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode });
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
      const deadSnapshot = snapshotOf(dead);
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: deadSnapshot });
      return { session: await connectPromise, socket, deadSnapshot };
    }

    it('sends rise-again and adopts the pushed snapshot', async () => {
      const { session, socket } = await sessionAtDeath('wanderer');

      expect(session.riseAgain()).toBe(true);
      expect(socket().sentMessages.at(-1)).toMatchObject({
        type: 'rise-again',
        commandId: expect.any(String),
      });

      // The authoritative answer is the ordinary `state` push, which the message handler adopts
      // like any other -- the rewind lowers the revision, and the client re-syncs to it.
      const restored = createNewRun({
        pack,
        seed: SEED,
        hero: DEFAULT_GUEST_HERO,
        mode: 'wanderer',
      });
      socket().emit({ type: 'state', snapshot: snapshotOf(restored) });
      expect(session.getSnapshot().conclusion).toBeNull();
    });

    it('says the death stands when the server refuses the rise', async () => {
      const { session, socket, deadSnapshot } = await sessionAtDeath('wanderer');
      const before = session.getSnapshot().log.length;

      expect(session.riseAgain()).toBe(true);
      // The server found no usable checkpoint, so it re-pushes the same concluded snapshot. Without
      // a line here the profile's refusal is silent, unlike the guest's.
      socket().emit({ type: 'state', snapshot: deadSnapshot });

      const log = session.getSnapshot().log;
      expect(log.length).toBe(before + 1);
      expect(log.at(-1)?.text).toBe('The Deep offers no way back. This death stands.');
    });

    it('says nothing when the rise succeeds', async () => {
      const { session, socket } = await sessionAtDeath('wanderer');
      expect(session.riseAgain()).toBe(true);

      socket().emit({
        type: 'state',
        snapshot: snapshotOf(
          createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' }),
        ),
      });

      expect(session.getSnapshot().log).toEqual([]);
      expect(session.getSnapshot().conclusion).toBeNull();
    });

    it('does not send rise-again for a classic run', async () => {
      const { session, socket } = await sessionAtDeath('classic');

      expect(session.riseAgain()).toBe(false);
      expect(socket().sentMessages).toEqual([]);
    });

    it('does not send rise-again for a non-death conclusion', async () => {
      const { socket, connectPromise } = harness();
      const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' });
      const won: ActiveRun = {
        ...fresh,
        conclusion: {
          completionType: 'broke-cycle',
          cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
          concludedAtRevision: fresh.revision,
          finalized: false,
        },
      };
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(won) });
      const session = await connectPromise;

      // A victory is the run's real ending -- rising is a death's prerogative alone.
      expect(session.riseAgain()).toBe(false);
      expect(socket().sentMessages).toEqual([]);
    });

    it('does not send rise-again for a run still in progress', async () => {
      const { socket, connectPromise } = harness();
      socket().emit(HELLO);
      socket().emit({
        type: 'state',
        snapshot: snapshotOf(
          createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' }),
        ),
      });
      const session = await connectPromise;

      expect(session.riseAgain()).toBe(false);
      expect(socket().sentMessages).toEqual([]);
    });

    it('tells the server when a wanderer death is accepted', async () => {
      const { session, socket } = await sessionAtDeath('wanderer');

      session.finalizeConcludedRun({} as never, {} as never);

      expect(socket().sentMessages.at(-1)).toMatchObject({ type: 'accept-death' });
    });

    it('sends nothing extra when a classic death is finalized', async () => {
      const { session, socket } = await sessionAtDeath('classic');

      session.finalizeConcludedRun({} as never, {} as never);

      expect(socket().sentMessages).toEqual([]);
    });

    it('sends nothing when a wanderer VICTORY is finalized', async () => {
      const { socket, connectPromise } = harness();
      const fresh = createNewRun({
        pack,
        seed: SEED,
        hero: DEFAULT_GUEST_HERO,
        mode: 'wanderer',
      });
      const won: ActiveRun = {
        ...fresh,
        conclusion: {
          completionType: 'broke-cycle',
          cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
          concludedAtRevision: fresh.revision,
          finalized: false,
        },
      };
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(won) });
      const session = await connectPromise;

      session.finalizeConcludedRun({} as never, {} as never);

      // The server clears a Wanderer victory the moment it happens -- there is nothing to accept.
      expect(socket().sentMessages).toEqual([]);
    });
  });

  describe('revealLore (Task 3, dialogue reveal-lore consequence)', () => {
    it('inserts the content id into sightings and appends exactly one reveal line, and is idempotent on a repeat reveal', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run) });
      const session = await connectPromise;

      let notified = 0;
      session.subscribe(() => {
        notified += 1;
      });

      session.revealLore('monster.cave-rat');

      expect(session.getSnapshot().sightings.monsterIds).toContain('monster.cave-rat');
      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Cave rat.'),
      ).toHaveLength(1);
      expect(notified).toBe(1);

      session.revealLore('monster.cave-rat');

      expect(
        session
          .getSnapshot()
          .log.filter((line) => line.text === 'The threads whisper of Cave rat.'),
      ).toHaveLength(1);
      expect(notified).toBe(1);
    });
  });

  describe('noteSystemLine (auto-explore stop reports)', () => {
    it('appends a system-tone line, notifies subscribers, and leaves lastEvents alone', async () => {
      const { socket, connectPromise } = harness();
      const run = freshRun();
      const events: readonly PublicEvent[] = [
        { type: 'hero.waited', eventId: 'e1', heroId: 'hero.guest', x: 5, y: 9 } as PublicEvent,
      ];
      socket().emit(HELLO);
      socket().emit({ type: 'state', snapshot: snapshotOf(run, { lastEvents: events }) });
      const session = await connectPromise;

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
});
