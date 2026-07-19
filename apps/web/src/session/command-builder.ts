import type { CompiledContentPack } from '@woven-deep/content';
import type {
  Direction, EquipmentSlot, GameCommand, GameplayProjection, OpaqueId,
} from '@woven-deep/engine';
import type { PlayerIntent } from './intents.js';
import {
  actorsOf, adjacentMerchant, featuresOf, groundItemsOf, heroOf, ownedItemOf,
  type ActorView, type FeatureView, type GroundItemView, type OwnedItemView,
} from './projection-view.js';
import { itemById } from './pack-queries.js';

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

function actorAt(projection: GameplayProjection, x: number, y: number): ActorView | undefined {
  return actorsOf(projection).find((actor) => actor.x === x && actor.y === y);
}

function closedDoorAt(projection: GameplayProjection, x: number, y: number): FeatureView | undefined {
  return featuresOf(projection)
    .find((feature) => feature.type === 'door' && feature.state !== 'open' && feature.x === x && feature.y === y);
}

function groundItemAt(projection: GameplayProjection, x: number, y: number): GroundItemView | undefined {
  return groundItemsOf(projection).find((item) => item.x === x && item.y === y);
}

function ownedItem(projection: GameplayProjection, itemId: OpaqueId): OwnedItemView | undefined {
  return ownedItemOf(heroOf(projection), itemId);
}

function stairDownUnderHero(projection: GameplayProjection): boolean {
  const { x, y } = heroOf(projection);
  const cell = projection.floor.cells.find((candidate) => candidate.x === x && candidate.y === y);
  return cell?.tileId === 5;
}

function stairUpUnderHero(projection: GameplayProjection): boolean {
  const { x, y } = heroOf(projection);
  const cell = projection.floor.cells.find((candidate) => candidate.x === x && candidate.y === y);
  return cell?.tileId === 4;
}

/** True when the hero is Chebyshev-adjacent (but not standing on) the town's house-door slot --
 * mirrors the engine's own `heroAtHouseDoor` adjacency rule in `house.ts`. */
function heroAdjacentToHouseDoor(projection: GameplayProjection): boolean {
  const door = projection.slots.find((slot) => slot.tags.includes('house-door'));
  if (!door) return false;
  const { x, y } = heroOf(projection);
  return Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) === 1;
}

function equipSlotFor(pack: CompiledContentPack, contentId: OpaqueId, occupiedSlots: ReadonlySet<EquipmentSlot>): EquipmentSlot | undefined {
  const entry = itemById(pack, contentId);
  if (!entry || entry.equipment === null) return undefined;
  const { slots } = entry.equipment;
  return slots.find((slot) => !occupiedSlots.has(slot)) ?? slots[0];
}

function buildMoveIntent(input: Readonly<{
  projection: GameplayProjection; commandId: OpaqueId; expectedRevision: number; direction: Direction;
}>): BuiltIntent {
  const { projection, commandId, expectedRevision, direction } = input;
  const origin = heroOf(projection);
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
  const origin = heroOf(projection);
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
    const equipment = heroOf(projection).equipment;
    const slot = Object.entries(equipment)
      .find(([, equipped]) => equipped?.itemId === itemId)?.[0] as EquipmentSlot | undefined;
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
  const equipment = heroOf(projection).equipment;
  const occupiedSlots = new Set(
    Object.entries(equipment).filter(([, value]) => value !== null).map(([slot]) => slot as EquipmentSlot),
  );
  const slot = equipSlotFor(pack, item.contentId, occupiedSlots);
  if (!slot) return { kind: 'rejected', message: `${item.name} cannot be equipped.` };
  return { kind: 'command', command: { type: 'equip', itemId, slot, commandId, expectedRevision } };
}

function buildRefuelIntent(input: Readonly<{
  projection: GameplayProjection; commandId: OpaqueId; expectedRevision: number;
  fuelItemId: OpaqueId; targetItemId: OpaqueId;
}>): BuiltIntent {
  const { projection, commandId, expectedRevision, fuelItemId, targetItemId } = input;
  const fuel = ownedItem(projection, fuelItemId);
  if (!fuel) return { kind: 'rejected', message: 'That item is no longer in your backpack.' };
  const target = ownedItem(projection, targetItemId);
  if (!target) return { kind: 'rejected', message: 'That light is no longer equipped.' };
  return {
    kind: 'command',
    command: {
      type: 'refuel', itemId: targetItemId, fuelItemId, quantity: fuel.quantity ?? 1, commandId, expectedRevision,
    },
  };
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
  if (intent.type === 'refuel') {
    return buildRefuelIntent({
      projection, commandId, expectedRevision, fuelItemId: intent.fuelItemId, targetItemId: intent.targetItemId,
    });
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
    const merchant = adjacentMerchant(projection);
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
