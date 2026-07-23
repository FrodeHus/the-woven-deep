import { MERCHANT_SERVICE_IDS, type MerchantServiceId } from '@woven-deep/content';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlayerIntent,
  type ServerMessage,
} from '@woven-deep/session-core';

/** The protocol types + `PROTOCOL_VERSION` now live in `@woven-deep/session-core` (shared with
 * `apps/web`) -- re-exported here so existing local importers keep working unchanged. */
export { PROTOCOL_VERSION };
export type { ClientMessage, ServerMessage };

const DIRECTIONS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

const BACKPACK_ACTIONS = ['equip', 'unequip', 'use', 'drop', 'toggle-light'] as const;
const HOUSE_TRANSFER_ACTIONS = ['deposit', 'withdraw'] as const;
const FINAL_CHAMBER_CHOICES = ['become-heart', 'turn-away', 'break-cycle'] as const;

export type ParsedClientMessage =
  | { readonly ok: true; readonly value: ClientMessage }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/**
 * Validates the `intent` payload of a `command` message down to each `PlayerIntent` variant's
 * required fields — deliberately more than a shallow `typeof` check. `resolveCommand`/the command
 * builder trust their `PlayerIntent` input's shape (they're only ever called with values the guest
 * itself constructed); over the wire a client is untrusted, and at least one field
 * (`move.direction`) is used as a direct object-key lookup in the engine (`DIRECTION_DELTAS`) that
 * throws on an unrecognised string, so malformed intents must be rejected here rather than let
 * through to crash the connection.
 */
function validateIntent(value: unknown): value is PlayerIntent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'move':
      return isOneOf(value.direction, DIRECTIONS);
    case 'wait':
    case 'rest':
    case 'pickup':
    case 'descend':
    case 'ascend':
    case 'pick-lock':
    case 'house':
    case 'trade-open':
    case 'trade-close':
      return true;
    case 'house-transfer':
      return (
        isOneOf(value.action, HOUSE_TRANSFER_ACTIONS) &&
        typeof value.itemId === 'string' &&
        typeof value.quantity === 'number'
      );
    case 'backpack':
      return isOneOf(value.action, BACKPACK_ACTIONS) && typeof value.itemId === 'string';
    case 'refuel':
      return typeof value.fuelItemId === 'string' && typeof value.targetItemId === 'string';
    case 'trade-buy':
    case 'trade-sell':
      return typeof value.itemId === 'string' && typeof value.quantity === 'number';
    case 'trade-service':
      return (
        isOneOf(value.serviceId, MERCHANT_SERVICE_IDS as readonly MerchantServiceId[]) &&
        (value.targetItemId === null || typeof value.targetItemId === 'string')
      );
    case 'cast':
      return (
        typeof value.spellId === 'string' &&
        isRecord(value.target) &&
        typeof value.target.x === 'number' &&
        typeof value.target.y === 'number'
      );
    default:
      return false;
  }
}

/**
 * Parses + validates a raw incoming WS payload against the client→server protocol. Never throws —
 * a malformed payload (bad JSON, unknown `type`, missing/mistyped fields) yields `ok: false` so the
 * caller can reply with `{type:'error'}` and keep the connection alive.
 */
export function parseClientMessage(raw: unknown): ParsedClientMessage {
  let parsed: unknown;
  try {
    parsed =
      typeof raw === 'string' || Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw;
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return { ok: false, reason: 'missing message type' };
  }
  if (typeof parsed.commandId !== 'string' || typeof parsed.expectedRevision !== 'number') {
    return { ok: false, reason: 'missing commandId/expectedRevision' };
  }

  if (parsed.type === 'command') {
    if (!validateIntent(parsed.intent)) return { ok: false, reason: 'malformed intent' };
    return {
      ok: true,
      value: {
        type: 'command',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
        intent: parsed.intent,
      },
    };
  }
  if (parsed.type === 'answer-decision') {
    if (typeof parsed.confirmed !== 'boolean') {
      return { ok: false, reason: 'malformed answer-decision' };
    }
    return {
      ok: true,
      value: {
        type: 'answer-decision',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
        confirmed: parsed.confirmed,
      },
    };
  }
  if (parsed.type === 'final-chamber-choice') {
    if (!isOneOf(parsed.choice, FINAL_CHAMBER_CHOICES)) {
      return { ok: false, reason: 'malformed final-chamber-choice' };
    }
    return {
      ok: true,
      value: {
        type: 'final-chamber-choice',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
        choice: parsed.choice,
      },
    };
  }
  return { ok: false, reason: `unknown message type ${parsed.type}` };
}
