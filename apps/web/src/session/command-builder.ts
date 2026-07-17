import type { CompiledContentPack } from '@woven-deep/content';
import type {
  Direction, EquipmentSlot, GameCommand, GameplayProjection, OpaqueId,
} from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';

export type BuiltIntent =
  | { readonly kind: 'command'; readonly command: GameCommand }
  | { readonly kind: 'descend' }
  | { readonly kind: 'ascend' }
  | { readonly kind: 'house' }
  | { readonly kind: 'rejected'; readonly message: string };

/**
 * A conservative client-side cap on how long a single "rest until healed" command asks the
 * server to advance world time. The server independently clamps against its own balance rule
 * (`restMaximumDuration`); this constant only bounds what the guest client ever proposes.
 */
const REST_MAXIMUM_DURATION = 500;

const DIRECTION_DELTAS: Readonly<Record<Direction, Readonly<{ dx: number; dy: number }>>> = {
  north: { dx: 0, dy: -1 },
  northeast: { dx: 1, dy: -1 },
  east: { dx: 1, dy: 0 },
  southeast: { dx: 1, dy: 1 },
  south: { dx: 0, dy: 1 },
  southwest: { dx: -1, dy: 1 },
  west: { dx: -1, dy: 0 },
  northwest: { dx: -1, dy: -1 },
};

interface ProjectedHero {
  readonly x: number;
  readonly y: number;
  readonly backpack: readonly Readonly<Record<string, unknown>>[];
  readonly equipment: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>;
}

interface ProjectedActor {
  readonly actorId: OpaqueId;
  readonly x: number;
  readonly y: number;
  readonly disposition?: string;
  /** Present (via the engine's `visibleMerchantState`) only on merchant actors -- the honest
   * signal that this actor can be traded with, mirrored from `TownPanel`'s own use of the field. */
  readonly factionName?: string;
}

interface ProjectedFeature {
  readonly featureId: OpaqueId;
  readonly type: string;
  readonly state?: string;
  readonly x: number;
  readonly y: number;
}

interface ProjectedGroundItem {
  readonly itemId: OpaqueId;
  readonly quantity: number;
  readonly x: number;
  readonly y: number;
}

interface ProjectedBackpackItem {
  readonly itemId: OpaqueId;
  readonly contentId?: OpaqueId;
  readonly name: string;
  readonly enabled?: boolean | null;
}

function hero(projection: GameplayProjection): ProjectedHero {
  return projection.hero as unknown as ProjectedHero;
}

function actorAt(projection: GameplayProjection, x: number, y: number): ProjectedActor | undefined {
  return (projection.actors as unknown as readonly ProjectedActor[])
    .find((actor) => actor.x === x && actor.y === y);
}

function closedDoorAt(projection: GameplayProjection, x: number, y: number): ProjectedFeature | undefined {
  return (projection.features as unknown as readonly ProjectedFeature[])
    .find((feature) => feature.type === 'door' && feature.state !== 'open' && feature.x === x && feature.y === y);
}

function groundItemAt(projection: GameplayProjection, x: number, y: number): ProjectedGroundItem | undefined {
  return (projection.groundItems as unknown as readonly ProjectedGroundItem[])
    .find((item) => item.x === x && item.y === y);
}

function ownedItem(projection: GameplayProjection, itemId: OpaqueId): ProjectedBackpackItem | undefined {
  const owner = hero(projection);
  const inBackpack = (owner.backpack as unknown as readonly ProjectedBackpackItem[])
    .find((item) => item.itemId === itemId);
  if (inBackpack) return inBackpack;
  return (Object.values(owner.equipment) as readonly (Readonly<Record<string, unknown>> | null)[])
    .filter((item): item is Readonly<Record<string, unknown>> => item !== null)
    .map((item) => item as unknown as ProjectedBackpackItem)
    .find((item) => item.itemId === itemId);
}

function stairDownUnderHero(projection: GameplayProjection): boolean {
  const { x, y } = hero(projection);
  const cell = projection.floor.cells.find((candidate) => candidate.x === x && candidate.y === y);
  return cell?.tileId === 5;
}

function stairUpUnderHero(projection: GameplayProjection): boolean {
  const { x, y } = hero(projection);
  const cell = projection.floor.cells.find((candidate) => candidate.x === x && candidate.y === y);
  return cell?.tileId === 4;
}

interface ProjectedPlacementSlot {
  readonly tags: readonly string[];
  readonly x: number;
  readonly y: number;
}

/** True when the hero is Chebyshev-adjacent (but not standing on) the town's house-door slot --
 * mirrors the engine's own `heroAtHouseDoor` adjacency rule in `house.ts`. */
function heroAdjacentToHouseDoor(projection: GameplayProjection): boolean {
  const door = (projection.slots as unknown as readonly ProjectedPlacementSlot[])
    .find((slot) => slot.tags.includes('house-door'));
  if (!door) return false;
  const { x, y } = hero(projection);
  return Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) === 1;
}

/** The merchant actor the hero is Chebyshev-adjacent to (but not standing on), if any -- mirrors
 * `heroAdjacentToHouseDoor` above. When more than one merchant is adjacent, the nearest by
 * actor-id ordering wins; the town's authored merchant stalls never place two merchants close
 * enough for this to matter in practice. */
function heroAdjacentMerchant(projection: GameplayProjection): ProjectedActor | undefined {
  const origin = hero(projection);
  return (projection.actors as unknown as readonly ProjectedActor[])
    .filter((actor) => typeof actor.factionName === 'string')
    .filter((actor) => Math.max(Math.abs(actor.x - origin.x), Math.abs(actor.y - origin.y)) === 1)
    .sort((left, right) => (left.actorId < right.actorId ? -1 : 1))[0];
}

function equipSlotFor(pack: CompiledContentPack, contentId: OpaqueId, occupiedSlots: ReadonlySet<EquipmentSlot>): EquipmentSlot | undefined {
  const entry = pack.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item' || entry.equipment === null) return undefined;
  const { slots } = entry.equipment;
  return slots.find((slot) => !occupiedSlots.has(slot)) ?? slots[0];
}

function buildMoveIntent(input: Readonly<{
  projection: GameplayProjection; commandId: OpaqueId; expectedRevision: number; direction: Direction;
}>): BuiltIntent {
  const { projection, commandId, expectedRevision, direction } = input;
  const origin = hero(projection);
  const delta = DIRECTION_DELTAS[direction];
  const target = { x: origin.x + delta.dx, y: origin.y + delta.dy };

  const occupant = actorAt(projection, target.x, target.y);
  if (occupant) {
    if (occupant.disposition === 'hostile') {
      return { kind: 'command', command: { type: 'attack', targetActorId: occupant.actorId, commandId, expectedRevision } };
    }
    return { kind: 'rejected', message: 'Something is in the way.' };
  }

  const door = closedDoorAt(projection, target.x, target.y);
  if (door) {
    return { kind: 'command', command: { type: 'open-door', featureId: door.featureId, commandId, expectedRevision } };
  }

  return { kind: 'command', command: { type: 'move', direction, commandId, expectedRevision } };
}

function buildPickupIntent(input: Readonly<{
  projection: GameplayProjection; commandId: OpaqueId; expectedRevision: number;
}>): BuiltIntent {
  const { projection, commandId, expectedRevision } = input;
  const origin = hero(projection);
  const item = groundItemAt(projection, origin.x, origin.y);
  if (!item) return { kind: 'rejected', message: 'There is nothing here to pick up.' };
  return {
    kind: 'command',
    command: { type: 'pickup', itemId: item.itemId, quantity: item.quantity, commandId, expectedRevision },
  };
}

function buildBackpackIntent(input: Readonly<{
  projection: GameplayProjection; commandId: OpaqueId; expectedRevision: number;
  action: 'equip' | 'unequip' | 'use' | 'drop' | 'toggle-light'; itemId: OpaqueId; pack?: CompiledContentPack | undefined;
}>): BuiltIntent {
  const { projection, commandId, expectedRevision, action, itemId, pack } = input;
  const item = ownedItem(projection, itemId);
  if (!item) return { kind: 'rejected', message: 'That item is no longer in your backpack.' };

  if (action === 'unequip') {
    const equipment = hero(projection).equipment;
    const slot = Object.entries(equipment)
      .find(([, equipped]) => (equipped as { itemId?: OpaqueId } | null)?.itemId === itemId)?.[0] as EquipmentSlot | undefined;
    if (!slot) return { kind: 'rejected', message: `${item.name} is not equipped.` };
    return { kind: 'command', command: { type: 'unequip', slot, commandId, expectedRevision } };
  }
  if (action === 'use') {
    return { kind: 'command', command: { type: 'use-item', itemId, target: null, commandId, expectedRevision } };
  }
  if (action === 'drop') {
    return { kind: 'command', command: { type: 'drop', itemId, quantity: 1, commandId, expectedRevision } };
  }
  if (action === 'toggle-light') {
    return {
      kind: 'command',
      command: { type: 'toggle-light', itemId, enabled: !item.enabled, commandId, expectedRevision },
    };
  }

  // action === 'equip'
  if (!pack || !item.contentId) {
    return { kind: 'rejected', message: `${item.name} cannot be equipped.` };
  }
  const equipment = hero(projection).equipment;
  const occupiedSlots = new Set(
    Object.entries(equipment).filter(([, value]) => value !== null).map(([slot]) => slot as EquipmentSlot),
  );
  const slot = equipSlotFor(pack, item.contentId, occupiedSlots);
  if (!slot) return { kind: 'rejected', message: `${item.name} cannot be equipped.` };
  return { kind: 'command', command: { type: 'equip', itemId, slot, commandId, expectedRevision } };
}

export function buildIntent(input: Readonly<{
  intent: PlayerIntent;
  projection: GameplayProjection;
  commandId: OpaqueId;
  expectedRevision: number;
  pack?: CompiledContentPack;
}>): BuiltIntent {
  const { intent, projection, commandId, expectedRevision, pack } = input;

  if (intent.type === 'move') {
    return buildMoveIntent({ projection, commandId, expectedRevision, direction: intent.direction });
  }
  if (intent.type === 'wait') {
    return { kind: 'command', command: { type: 'wait', commandId, expectedRevision } };
  }
  if (intent.type === 'rest') {
    return {
      kind: 'command',
      command: { type: 'rest', until: 'healed', maximumDuration: REST_MAXIMUM_DURATION, commandId, expectedRevision },
    };
  }
  if (intent.type === 'pickup') {
    return buildPickupIntent({ projection, commandId, expectedRevision });
  }
  if (intent.type === 'descend') {
    return stairDownUnderHero(projection) ? { kind: 'descend' } : { kind: 'rejected', message: 'There are no stairs down here.' };
  }
  if (intent.type === 'ascend') {
    return stairUpUnderHero(projection) ? { kind: 'ascend' } : { kind: 'rejected', message: 'There are no stairs up here.' };
  }
  if (intent.type === 'house') {
    return heroAdjacentToHouseDoor(projection) ? { kind: 'house' } : { kind: 'rejected', message: 'You are not near the house.' };
  }
  if (intent.type === 'house-transfer') {
    return {
      kind: 'command',
      command: {
        type: intent.action === 'deposit' ? 'house-deposit' : 'house-withdraw',
        itemId: intent.itemId, quantity: intent.quantity, commandId, expectedRevision,
      },
    };
  }
  if (intent.type === 'trade-open') {
    const merchant = heroAdjacentMerchant(projection);
    if (!merchant) return { kind: 'rejected', message: 'There is no merchant nearby to trade with.' };
    return {
      kind: 'command',
      command: { type: 'trade-open', merchantActorId: merchant.actorId, commandId, expectedRevision },
    };
  }
  if (intent.type === 'trade-close' || intent.type === 'trade-buy' || intent.type === 'trade-sell'
    || intent.type === 'trade-service') {
    const { trade } = projection;
    if (!trade) return { kind: 'rejected', message: 'There is no open trade session.' };
    if (intent.type === 'trade-close') {
      return {
        kind: 'command',
        command: { type: 'trade-close', merchantPopulationId: trade.merchantPopulationId, commandId, expectedRevision },
      };
    }
    if (intent.type === 'trade-buy') {
      return {
        kind: 'command',
        command: {
          type: 'trade-buy', merchantPopulationId: trade.merchantPopulationId,
          itemId: intent.itemId, quantity: intent.quantity, commandId, expectedRevision,
        },
      };
    }
    if (intent.type === 'trade-sell') {
      return {
        kind: 'command',
        command: {
          type: 'trade-sell', merchantPopulationId: trade.merchantPopulationId,
          itemId: intent.itemId, quantity: intent.quantity, commandId, expectedRevision,
        },
      };
    }
    return {
      kind: 'command',
      command: {
        type: 'trade-service', merchantPopulationId: trade.merchantPopulationId,
        serviceId: intent.serviceId, targetItemId: intent.targetItemId, commandId, expectedRevision,
      },
    };
  }
  return buildBackpackIntent({ projection, commandId, expectedRevision, action: intent.action, itemId: intent.itemId, pack });
}
