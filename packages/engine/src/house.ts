import type { CompiledContentPack } from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import { requireItem as itemDefinition } from './content-index.js';
import { canStack, depositIntoBackpack } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import type {
  ActiveRun,
  DomainEvent,
  GameCommand,
  HouseCommand,
  InvalidActionReason,
  OpaqueId,
} from './model.js';
import { isTownFloorActive } from './town-floor.js';

export function isHouseCommand(command: GameCommand): command is HouseCommand {
  return command.type === 'house-deposit' || command.type === 'house-withdraw';
}

function positiveQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The house door's position, resolved from the active (always town, when this matters) floor's
 * placement slots -- never a hardcoded constant, so it stays correct if the town vault's layout
 * ever changes.
 */
function houseDoorPosition(run: ActiveRun): Readonly<{ x: number; y: number }> {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId);
  if (!floor) throw new Error(`internal invariant: active floor ${run.activeFloorId} is missing`);
  const slot = floor.placementSlots.find((candidate) => candidate.tags.includes('house-door'));
  if (!slot)
    throw new Error('internal invariant: town floor is missing its house-door placement slot');
  return { x: slot.x, y: slot.y };
}

/** True when the hero is in town and Chebyshev-adjacent to the house door -- required for any house command. */
function heroAtHouseDoor(run: ActiveRun): boolean {
  if (!isTownFloorActive(run)) return false;
  const hero = heroActor(run);
  const door = houseDoorPosition(run);
  return Math.max(Math.abs(hero.x - door.x), Math.abs(hero.y - door.y)) === 1;
}

export type HouseValidation =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: InvalidActionReason }>;

type HouseTransition =
  Readonly<{ ok: true; run: ActiveRun }> | Readonly<{ ok: false; reason: InvalidActionReason }>;

/**
 * Moves `quantity` units of a hero-backpack item into house storage, merging into a compatible
 * house stack first (mirrors `depositIntoBackpack`'s stacking/split rules, but the destination is
 * the single global house location and its capacity is counted in stacks, not quantity).
 */
function depositIntoHouse(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    sourceItemId: OpaqueId;
    quantity: number;
    newItemId: OpaqueId;
  }>,
): HouseTransition {
  if (!positiveQuantity(input.quantity)) return { ok: false, reason: 'item.quantity' };
  if (!heroAtHouseDoor(input.run)) return { ok: false, reason: 'item.unavailable' };
  const hero = heroActor(input.run);
  const source = input.run.items.find((candidate) => candidate.itemId === input.sourceItemId);
  if (!source) return { ok: false, reason: 'item.missing' };
  if (source.location.type !== 'backpack' || source.location.actorId !== hero.actorId) {
    return { ok: false, reason: 'item.unavailable' };
  }
  if (input.quantity > source.quantity) return { ok: false, reason: 'item.quantity' };
  const definition = itemDefinition(input.content, source.contentId);
  const houseStacks = input.run.items
    .filter(
      (candidate) =>
        candidate.location.type === 'house' &&
        candidate.itemId !== source.itemId &&
        canStack(candidate, source),
    )
    .sort((left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
  let remaining = input.quantity;
  const updates = new Map<OpaqueId, ItemInstance>();
  for (const target of houseStacks) {
    const transferred = Math.min(remaining, definition.stackLimit - target.quantity);
    if (transferred <= 0) continue;
    updates.set(target.itemId, { ...target, quantity: target.quantity + transferred });
    remaining -= transferred;
    if (remaining === 0) break;
  }
  const houseStackCount = input.run.items.filter(
    (candidate) => candidate.location.type === 'house',
  ).length;
  if (remaining > 0 && houseStackCount >= input.run.house.capacity)
    return { ok: false, reason: 'house.full' };
  const sourceRemainder = source.quantity - input.quantity;
  let carried: ItemInstance | undefined;
  if (remaining > 0) {
    const carriedId = sourceRemainder === 0 ? source.itemId : input.newItemId;
    if (
      carriedId !== source.itemId &&
      input.run.items.some((candidate) => candidate.itemId === carriedId)
    ) {
      return { ok: false, reason: 'item.id-conflict' };
    }
    carried = { ...source, itemId: carriedId, quantity: remaining, location: { type: 'house' } };
  }
  const items = input.run.items.flatMap((entry) => {
    const update = updates.get(entry.itemId);
    if (update) return [update];
    if (entry.itemId !== source.itemId) return [entry];
    if (sourceRemainder > 0) return [{ ...source, quantity: sourceRemainder }];
    return carried?.itemId === source.itemId ? [carried] : [];
  });
  if (carried && carried.itemId !== source.itemId) items.push(carried);
  items.sort((left, right) =>
    left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
  );
  return { ok: true, run: { ...input.run, items } };
}

/**
 * Moves `quantity` units of a house-stored item back into the hero's backpack. Reuses
 * `depositIntoBackpack` directly: it already moves a source item "wherever it currently rests"
 * into the hero's backpack with the same stacking/split/capacity rules, so withdrawal only needs
 * to add the town/adjacency and house-location preconditions on top.
 */
function withdrawFromHouse(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    sourceItemId: OpaqueId;
    quantity: number;
    newItemId: OpaqueId;
  }>,
): HouseTransition {
  if (!positiveQuantity(input.quantity)) return { ok: false, reason: 'item.quantity' };
  if (!heroAtHouseDoor(input.run)) return { ok: false, reason: 'item.unavailable' };
  const source = input.run.items.find((candidate) => candidate.itemId === input.sourceItemId);
  if (!source) return { ok: false, reason: 'item.missing' };
  if (source.location.type !== 'house') return { ok: false, reason: 'item.unavailable' };
  const hero = heroActor(input.run);
  const result = depositIntoBackpack({
    run: input.run,
    content: input.content,
    actorId: hero.actorId,
    sourceItemId: input.sourceItemId,
    quantity: input.quantity,
    newItemId: input.newItemId,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, run: result.run };
}

export function validateHouseCommand(
  input: Readonly<{
    state: ActiveRun;
    command: HouseCommand;
    content: CompiledContentPack;
  }>,
): HouseValidation {
  const { state, command, content } = input;
  const result =
    command.type === 'house-deposit'
      ? depositIntoHouse({
          run: state,
          content,
          sourceItemId: command.itemId,
          quantity: command.quantity,
          newItemId: command.commandId,
        })
      : withdrawFromHouse({
          run: state,
          content,
          sourceItemId: command.itemId,
          quantity: command.quantity,
          newItemId: command.commandId,
        });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

/** Applies a validated house command; the caller (reducer) advances the revision only. */
export function resolveHouseCommand(
  input: Readonly<{
    state: ActiveRun;
    command: HouseCommand;
    content: CompiledContentPack;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const { state, command, content } = input;
  const result =
    command.type === 'house-deposit'
      ? depositIntoHouse({
          run: state,
          content,
          sourceItemId: command.itemId,
          quantity: command.quantity,
          newItemId: command.commandId,
        })
      : withdrawFromHouse({
          run: state,
          content,
          sourceItemId: command.itemId,
          quantity: command.quantity,
          newItemId: command.commandId,
        });
  if (!result.ok) throw new Error(`internal invariant: ${command.type} was not validated`);
  return { state: result.run, events: [] };
}
