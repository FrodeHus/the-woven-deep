import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
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
  overrides: Partial<Pick<ServerRunSnapshot, 'lastEvents' | 'pendingDecision' | 'houseOpen'>> = {},
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
}

function harness(): Harness {
  const sockets: FakeSocket[] = [];
  const connectPromise = ProfileSession.connect({
    pack,
    url: 'ws://test/ws/play',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { sockets, socket: () => sockets[sockets.length - 1]!, connectPromise };
}

const HELLO: ServerMessage = {
  type: 'hello',
  protocolVersion: 1,
  contentHash: 'test-hash',
  gameVersion: 'test-version',
  saveSchemaVersion: 1,
};

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

  it('finalizeConcludedRun stub returns the server-projected conclusion without writing a repository', async () => {
    const { socket, connectPromise } = harness();
    const run = freshRun();
    socket().emit(HELLO);
    socket().emit({ type: 'state', snapshot: snapshotOf(run) });
    const session = await connectPromise;

    expect(() => session.finalizeConcludedRun({} as never, {} as never)).toThrow(
      /requires a concluded run/,
    );
  });
});
