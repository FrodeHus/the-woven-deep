import { actorById } from './actor-model.js';
import type { ChestFeature, DoorFeature, DungeonFeature } from './feature-model.js';
import {
  tileIndex,
  type ActiveRun,
  type DomainEvent,
  type OpaqueId,
  type TileId,
} from './model.js';
import type { CompiledContentPack, TrapContentEntry } from '@woven-deep/content';
import { rollDie } from './random.js';
import { applyEffectResult, resolveEffectSequence, withRngStream } from './effects.js';
import { deriveActorStats } from './attributes.js';
import { conditionModifiers } from './conditions.js';
import { equipmentModifiers } from './equipment.js';
import { consumeItemQuantity, createFloorItem, createFloorLootFromTable } from './inventory.js';
import { compareCodeUnits } from './stable-json.js';
import type { ItemInstance } from './item-model.js';

export function featureAt(
  input: Readonly<{
    run: Pick<ActiveRun, 'features'>;
    floorId: OpaqueId;
    x: number;
    y: number;
  }>,
): DungeonFeature | undefined {
  return input.run.features.find(
    (feature) =>
      feature.floorId === input.floorId && feature.x === input.x && feature.y === input.y,
  );
}

export function featureBlocksMovement(feature: DungeonFeature): boolean {
  if (feature.type === 'door') return feature.state !== 'open';
  if (feature.type === 'secret') return feature.state === 'hidden';
  if (feature.type === 'chest') return feature.state === 'locked' || feature.state === 'closed';
  return false;
}

export function featureTiles(
  run: Pick<ActiveRun, 'features' | 'floors'>,
  floorId: OpaqueId,
): readonly TileId[] {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId);
  if (!floor) throw new Error(`internal invariant: floor ${floorId} does not exist`);
  const tiles = [...floor.tiles];
  for (const feature of run.features) {
    if (feature.floorId !== floorId) continue;
    const index = tileIndex(floor, feature.x, feature.y);
    if (index === undefined)
      throw new Error(`internal invariant: feature ${feature.featureId} is outside its floor`);
    if (
      (feature.type === 'door' && feature.state === 'open') ||
      (feature.type === 'secret' && feature.state === 'revealed')
    )
      tiles[index] = 1;
    else tiles[index] = feature.coverTileId;
  }
  return tiles;
}

export type DoorTransition =
  | Readonly<{ ok: true; run: ActiveRun; door: DoorFeature }>
  | Readonly<{
      ok: false;
      reason:
        | 'door.missing'
        | 'door.not-adjacent'
        | 'door.locked'
        | 'door.already-open'
        | 'door.already-closed'
        | 'door.occupied';
    }>;

function selectedDoor(
  run: ActiveRun,
  actorId: OpaqueId,
  featureId: OpaqueId,
):
  | DoorTransition
  | Readonly<{
      actorId: OpaqueId;
      door: DoorFeature;
    }> {
  const actor = actorById(run, actorId);
  const feature = run.features.find((candidate) => candidate.featureId === featureId);
  if (!actor || !feature || feature.type !== 'door' || feature.floorId !== actor.floorId) {
    return { ok: false, reason: 'door.missing' };
  }
  const distance = Math.max(Math.abs(feature.x - actor.x), Math.abs(feature.y - actor.y));
  if (distance !== 1) return { ok: false, reason: 'door.not-adjacent' };
  return { actorId: actor.actorId, door: feature };
}

function replaceDoor(run: ActiveRun, door: DoorFeature): ActiveRun {
  return {
    ...run,
    features: run.features.map((feature) =>
      feature.featureId === door.featureId ? door : feature,
    ),
  };
}

export function openDoor(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    featureId: OpaqueId;
  }>,
): DoorTransition {
  const selected = selectedDoor(input.run, input.actorId, input.featureId);
  if ('ok' in selected) return selected;
  if (selected.door.state === 'locked') return { ok: false, reason: 'door.locked' };
  if (selected.door.state === 'open') return { ok: false, reason: 'door.already-open' };
  const door = { ...selected.door, state: 'open' as const };
  return { ok: true, run: replaceDoor(input.run, door), door };
}

export function closeDoor(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    featureId: OpaqueId;
  }>,
): DoorTransition {
  const selected = selectedDoor(input.run, input.actorId, input.featureId);
  if ('ok' in selected) return selected;
  if (selected.door.state !== 'open') return { ok: false, reason: 'door.already-closed' };
  if (
    input.run.actors.some(
      (actor) =>
        actor.health > 0 &&
        actor.floorId === selected.door.floorId &&
        actor.x === selected.door.x &&
        actor.y === selected.door.y,
    )
  ) {
    return { ok: false, reason: 'door.occupied' };
  }
  const door = { ...selected.door, state: 'closed' as const };
  return { ok: true, run: replaceDoor(input.run, door), door };
}

function discovered(feature: DungeonFeature, actorId: OpaqueId): boolean {
  if (feature.type === 'door' || feature.type === 'chest') return true;
  return feature.discovery.discoveredByActorIds.includes(actorId);
}

export function discoveryContextKey(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    illumination: number;
  }>,
): string {
  const actor = actorById(input.run, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const band =
    input.illumination === 0 ? 0 : input.illumination < 64 ? 1 : input.illumination < 160 ? 2 : 3;
  const conditions =
    actor.conditions
      .map((condition) => condition.conditionId)
      .sort()
      .join(':') || 'none';
  const tools =
    input.run.items
      .filter(
        (item) => item.location.type === 'equipped' && item.location.actorId === actor.actorId,
      )
      .map((item) => item.contentId)
      .sort()
      .join(':') || 'none';
  return `context.${actor.actorId}.${actor.x}.${actor.y}.${band}.${conditions}.${tools}`;
}

function reveal(
  feature: Exclude<DungeonFeature, DoorFeature | ChestFeature>,
  actorId: OpaqueId,
): DungeonFeature {
  const discoveredByActorIds = [
    ...new Set([...feature.discovery.discoveredByActorIds, actorId]),
  ].sort();
  const discovery = { ...feature.discovery, discoveredByActorIds };
  return feature.type === 'secret'
    ? { ...feature, state: 'revealed', discovery }
    : { ...feature, discovery };
}

function discoveryAttempt(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    contextKey: string;
    contribution: number;
    radius: number;
    eventId: OpaqueId;
    passive: boolean;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.run, input.actorId)!;
  const events: DomainEvent[] = [];
  const features = input.run.features.map((feature): DungeonFeature => {
    if (
      feature.type === 'door' ||
      feature.type === 'chest' ||
      feature.floorId !== actor.floorId ||
      discovered(feature, actor.actorId) ||
      Math.max(Math.abs(feature.x - actor.x), Math.abs(feature.y - actor.y)) > input.radius
    )
      return feature;
    if (input.passive && feature.discovery.attemptedContextKeys.includes(input.contextKey))
      return feature;
    const repeated = feature.discovery.attemptedContextKeys.includes(input.contextKey);
    const contribution = repeated
      ? Math.max(1, Math.floor(input.contribution / 2))
      : input.contribution;
    const progress = (feature.discovery.progressByActorId[actor.actorId] ?? 0) + contribution;
    const attemptedContextKeys = repeated
      ? feature.discovery.attemptedContextKeys
      : [...feature.discovery.attemptedContextKeys, input.contextKey].sort();
    const updated = {
      ...feature,
      discovery: {
        ...feature.discovery,
        attemptedContextKeys,
        progressByActorId: { ...feature.discovery.progressByActorId, [actor.actorId]: progress },
      },
    };
    if (progress < feature.discoveryDifficulty) return updated;
    events.push({
      type: 'feature.revealed',
      eventId: input.eventId,
      actorId: actor.actorId,
      featureId: feature.featureId,
    });
    return reveal(updated, actor.actorId);
  });
  return { run: { ...input.run, features }, events };
}

export function applyPassiveDiscovery(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    illumination: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.run, input.actorId)!;
  return discoveryAttempt({
    ...input,
    contextKey: discoveryContextKey(input),
    contribution: Math.max(1, actor.attributes.wits + Math.floor(input.illumination / 64)),
    radius: 2,
    passive: true,
  });
}

export function searchFeatures(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    illumination: number;
    eventId: OpaqueId;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.run, input.actorId)!;
  const result = discoveryAttempt({
    ...input,
    contextKey: discoveryContextKey(input),
    contribution: Math.max(1, actor.attributes.wits),
    radius: 3,
    passive: false,
  });
  return {
    ...result,
    events: [
      { type: 'feature.searched', eventId: input.eventId, actorId: actor.actorId },
      ...result.events,
    ],
  };
}

function trapDefinition(
  content: CompiledContentPack,
  contentId: OpaqueId | null,
): TrapContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'trap')
    throw new Error(`internal invariant: trap definition ${contentId} does not exist`);
  return entry;
}

function itemTags(content: CompiledContentPack, contentId: OpaqueId): readonly string[] {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item')
    throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry.tags;
}

export function triggerTrap(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    featureId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const feature = input.run.features.find((candidate) => candidate.featureId === input.featureId);
  if (!feature || feature.type !== 'trap' || feature.state !== 'armed')
    throw new Error('trap is unavailable');
  const definition = trapDefinition(input.content, feature.contentId);
  let run = input.run;
  const events: DomainEvent[] = [];
  if (!discovered(feature, input.actorId)) {
    const revealed = reveal(feature, input.actorId);
    run = {
      ...run,
      features: run.features.map((candidate) =>
        candidate.featureId === feature.featureId ? revealed : candidate,
      ),
    };
    events.push({
      type: 'feature.revealed',
      eventId: input.eventId,
      actorId: input.actorId,
      featureId: feature.featureId,
    });
  }
  events.push({
    type: 'trap.triggered',
    eventId: input.eventId,
    actorId: input.actorId,
    featureId: feature.featureId,
  });
  const resolved = resolveEffectSequence({
    effects: definition.effects,
    actors: run.actors,
    items: run.items,
    survival: run.survival,
    survivalActorId: run.hero.actorId,
    content: input.content,
    sourceActorId: input.actorId,
    targetActorId: input.actorId,
    effectsState: run.rng.effects,
    worldTime: run.worldTime,
    eventId: input.eventId,
    forceMoveDirection: { x: 1, y: 0 },
    operations: {},
  });
  const state =
    definition.resetMode === 'reset'
      ? 'armed'
      : definition.resetMode === 'disabled'
        ? 'disabled'
        : 'spent';
  run = {
    ...applyEffectResult(run, resolved),
    features: run.features.map((candidate) =>
      candidate.featureId === feature.featureId && candidate.type === 'trap'
        ? { ...candidate, state }
        : candidate,
    ),
  };
  return { run, events: [...events, ...resolved.events] };
}

export function disarmTrap(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    featureId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const actor = actorById(input.run, input.actorId);
  const feature = input.run.features.find((candidate) => candidate.featureId === input.featureId);
  if (
    !actor ||
    !feature ||
    feature.type !== 'trap' ||
    feature.state !== 'armed' ||
    !discovered(feature, actor.actorId)
  )
    throw new Error('trap is unavailable');
  const definition = trapDefinition(input.content, feature.contentId);
  const balance = input.content.entries.find((entry) => entry.kind === 'balance')!;
  // Uses `deriveActorStats` directly, NOT `deriveRunActorStats` -- the latter also folds in
  // hunger modifiers, which would change the disarm roll's difficulty and is not part of this
  // check's contract.
  const stats = deriveActorStats({
    attributes: actor.attributes,
    formulas: balance.formulas,
    equipmentModifiers: equipmentModifiers({
      run: input.run,
      content: input.content,
      actorId: actor.actorId,
    }).map((source) => source.modifiers),
    conditionModifiers: conditionModifiers(actor, input.content),
    heroModifiers: actor.actorId === input.run.hero.actorId ? [input.run.hero.statModifiers] : [],
  });
  const rolled = rollDie(input.run.rng.effects, 20);
  const failed = rolled.value + stats.disarm < definition.disarmDifficulty;
  if (rolled.value === 1 || failed) {
    const mode =
      rolled.value === 1
        ? definition.disarmOutcomes.criticalFailure
        : definition.disarmOutcomes.failure;
    const rolledRun = withRngStream(input.run, 'effects', rolled.state);
    if (mode === 'trigger') return triggerTrap({ ...input, run: rolledRun });
    const events: DomainEvent[] = [
      {
        type: 'trap.disarm-failed',
        eventId: input.eventId,
        actorId: actor.actorId,
        featureId: feature.featureId,
      },
    ];
    if (mode === 'tool-damage') {
      const tool = rolledRun.items.find(
        (item) =>
          item.location.type === 'equipped' &&
          item.location.actorId === actor.actorId &&
          itemTags(input.content, item.contentId).includes('disarm-tool'),
      );
      if (!tool) return triggerTrap({ ...input, run: rolledRun });
      const condition = Math.max(0, tool.condition - definition.disarmOutcomes.toolDamage);
      events.push({
        type: 'item.damaged',
        eventId: input.eventId,
        actorId: actor.actorId,
        itemId: tool.itemId,
        amount: tool.condition - condition,
        condition,
      });
      return {
        run: {
          ...rolledRun,
          items: rolledRun.items.map((item) =>
            item.itemId === tool.itemId ? { ...item, condition } : item,
          ),
        },
        events,
      };
    }
    return { run: rolledRun, events };
  }
  const updated = { ...feature, state: 'disabled' as const };
  return {
    run: {
      ...input.run,
      rng: { ...input.run.rng, effects: rolled.state },
      features: input.run.features.map((candidate) =>
        candidate.featureId === feature.featureId ? updated : candidate,
      ),
    },
    events: [
      {
        type: 'trap.disarmed',
        eventId: input.eventId,
        actorId: actor.actorId,
        featureId: feature.featureId,
      },
    ],
  };
}

function replaceFeature(run: ActiveRun, feature: DungeonFeature): ActiveRun {
  return {
    ...run,
    features: run.features.map((candidate) =>
      candidate.featureId === feature.featureId ? feature : candidate,
    ),
  };
}

function heldByActor(run: ActiveRun, actorId: OpaqueId): readonly ItemInstance[] {
  return run.items.filter(
    (item) =>
      (item.location.type === 'backpack' || item.location.type === 'equipped') &&
      item.location.actorId === actorId,
  );
}

function actorLockpicks(
  run: ActiveRun,
  content: CompiledContentPack,
  actorId: OpaqueId,
): readonly ItemInstance[] {
  return heldByActor(run, actorId)
    .filter((item) => itemTags(content, item.contentId).includes('lockpick'))
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
}

function actorHoldsKey(run: ActiveRun, actorId: OpaqueId, keyContentId: string | null): boolean {
  if (keyContentId === null) return false;
  return heldByActor(run, actorId).some((item) => item.contentId === keyContentId);
}

function unlockedDoor(door: DoorFeature): DoorFeature {
  // A `closed` door must not carry a `lock` record: the save schema enforces the lock is
  // present if and only if the door is `locked`, so the payload is dropped on unlock.
  return {
    featureId: door.featureId,
    floorId: door.floorId,
    x: door.x,
    y: door.y,
    contentId: door.contentId,
    coverTileId: door.coverTileId,
    type: 'door',
    state: 'closed',
  };
}

function openedChest(chest: ChestFeature, state: 'looted' | 'jammed'): ChestFeature {
  // A `looted`/`jammed` chest holds no live lock or loot pointer, matching the save-schema
  // cross-validation that forbids either on a terminal chest.
  return {
    featureId: chest.featureId,
    floorId: chest.floorId,
    x: chest.x,
    y: chest.y,
    contentId: chest.contentId,
    coverTileId: chest.coverTileId,
    type: 'chest',
    state,
    lock: null,
    lootTableId: null,
    lootContentId: null,
  };
}

function materialiseChestLoot(
  run: ActiveRun,
  content: CompiledContentPack,
  chest: ChestFeature,
): Readonly<{ run: ActiveRun; created: readonly ItemInstance[] }> {
  const itemIdPrefix = `item.chest.${chest.featureId}`;
  let lootState = run.rng.loot;
  let created: readonly ItemInstance[] = [];
  if (chest.lootTableId !== null) {
    const loot = createFloorLootFromTable({
      content,
      tableId: chest.lootTableId,
      state: run.rng.loot,
      itemIdPrefix,
      floorId: chest.floorId,
      x: chest.x,
      y: chest.y,
    });
    lootState = loot.state;
    created = loot.items;
  } else if (chest.lootContentId !== null) {
    created = [
      createFloorItem({
        content,
        contentId: chest.lootContentId,
        itemId: itemIdPrefix,
        floorId: chest.floorId,
        x: chest.x,
        y: chest.y,
      }),
    ];
  }
  for (const item of created)
    if (run.items.some((entry) => entry.itemId === item.itemId))
      throw new Error(`internal invariant: chest loot item ${item.itemId} already exists`);
  const items =
    created.length === 0
      ? run.items
      : [...run.items, ...created].sort((left, right) =>
          compareCodeUnits(left.itemId, right.itemId),
        );
  return {
    run: { ...run, items, rng: { ...run.rng, loot: lootState } },
    created,
  };
}

export function pickLock(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    featureId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ run: ActiveRun; events: readonly DomainEvent[] }> {
  const { run, content, eventId } = input;
  const actor = actorById(run, input.actorId);
  const feature = run.features.find((candidate) => candidate.featureId === input.featureId);
  if (
    !actor ||
    !feature ||
    (feature.type !== 'door' && feature.type !== 'chest') ||
    feature.state !== 'locked' ||
    feature.floorId !== actor.floorId ||
    Math.max(Math.abs(feature.x - actor.x), Math.abs(feature.y - actor.y)) !== 1
  )
    throw new Error('lock is unavailable');
  const lock = feature.lock;
  if (!lock) throw new Error('internal invariant: locked feature has no lock data');

  if (feature.type === 'door' && actorHoldsKey(run, actor.actorId, lock.keyContentId)) {
    return {
      run: replaceFeature(run, unlockedDoor(feature)),
      events: [
        { type: 'door.unlocked', eventId, actorId: actor.actorId, featureId: feature.featureId },
      ],
    };
  }

  const balance = content.entries.find((entry) => entry.kind === 'balance')!;
  // Uses `deriveActorStats` directly, NOT `deriveRunActorStats`: the latter folds in hunger,
  // which must not shift a lock's difficulty (same nuance the trap disarm check documents).
  const stats = deriveActorStats({
    attributes: actor.attributes,
    formulas: balance.formulas,
    equipmentModifiers: equipmentModifiers({ run, content, actorId: actor.actorId }).map(
      (source) => source.modifiers,
    ),
    conditionModifiers: conditionModifiers(actor, content),
    heroModifiers: actor.actorId === run.hero.actorId ? [run.hero.statModifiers] : [],
  });
  const rolled = rollDie(run.rng.effects, 20);
  const rolledRun = withRngStream(run, 'effects', rolled.state);
  const total = rolled.value + stats.disarm;

  // A natural 1 always fails, even when the modifier would otherwise clear the difficulty,
  // matching the trap disarm check.
  if (rolled.value !== 1 && total >= lock.difficulty) {
    if (feature.type === 'door') {
      return {
        run: replaceFeature(rolledRun, unlockedDoor(feature)),
        events: [
          { type: 'lock.picked', eventId, actorId: actor.actorId, featureId: feature.featureId },
        ],
      };
    }
    const looted = materialiseChestLoot(rolledRun, content, feature);
    const events: DomainEvent[] = [
      { type: 'lock.picked', eventId, actorId: actor.actorId, featureId: feature.featureId },
    ];
    if (looted.created.length > 0)
      events.push({
        type: 'loot.dropped',
        eventId,
        actorId: actor.actorId,
        contentId: actor.contentId,
        x: feature.x,
        y: feature.y,
        itemIds: looted.created.map((item) => item.itemId).sort(compareCodeUnits),
      });
    return { run: replaceFeature(looted.run, openedChest(feature, 'looted')), events };
  }

  if (rolled.value === 1 && feature.type === 'chest') {
    return {
      run: replaceFeature(rolledRun, openedChest(feature, 'jammed')),
      events: [
        { type: 'chest.jammed', eventId, actorId: actor.actorId, featureId: feature.featureId },
      ],
    };
  }

  const pick = actorLockpicks(rolledRun, content, actor.actorId)[0];
  if (!pick) throw new Error('internal invariant: ordinary lock failure requires a lockpick');
  const consumed = consumeItemQuantity({ run: rolledRun, itemId: pick.itemId, quantity: 1 });
  if (!consumed.ok)
    throw new Error(`internal invariant: lockpick consume failed with ${consumed.reason}`);
  return {
    run: consumed.run,
    events: [
      { type: 'item.consumed', eventId, actorId: actor.actorId, itemId: pick.itemId, quantity: 1 },
      { type: 'lock.pick-failed', eventId, actorId: actor.actorId, featureId: feature.featureId },
    ],
  };
}

export function projectFeature(
  feature: DungeonFeature,
  actorId: OpaqueId,
): Readonly<Record<string, unknown>> | undefined {
  if (feature.type === 'door' || feature.type === 'chest')
    return {
      featureId: feature.featureId,
      type: feature.type,
      state: feature.state,
      x: feature.x,
      y: feature.y,
    };
  if (!discovered(feature, actorId))
    return feature.type === 'secret'
      ? { type: 'terrain-cover', tileId: feature.coverTileId, x: feature.x, y: feature.y }
      : undefined;
  return {
    featureId: feature.featureId,
    type: feature.type,
    state: feature.state,
    x: feature.x,
    y: feature.y,
  };
}
