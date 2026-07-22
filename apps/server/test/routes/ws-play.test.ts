import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { Uint32State } from '@woven-deep/engine';
import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/database.js';
import { LoginTokenRepository } from '../../src/db/login-token-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { createAuthBundle } from '../../src/auth/bundle.js';
import { generateToken, hashToken } from '../../src/auth/tokens.js';
import type { AuthConfig } from '../../src/config.js';
import { ServerPlaySession } from '../../src/play/play-session.js';
import { handleMessage } from '../../src/routes/ws-play.js';
import type { ServerMessage } from '../../src/ws-protocol.js';

const PUBLIC_URL = 'http://localhost:3000';
const SEED = [7, 14, 21, 28] as unknown as Uint32State;
const FIXED_CLOCK = () => '2026-07-22T00:00:00.000Z';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
});

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

function makeConfig(): AuthConfig {
  return {
    publicUrl: PUBLIC_URL,
    cookieSecret: 'test-cookie-secret-that-is-long-enough-32',
    cookieSecure: false,
    mailgun: null,
    loginRateLimit: { perEmailPerHour: 5, perSourcePerHour: 20 },
  };
}

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

/**
 * A minimal shape of the `ws` client `injectWS` returns — just enough to drive it from tests.
 */
interface WsLike {
  on(event: 'message', listener: (data: Buffer) => void): void;
}

/**
 * Buffers incoming `message` events into a queue and hands them out one at a time via `next()`.
 * A naive `ws.once('message', ...)` per awaited message is unsafe here: `@fastify/websocket`'s
 * `injectWS` test harness can deliver several frames written back-to-back (as `hello` + the
 * initial `state` are) inside a single synchronous flush, so a *second* `.once` registered only
 * after `await`-ing the first has already missed the second event by the time it attaches. This
 * queue never misses a message regardless of how the underlying transport batches them.
 */
function messageQueue(ws: WsLike): () => Promise<ServerMessage> {
  const messages: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data: Buffer) => {
    messages.push(JSON.parse(data.toString('utf8')) as ServerMessage);
    for (const waiter of waiters.splice(0)) waiter();
  });
  return async function next(): Promise<ServerMessage> {
    while (messages.length === 0) {
      await new Promise<void>((resolveWaiter) => waiters.push(resolveWaiter));
    }
    return messages.shift()!;
  };
}

async function verifyAndGetCookies(
  app: FastifyInstance,
  database: Database.Database,
  email: string,
): Promise<string[]> {
  const rawToken = generateToken();
  const tokens = new LoginTokenRepository(database);
  const now = new Date();
  tokens.insert({
    tokenHash: hashToken(rawToken),
    normalizedEmail: email,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/verify?token=${encodeURIComponent(rawToken)}`,
  });
  const setCookie = response.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie : [String(setCookie)];
}

describe('handleMessage (pure message routing)', () => {
  let session: ServerPlaySession;

  beforeEach(() => {
    const database = freshDatabase();
    new ProfileRepository(database).create({
      id: 'profile-1',
      normalizedEmail: 'profile-1@example.com',
      nowIso: FIXED_CLOCK(),
    });
    const repo = new ActiveRunRepository(database);
    session = new ServerPlaySession({ pack, repo, profileId: 'profile-1', clock: FIXED_CLOCK });
    session.open({ seed: SEED });
  });

  function waitMessage(commandId: string, expectedRevision: number): string {
    return JSON.stringify({
      type: 'command',
      commandId,
      expectedRevision,
      intent: { type: 'wait' },
    });
  }

  it('applies a command and returns state with an advanced revision', () => {
    const before = session.getSnapshot().revision;
    const [message] = handleMessage(session, waitMessage('cmd-1', before));
    expect(message.type).toBe('state');
    if (message.type === 'state') {
      expect(message.snapshot.revision).toBeGreaterThan(before);
    }
  });

  it('rejects a stale-revision command without mutating the run', () => {
    const before = session.getSnapshot().revision;
    handleMessage(session, waitMessage('cmd-1', before));
    const afterFirst = session.getSnapshot().revision;

    const [message] = handleMessage(session, waitMessage('cmd-2', before));
    expect(message.type).toBe('rejected');
    expect(session.getSnapshot().revision).toBe(afterFirst);
  });

  it('returns an error for a malformed message and leaves the session untouched', () => {
    const before = session.getSnapshot();
    const [message] = handleMessage(session, 'not json');
    expect(message).toEqual<ServerMessage>({
      type: 'error',
      code: 'malformed-message',
      message: 'invalid JSON',
    });
    expect(session.getSnapshot()).toEqual(before);
  });

  it('returns an error for an unknown message type', () => {
    const [message] = handleMessage(session, JSON.stringify({ type: 'nonsense' }));
    expect(message.type).toBe('error');
  });

  it('returns an error for a command with a malformed intent (bad direction)', () => {
    const before = session.getSnapshot();
    const [message] = handleMessage(
      session,
      JSON.stringify({
        type: 'command',
        commandId: 'cmd-1',
        expectedRevision: before.revision,
        intent: { type: 'move', direction: 'up-and-to-the-left' },
      }),
    );
    expect(message.type).toBe('error');
    expect(session.getSnapshot()).toEqual(before);
  });

  it('declines a pending decision without applying an engine command', () => {
    const [message] = handleMessage(
      session,
      JSON.stringify({
        type: 'answer-decision',
        commandId: 'cmd-1',
        expectedRevision: session.getSnapshot().revision,
        confirmed: false,
      }),
    );
    expect(message.type).toBe('state');
  });

  it('errors on answer-decision when there is no pending decision', () => {
    const [message] = handleMessage(
      session,
      JSON.stringify({
        type: 'answer-decision',
        commandId: 'cmd-1',
        expectedRevision: session.getSnapshot().revision,
        confirmed: true,
      }),
    );
    expect(message).toEqual<ServerMessage>({
      type: 'error',
      code: 'no-pending-decision',
      message: 'No decision is pending.',
    });
  });
});

describe('/ws/play connection', () => {
  let app: FastifyInstance;
  let database: Database.Database;

  beforeEach(() => {
    database = freshDatabase();
    const bundle = createAuthBundle({ db: database, config: makeConfig() });
    app = buildApp({ pack, auth: bundle, database });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unauthenticated upgrade', async () => {
    await app.ready();
    // A correct Origin is supplied so this exercises the SESSION guard specifically (a request
    // with no Origin at all is covered by the CSWSH tests below, which would otherwise reject
    // for the wrong reason first).
    await expect(app.injectWS('/ws/play', { headers: { origin: PUBLIC_URL } })).rejects.toThrow(
      /401/,
    );
  });

  it('rejects an upgrade with a mismatched Origin (CSWSH protection)', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-cswsh@example.com');
    await expect(
      app.injectWS('/ws/play', {
        headers: {
          cookie: cookieHeader(sessionCookies),
          origin: 'https://evil.example.com',
        },
      }),
    ).rejects.toThrow(/403/);
  });

  it('rejects an upgrade with no Origin header at all', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-no-origin@example.com');
    await expect(
      app.injectWS('/ws/play', { headers: { cookie: cookieHeader(sessionCookies) } }),
    ).rejects.toThrow(/403/);
  });

  it('authenticated connect receives hello then the initial state, and a command advances the revision', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-player@example.com');

    const ws = await app.injectWS('/ws/play', {
      headers: { cookie: cookieHeader(sessionCookies), origin: PUBLIC_URL },
    });
    try {
      const nextMessage = messageQueue(ws);

      const hello = await nextMessage();
      expect(hello.type).toBe('hello');

      const initialState = await nextMessage();
      expect(initialState.type).toBe('state');
      const revisionBefore = initialState.type === 'state' ? initialState.snapshot.revision : -1;

      ws.send(
        JSON.stringify({
          type: 'command',
          commandId: 'cmd-1',
          expectedRevision: revisionBefore,
          intent: { type: 'wait' },
        }),
      );
      const afterCommand = await nextMessage();
      expect(afterCommand.type).toBe('state');
      if (afterCommand.type === 'state') {
        expect(afterCommand.snapshot.revision).toBeGreaterThan(revisionBefore);
      }
    } finally {
      ws.terminate();
    }
  });

  it('a malformed message returns an error and the connection stays open', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-malformed@example.com');

    const ws = await app.injectWS('/ws/play', {
      headers: { cookie: cookieHeader(sessionCookies), origin: PUBLIC_URL },
    });
    try {
      const nextMessage = messageQueue(ws);

      await nextMessage(); // hello
      const initialState = await nextMessage();
      const revisionBefore = initialState.type === 'state' ? initialState.snapshot.revision : -1;

      ws.send('not json');
      const errorMessage = await nextMessage();
      expect(errorMessage.type).toBe('error');
      expect(ws.readyState).toBe(ws.OPEN);

      // Connection survives: a well-formed command afterwards still gets a state reply.
      ws.send(
        JSON.stringify({
          type: 'command',
          commandId: 'cmd-1',
          expectedRevision: revisionBefore,
          intent: { type: 'wait' },
        }),
      );
      const afterCommand = await nextMessage();
      expect(afterCommand.type).toBe('state');
    } finally {
      ws.terminate();
    }
  });

  it('a second connection for the same profile supersedes the first (newest-wins eviction)', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-evict@example.com');
    const connectHeaders = { cookie: cookieHeader(sessionCookies), origin: PUBLIC_URL };

    const first = await app.injectWS('/ws/play', { headers: connectHeaders });
    const firstMessages = messageQueue(first);
    await firstMessages(); // hello
    await firstMessages(); // initial state

    const closed = new Promise<void>((resolveClosed) => first.on('close', () => resolveClosed()));

    const second = await app.injectWS('/ws/play', { headers: connectHeaders });
    try {
      const secondMessages = messageQueue(second);
      await secondMessages(); // hello
      const secondInitialState = await secondMessages(); // initial state (same run, reused session)
      const revisionBefore =
        secondInitialState.type === 'state' ? secondInitialState.snapshot.revision : -1;

      const superseded = await firstMessages();
      expect(superseded).toEqual({ type: 'superseded' });
      await closed;
      expect(first.readyState).toBe(first.CLOSED);

      // The second connection is live and controls the run.
      expect(second.readyState).toBe(second.OPEN);
      second.send(
        JSON.stringify({
          type: 'command',
          commandId: 'evict-cmd-1',
          expectedRevision: revisionBefore,
          intent: { type: 'wait' },
        }),
      );
      const reply = await secondMessages();
      expect(reply.type).toBe('state');
      if (reply.type === 'state') {
        expect(reply.snapshot.revision).toBeGreaterThan(revisionBefore);
      }
      expect(second.readyState).toBe(second.OPEN);
    } finally {
      second.terminate();
    }
  });

  it('a reconnect after a drop rehydrates the same run, and a resent commandId does not double-apply', async () => {
    await app.ready();
    const sessionCookies = await verifyAndGetCookies(app, database, 'ws-reconnect@example.com');
    const connectHeaders = { cookie: cookieHeader(sessionCookies), origin: PUBLIC_URL };

    const first = await app.injectWS('/ws/play', { headers: connectHeaders });
    const firstMessages = messageQueue(first);
    await firstMessages(); // hello
    const initialState = await firstMessages();
    const revisionBefore = initialState.type === 'state' ? initialState.snapshot.revision : -1;

    first.send(
      JSON.stringify({
        type: 'command',
        commandId: 'reconnect-cmd-1',
        expectedRevision: revisionBefore,
        intent: { type: 'wait' },
      }),
    );
    const applied = await firstMessages();
    expect(applied.type).toBe('state');
    const revisionAfterCommand = applied.type === 'state' ? applied.snapshot.revision : -1;
    expect(revisionAfterCommand).toBeGreaterThan(revisionBefore);

    const closed = new Promise<void>((resolveClosed) => first.on('close', () => resolveClosed()));
    first.close();
    await closed;

    // Reconnect: the previous connection is fully gone, so this opens a fresh session that
    // rehydrates from the persisted (flushed-on-close) run.
    const second = await app.injectWS('/ws/play', { headers: connectHeaders });
    try {
      const secondMessages = messageQueue(second);
      await secondMessages(); // hello
      const rehydratedState = await secondMessages();
      expect(rehydratedState.type).toBe('state');
      const rehydratedRevision =
        rehydratedState.type === 'state' ? rehydratedState.snapshot.revision : -1;
      expect(rehydratedRevision).toBe(revisionAfterCommand);

      // Resending the SAME commandId (as if the client never saw the original reply) must not
      // double-apply: the engine's commandId dedup returns the cached result.
      second.send(
        JSON.stringify({
          type: 'command',
          commandId: 'reconnect-cmd-1',
          expectedRevision: revisionBefore,
          intent: { type: 'wait' },
        }),
      );
      const resentReply = await secondMessages();
      expect(resentReply.type).toBe('state');
      if (resentReply.type === 'state') {
        expect(resentReply.snapshot.revision).toBe(revisionAfterCommand);
      }
    } finally {
      second.terminate();
    }
  });
});
