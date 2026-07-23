import { randomFillSync } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION, type Uint32State } from '@woven-deep/engine';
import type { AuthBundle } from './auth.js';
import { requireOrigin, requireSession } from '../auth/http-guards.js';
import type { ActiveRunRepository } from '../db/active-run-repository.js';
import { ServerRunRecordRepository } from '../db/hall-repository.js';
import { ConnectionRegistry } from '../play/connection-registry.js';
import type { PlaySocket } from '../play/play-socket.js';
import {
  ContentHashMismatchError,
  ServerPlaySession,
  type ApplyOutcome,
} from '../play/play-session.js';
import { parseClientMessage, PROTOCOL_VERSION, type ServerMessage } from '../ws-protocol.js';

export type { PlaySocket } from '../play/play-socket.js';

/** Generates the server-owned run seed. Never trusts a client-supplied seed (there is no wire path
 * for one) — retries the astronomically unlikely all-zero draw, which `createNewRun` rejects. */
function generateSeed(): Uint32State {
  for (;;) {
    const words = new Uint32Array(4);
    randomFillSync(words);
    if (words.some((word) => word !== 0)) {
      return [words[0], words[1], words[2], words[3]] as unknown as Uint32State;
    }
  }
}

function send(socket: PlaySocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function outcomeToMessage(outcome: ApplyOutcome): ServerMessage {
  if (outcome.kind === 'state') return { type: 'state', snapshot: outcome.snapshot };
  if (outcome.kind === 'decision-required') {
    return { type: 'decision-required', decision: outcome.decision, snapshot: outcome.snapshot };
  }
  return { type: 'rejected', reason: outcome.reason, snapshot: outcome.snapshot };
}

/**
 * Handles one raw incoming WS payload against the given session, returning the outgoing message(s)
 * to send back. Deliberately pure (no socket) — this is the unit-testable core of `/ws/play`'s
 * message routing; the route handler is a thin adapter that calls this and writes to the socket.
 * A malformed payload never throws: it maps to a single `error` message, and the connection (and
 * the session's state) is left exactly as it was.
 */
export function handleMessage(session: ServerPlaySession, raw: unknown): readonly ServerMessage[] {
  const parsed = parseClientMessage(raw);
  if (!parsed.ok) {
    return [{ type: 'error', code: 'malformed-message', message: parsed.reason }];
  }
  const message = parsed.value;

  if (message.type === 'command') {
    return [
      outcomeToMessage(
        session.applyIntent({
          commandId: message.commandId,
          expectedRevision: message.expectedRevision,
          intent: message.intent,
        }),
      ),
    ];
  }

  if (message.type === 'answer-decision') {
    if (!message.confirmed) {
      return [outcomeToMessage(session.declineDecision())];
    }
    const pending = session.getSnapshot().pendingDecision;
    if (!pending) {
      return [{ type: 'error', code: 'no-pending-decision', message: 'No decision is pending.' }];
    }
    return [
      outcomeToMessage(
        session.applyCommand({
          type: 'attack',
          targetActorId: pending.targetActorId,
          commandId: message.commandId,
          expectedRevision: message.expectedRevision,
        }),
      ),
    ];
  }

  // message.type === 'final-chamber-choice'
  return [
    outcomeToMessage(
      session.applyCommand({
        type: 'final-chamber-choice',
        choice: message.choice,
        commandId: message.commandId,
        expectedRevision: message.expectedRevision,
      }),
    ),
  ];
}

/**
 * Registers `GET /ws/play`: authenticates the upgrade with the same origin check + `wd_session`
 * cookie the HTTP mutation routes use (rejecting a cross-site or unauthenticated upgrade before
 * the socket is ever established — a WS upgrade auto-sends cookies regardless of origin, so
 * `requireOrigin` is required here even though there is no browser-enforced CORS for WebSockets),
 * opens or reuses a `ServerPlaySession` for the profile, sends `hello` + the initial `state`, and
 * routes every subsequent message through {@link handleMessage}.
 *
 * Newest-wins eviction + reconnection (Task 7): a `ConnectionRegistry` (one per route
 * registration, i.e. one per running server) tracks at most one live connection per profile.
 *
 * - A SECOND connection for a profile that already has one live reuses that SAME in-memory
 *   `ServerPlaySession` object (skipping `open()` — which would re-decode a possibly-stale
 *   persisted blob and lose any unflushed checkpoint moves) and hands it to the new socket; the
 *   registry evicts the old socket (`superseded` + close) as part of registering the new one.
 * - A RECONNECT (the profile's previous connection already fully closed, so the registry has no
 *   entry for it) opens a fresh `ServerPlaySession`, which rehydrates from `active_runs` — the
 *   prior connection's `close` handler flushed its pending checkpoint before dropping, so the
 *   fresh `open()` always sees the latest state. This "flush on close, rehydrate from the
 *   in-memory holder when live / from SQLite otherwise" is the simplest approach that never loses
 *   or double-holds a run, so it's what's implemented (no separate out-of-band holder needed: the
 *   registry itself IS the in-memory holder).
 *
 * `unregister` is identity-guarded (see `connection-registry.ts`), so the evicted socket's own
 * (later) `close` event can never accidentally remove the new connection's registry entry.
 */
export function registerWsPlayRoute(
  app: FastifyInstance,
  input: Readonly<{
    auth: AuthBundle;
    pack: CompiledContentPack;
    repo: ActiveRunRepository;
    database: Database.Database;
  }>,
): void {
  const { auth, pack, repo, database } = input;
  const registry = new ConnectionRegistry();

  app.get(
    '/ws/play',
    {
      websocket: true,
      preValidation: [requireOrigin(auth.config.publicUrl), requireSession(auth.session)],
    },
    (socket: PlaySocket, request) => {
      const profileId = request.profileId;
      if (!profileId) {
        // requireSession already replied 401 and the upgrade never completes in that case; this
        // guards the type only.
        socket.close(1008, 'unauthenticated');
        return;
      }

      const existing = registry.get(profileId);
      const session =
        existing?.session ??
        new ServerPlaySession({
          pack,
          repo,
          profileId,
          hallRepo: new ServerRunRecordRepository({ database, profileId }),
        });

      // Attach handlers synchronously before any work runs (session.open below is synchronous
      // too, so there's no async gap for a message to slip through unhandled, but this is the
      // shape @fastify/websocket's own docs recommend to stay safe against future async additions
      // here).
      socket.on('message', (raw) => {
        for (const message of handleMessage(session, raw)) {
          send(socket, message);
        }
      });
      socket.on('close', () => {
        session.flush();
        registry.unregister(profileId, socket);
      });

      try {
        // Reusing an already-open (still-live-elsewhere) session skips `open()` entirely — it's
        // already rehydrated/created, and re-opening would clobber its in-memory state.
        const snapshot =
          existing !== undefined ? session.getSnapshot() : session.open({ seed: generateSeed() });
        registry.register(profileId, socket, session);
        // Deferred one tick: sending in the exact same synchronous tick as the handshake is safe
        // over a real socket (the client's WebSocket parser handles trailing bytes after the
        // upgrade response correctly), but @fastify/websocket's `injectWS` test harness sniffs the
        // "101 Switching Protocols" handshake out of the raw stream with a `.includes()` check and
        // silently drops anything already coalesced into the same chunk — so a synchronous send
        // here is invisible to it. Deferring costs nothing in production and keeps the endpoint
        // testable through the harness the test suite uses.
        setImmediate(() => {
          send(socket, {
            type: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            contentHash: pack.hash,
            gameVersion: ENGINE_GAME_VERSION,
            saveSchemaVersion: SAVE_SCHEMA_VERSION,
          });
          send(socket, { type: 'state', snapshot });
        });
      } catch (error) {
        if (error instanceof ContentHashMismatchError) {
          send(socket, { type: 'error', code: 'content-mismatch', message: error.message });
          socket.close(1008, 'content-mismatch');
          return;
        }
        throw error;
      }
    },
  );
}
