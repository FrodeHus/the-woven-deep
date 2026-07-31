import type { CompiledContentPack, MonsterContentEntry } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { balanceEntry } from './balance.js';
import { entryById } from './content-index.js';
import { applyCurseRolls } from './curse-generation.js';
import { withRngStream } from './effects.js';
import { createFloorLootFromTable } from './inventory.js';
import { depthBandFor } from './loot-placement.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import { rollDie } from './random.js';
import { compareCodeUnits } from './stable-json.js';

const DROP_CHANCE_RESOLUTION = 10_000;

function monsterEntry(
  content: CompiledContentPack,
  contentId: OpaqueId,
): MonsterContentEntry | undefined {
  const entry = entryById(content, contentId);
  return entry?.kind === 'monster' ? entry : undefined;
}

export function dropMonsterLoot(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    deadActor: ActorState;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const monster = monsterEntry(input.content, input.deadActor.contentId);
  if (!monster || monster.lootTableId === null) return { state: input.state, events: [] };

  const chance = rollDie(input.state.rng.loot, DROP_CHANCE_RESOLUTION);
  const threshold = Math.round(monster.dropChance * DROP_CHANCE_RESOLUTION);
  if (chance.value > threshold) {
    return { state: withRngStream(input.state, 'loot', chance.state), events: [] };
  }

  const floor = input.state.floors.find(
    (candidate) => candidate.floorId === input.deadActor.floorId,
  )!;
  const loot = createFloorLootFromTable({
    content: input.content,
    tableId: monster.lootTableId,
    state: chance.state,
    itemIdPrefix: `item.drop.${input.deadActor.actorId}`,
    floorId: input.deadActor.floorId,
    x: input.deadActor.x,
    y: input.deadActor.y,
    depth: floor.depth,
  });
  const band = depthBandFor(floor.depth, balanceEntry(input.content).floorLoot.depthBands);
  const cursed = applyCurseRolls({
    content: input.content,
    items: loot.items,
    band,
    state: loot.state,
  });

  if (cursed.items.length === 0) {
    return { state: withRngStream(input.state, 'loot', cursed.state), events: [] };
  }
  for (const item of cursed.items)
    if (input.state.items.some((entry) => entry.itemId === item.itemId)) {
      throw new Error(`internal invariant: monster loot item ${item.itemId} already exists`);
    }
  const items = [...input.state.items, ...cursed.items].sort((left, right) =>
    compareCodeUnits(left.itemId, right.itemId),
  );
  const itemIds = cursed.items.map((item) => item.itemId).sort(compareCodeUnits);
  return {
    state: { ...input.state, items, rng: { ...input.state.rng, loot: cursed.state } },
    events: [
      {
        type: 'loot.dropped',
        eventId: input.eventId,
        actorId: input.deadActor.actorId,
        contentId: input.deadActor.contentId,
        x: input.deadActor.x,
        y: input.deadActor.y,
        itemIds,
      },
    ],
  };
}
