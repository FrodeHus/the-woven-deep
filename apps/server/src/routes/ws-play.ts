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
  LockedClassError,
  ServerPlaySession,
  type ApplyOutcome,
} from '../play/play-session.js';
import {
  isResyncRequest,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '../ws-protocol.js';
import { FloorWireEncoder, type WireServerMessage } from '@woven-deep/session-core';

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

/** Writes a message in its wire form: the three snapshot-carrying variants have their cell array
 * replaced by a full-minus-unknowns list or a patch against what this connection last sent (see
 * `floor-wire.ts`). Every connection owns its own encoder, so a reconnect necessarily begins with
 * a full sync. */
function send(socket: PlaySocket, encoder: FloorWireEncoder, message: ServerMessage): void {
  const wire: WireServerMessage =
    'snapshot' in message ? { ...message, snapshot: encoder.encode(message.snapshot) } : message;
  socket.send(JSON.stringify(wire));
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
  if (parsed.value.type === 'start-run') {
    try {
      return [
        {
          type: 'state',
          snapshot: session.startRun({
            choices: parsed.value.choices,
            mode: parsed.value.mode,
            seed: generateSeed(),
          }),
        },
      ];
    } catch (error) {
      if (error instanceof LockedClassError) {
        return [{ type: 'error', code: 'locked-class', message: error.message }];
      }
      // heroFromChoices' own validation: unknown ids, an illegal point-buy, a bad name. The
      // connection survives so the wizard can correct and resend.
      return [
        {
          type: 'error',
          code: 'invalid-choices',
          message: error instanceof Error ? error.message : 'hero choices were rejected',
        },
      ];
    }
  }
  // Every other message drives an existing run; a client that skipped `start-run` (or raced the
  // `no-run` push) gets a re-prompt instead of a crash against a session with no run.
  if (!session.hasRun()) {
    return [{ type: 'no-run' }];
  }
  return handleRunMessage(session, parsed.value);
}

function handleRunMessage(
  session: ServerPlaySession,
  message: Exclude<ClientMessage, { type: 'start-run' }>,
): readonly ServerMessage[] {
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

  // Neither of these enforces `expectedRevision`: the rewind target is the STORED checkpoint, not
  // whatever revision the client last saw, and `conclusion !== null` is the real precondition --
  // enforcing staleness here would strand a client whose reply was lost with a run it can neither
  // rise from nor end.
  if (message.type === 'rise-again') {
    return [outcomeToMessage(session.riseAgain())];
  }

  if (message.type === 'accept-death') {
    return [outcomeToMessage(session.acceptDeath())];
  }

  if (message.type === 'travel') {
    const applied = session.applyTravel({
      commandId: message.commandId,
      expectedRevision: message.expectedRevision,
      request: {
        mode: message.mode,
        steps: message.steps,
        onArrive: message.onArrive,
        autoPickup: message.autoPickup,
        offeredItemIds: message.offeredItemIds,
      },
    });
    // One ordinary `state` per applied step, so the client renders and animates each turn exactly
    // as it does a single dispatched move -- no new snapshot machinery, and the floor patches
    // chain naturally because the connection's encoder sees them in order. `travel-ended` closes
    // the batch and says whether the walk is finished or merely capped.
    return [
      ...applied.snapshots.map((snapshot): ServerMessage => ({ type: 'state', snapshot })),
      {
        type: 'travel-ended',
        reason: applied.reason,
        stepsTaken: applied.stepsTaken,
        offeredItemIds: applied.offeredItemIds,
      },
    ];
  }

  // The client could not apply a patch and needs the floor whole. Nothing is applied to the run --
  // the current snapshot is simply re-sent, and the route has already cleared the encoder's cache
  // (see `isResyncRequest`) so it encodes as a full sync.
  if (message.type === 'resync') {
    return [{ type: 'state', snapshot: session.getSnapshot() }];
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
          database,
          hallRepo: new ServerRunRecordRepository({ database, profileId }),
        });

      // Attach handlers synchronously before any work runs (session.open below is synchronous
      // too, so there's no async gap for a message to slip through unhandled, but this is the
      // shape @fastify/websocket's own docs recommend to stay safe against future async additions
      // here).
      const encoder = new FloorWireEncoder();
      socket.on('message', (raw) => {
        // Cleared BEFORE the reply is built, so the re-sent snapshot encodes as a full sync rather
        // than as another patch against the cache the client just told us it cannot use.
        if (isResyncRequest(raw)) encoder.reset();
        for (const message of handleMessage(session, raw)) {
          send(socket, encoder, message);
        }
      });
      socket.on('close', () => {
        session.flush();
        registry.unregister(profileId, socket);
      });

      try {
        // Reusing an already-open (still-live-elsewhere) session skips `open()` entirely — it's
        // already rehydrated/created, and re-opening would clobber its in-memory state.
        // A profile with NO stored run gets `no-run` instead of a server-invented default hero:
        // the client answers with `start-run` carrying its chargen choices. A stored run (or a
        // still-live in-memory session) rehydrates/reuses exactly as before.
        const snapshot =
          existing !== undefined
            ? existing.session.hasRun()
              ? session.getSnapshot()
              : null
            : repo.get(profileId) !== undefined
              ? session.open({ seed: generateSeed() })
              : null;
        registry.register(profileId, socket, session);
        // Deferred one tick: sending in the exact same synchronous tick as the handshake is safe
        // over a real socket (the client's WebSocket parser handles trailing bytes after the
        // upgrade response correctly), but @fastify/websocket's `injectWS` test harness sniffs the
        // "101 Switching Protocols" handshake out of the raw stream with a `.includes()` check and
        // silently drops anything already coalesced into the same chunk — so a synchronous send
        // here is invisible to it. Deferring costs nothing in production and keeps the endpoint
        // testable through the harness the test suite uses.
        setImmediate(() => {
          send(socket, encoder, {
            type: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            contentHash: pack.hash,
            gameVersion: ENGINE_GAME_VERSION,
            saveSchemaVersion: SAVE_SCHEMA_VERSION,
          });
          send(
            socket,
            encoder,
            snapshot !== null ? { type: 'state', snapshot } : { type: 'no-run' },
          );
        });
      } catch (error) {
        if (error instanceof ContentHashMismatchError) {
          send(socket, encoder, {
            type: 'error',
            code: 'content-mismatch',
            message: error.message,
          });
          socket.close(1008, 'content-mismatch');
          return;
        }
        if (error instanceof LockedClassError) {
          send(socket, encoder, { type: 'error', code: 'locked-class', message: error.message });
          socket.close(1008, 'locked-class');
          return;
        }
        throw error;
      }
    },
  );
}
