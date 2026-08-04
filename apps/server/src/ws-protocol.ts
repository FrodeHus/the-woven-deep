import { MERCHANT_SERVICE_IDS, type MerchantServiceId } from '@woven-deep/content';
import { ATTRIBUTE_ORDER, RUN_MODES, type HeroChoices } from '@woven-deep/engine';
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

/**
 * Structural (wire-level) validation of a `start-run` payload's choices. Deep semantic validation
 * — real class/kit/background/trait ids, point-buy legality, name rules — is the engine's
 * `heroFromChoices`/`validateHeroChoices`, run by the session when the message is handled; this
 * only guarantees the shape is safe to hand it.
 */
function validateHeroChoicesShape(value: unknown): value is HeroChoices {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string') return false;
  if (value.method !== 'roll' && value.method !== 'point-buy') return false;
  if (!isRecord(value.attributes)) return false;
  for (const attribute of ATTRIBUTE_ORDER) {
    if (typeof value.attributes[attribute] !== 'number') return false;
  }
  if (typeof value.classId !== 'string' || typeof value.kitId !== 'string') return false;
  if (typeof value.backgroundId !== 'string') return false;
  if (!Array.isArray(value.traitIds) || value.traitIds.some((id) => typeof id !== 'string')) {
    return false;
  }
  return true;
}

/** Travel modes that batch. Stairs is deliberately excluded (see `BatchedTravelMode`). */
const TRAVEL_MODES = ['travel', 'explore'] as const;

/** An upper bound on a client-supplied travel plan. The longest possible path across a floor is
 * far below this, so anything larger is a malformed or hostile message rather than a real walk --
 * and the walk itself is capped at `TRAVEL_BATCH_CAP` steps regardless. */
const MAX_TRAVEL_PLAN_STEPS = 4096;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPointArray(value: unknown): value is readonly { x: number; y: number }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => isRecord(entry) && Number.isInteger(entry.x) && Number.isInteger(entry.y),
    )
  );
}

function isAutoPickup(value: unknown): value is { allowConsumables: boolean } | null {
  if (value === null) return true;
  return isRecord(value) && typeof value.allowConsumables === 'boolean';
}

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
    case 'offer':
      return typeof value.itemId === 'string';
    case 'temper':
      return isOneOf(value.attribute, ATTRIBUTE_ORDER);
    default:
      return false;
  }
}

/**
 * Parses + validates a raw incoming WS payload against the client→server protocol. Never throws —
 * a malformed payload (bad JSON, unknown `type`, missing/mistyped fields) yields `ok: false` so the
 * caller can reply with `{type:'error'}` and keep the connection alive.
 */
/**
 * Whether a raw payload is a resync request, without committing to full parsing. The route needs
 * this BEFORE `handleMessage` runs so it can clear the connection's `FloorWireEncoder` cache and
 * have the resulting snapshot encode as a full sync -- which is the entire point of the request.
 * Keeping it separate is what lets `handleMessage` stay pure and socket-free.
 */
export function isResyncRequest(raw: unknown): boolean {
  const parsed = parseClientMessage(raw);
  return parsed.ok && parsed.value.type === 'resync';
}

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
  // Checked ahead of the envelope: `resync` mutates nothing, so it carries no
  // `commandId`/`expectedRevision` to validate.
  if (parsed.type === 'resync') {
    return { ok: true, value: { type: 'resync' } };
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
  if (parsed.type === 'travel') {
    if (!isOneOf(parsed.mode, TRAVEL_MODES)) return { ok: false, reason: 'malformed travel mode' };
    if (!isPointArray(parsed.steps)) return { ok: false, reason: 'malformed travel steps' };
    if (parsed.onArrive !== null && parsed.onArrive !== 'pickup') {
      return { ok: false, reason: 'malformed travel onArrive' };
    }
    if (!isAutoPickup(parsed.autoPickup))
      return { ok: false, reason: 'malformed travel autoPickup' };
    if (!isStringArray(parsed.offeredItemIds)) {
      return { ok: false, reason: 'malformed travel offeredItemIds' };
    }
    // A client could otherwise hand over an arbitrarily long path and make one message cost
    // unbounded server work. The walk is capped at TRAVEL_BATCH_CAP steps regardless, so a plan
    // longer than a floor could ever need is malformed rather than merely wasteful.
    if (parsed.steps.length > MAX_TRAVEL_PLAN_STEPS) {
      return { ok: false, reason: 'travel plan too long' };
    }
    return {
      ok: true,
      value: {
        type: 'travel',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
        mode: parsed.mode,
        steps: parsed.steps,
        onArrive: parsed.onArrive,
        autoPickup: parsed.autoPickup,
        offeredItemIds: parsed.offeredItemIds,
      },
    };
  }
  // Both carry nothing beyond the shared `commandId`/`expectedRevision` envelope validated above,
  // so there is no per-variant payload left to check here.
  if (parsed.type === 'rise-again' || parsed.type === 'accept-death') {
    return {
      ok: true,
      value: {
        type: parsed.type,
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
      },
    };
  }
  if (parsed.type === 'start-run') {
    if (!isOneOf(parsed.mode, RUN_MODES) || !validateHeroChoicesShape(parsed.choices)) {
      return { ok: false, reason: 'malformed start-run' };
    }
    return {
      ok: true,
      value: {
        type: 'start-run',
        commandId: parsed.commandId,
        expectedRevision: parsed.expectedRevision,
        choices: parsed.choices,
        mode: parsed.mode,
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
