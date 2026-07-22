import { randomFillSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION, type Uint32State } from '@woven-deep/engine';
import type { AuthBundle } from './auth.js';
import { requireSession } from '../auth/http-guards.js';
import type { ActiveRunRepository } from '../db/active-run-repository.js';
import {
  ContentHashMismatchError,
  ServerPlaySession,
  type ApplyOutcome,
} from '../play/play-session.js';
import { parseClientMessage, PROTOCOL_VERSION, type ServerMessage } from '../ws-protocol.js';

/** A minimal shape of what `@fastify/websocket` hands the route handler — just enough of `ws`'s
 * `WebSocket` for this module to send/receive/close without depending on `@types/ws` here. */
export interface PlaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
}

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
 * Registers `GET /ws/play`: authenticates the upgrade with the same `wd_session` cookie
 * `requireSession` uses for the HTTP profile routes (rejecting an unauthenticated upgrade before
 * the socket is ever established), opens a `ServerPlaySession` for the profile with a
 * SERVER-generated seed, sends `hello` + the initial `state`, and routes every subsequent message
 * through {@link handleMessage}. Flushes the session's pending checkpoint on close so a dropped
 * connection never loses an unwritten movement checkpoint. Newest-wins eviction and reconnection
 * are Task 7 — this drives exactly one connection per profile end-to-end.
 */
export function registerWsPlayRoute(
  app: FastifyInstance,
  input: Readonly<{ auth: AuthBundle; pack: CompiledContentPack; repo: ActiveRunRepository }>,
): void {
  const { auth, pack, repo } = input;

  app.get(
    '/ws/play',
    { websocket: true, preValidation: requireSession(auth.session) },
    (socket: PlaySocket, request) => {
      const profileId = request.profileId;
      if (!profileId) {
        // requireSession already replied 401 and the upgrade never completes in that case; this
        // guards the type only.
        socket.close(1008, 'unauthenticated');
        return;
      }

      const session = new ServerPlaySession({ pack, repo, profileId });

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
      });

      try {
        const snapshot = session.open({ seed: generateSeed() });
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
