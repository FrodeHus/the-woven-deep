import type {
  BalanceContentEntry,
  CompiledContentPack,
  ItemContentEntry,
} from '@woven-deep/content';
import { replaceActor } from './actor-model.js';
import { actorHasConditionTrait, advanceConditions, conditionModifiers } from './conditions.js';
import { deriveActorStats, type DerivedStatModifier } from './attributes.js';
import { equipmentModifiers } from './equipment.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { HungerStage, SurvivalState } from './survival-model.js';

const STAGES: readonly HungerStage[] = ['sated', 'hungry', 'weak', 'starving'];

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function balanceEntry(content: CompiledContentPack): BalanceContentEntry {
  const entries = content.entries.filter(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (entries.length !== 1)
    throw new Error(`internal invariant: expected one balance entry; found ${entries.length}`);
  return entries[0]!;
}

function itemDefinition(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item')
    throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry;
}

export function hungerStage(
  input: Readonly<{
    reserve: number;
    thresholds: Readonly<{ hungry: number; weak: number; starving: number }>;
  }>,
): HungerStage {
  if (!Number.isSafeInteger(input.reserve) || input.reserve < 0) {
    throw new RangeError('hunger reserve must be a non-negative safe integer');
  }
  const { hungry, weak, starving } = input.thresholds;
  if (!(
    Number.isSafeInteger(hungry) &&
    Number.isSafeInteger(weak) &&
    Number.isSafeInteger(starving) &&
    starving <= weak &&
    weak <= hungry
  )) {
    throw new RangeError('hunger thresholds must satisfy starving <= weak <= hungry');
  }
  if (input.reserve <= starving) return 'starving';
  if (input.reserve <= weak) return 'weak';
  if (input.reserve <= hungry) return 'hungry';
  return 'sated';
}

export function hungerModifiers(
  input: Readonly<{
    stage: HungerStage;
    balance: BalanceContentEntry;
  }>,
): DerivedStatModifier {
  return { ...input.balance.hungerStageModifiers[input.stage] };
}

export function restoreHunger(
  input: Readonly<{
    survival: SurvivalState;
    amount: number;
    maximum: number;
    thresholds: BalanceContentEntry['hungerThresholds'];
    actorId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ survival: SurvivalState; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
    throw new RangeError('hunger restoration must be a non-negative safe integer');
  }
  const amount = Math.min(input.amount, Math.max(0, input.maximum - input.survival.hungerReserve));
  const reserve = safeInteger('restored hunger reserve', input.survival.hungerReserve + amount);
  const stage = hungerStage({ reserve, thresholds: input.thresholds });
  return {
    survival: {
      ...input.survival,
      hungerReserve: reserve,
      hungerStage: stage,
      nextStarvationAt: stage === 'starving' ? input.survival.nextStarvationAt : null,
    },
    events: [
      { type: 'hunger.restored', eventId: input.eventId, actorId: input.actorId, amount, reserve },
    ],
  };
}

export function consumeFuel(
  input: Readonly<{
    items: readonly ItemInstance[];
    content: CompiledContentPack;
    elapsed: number;
    emittedWarnings: readonly string[];
    eventId: OpaqueId;
  }>,
): Readonly<{
  items: readonly ItemInstance[];
  emittedWarnings: readonly string[];
  events: readonly DomainEvent[];
}> {
  if (!Number.isSafeInteger(input.elapsed) || input.elapsed < 0) {
    throw new RangeError('fuel elapsed time must be a non-negative safe integer');
  }
  const emitted = new Set(input.emittedWarnings);
  const events: DomainEvent[] = [];
  const updated = new Map<OpaqueId, ItemInstance>();
  const active = input.items
    .filter(
      (item) =>
        item.enabled === true &&
        (item.fuel ?? 0) > 0 &&
        (item.location.type === 'equipped' || item.location.type === 'floor'),
    )
    .sort((left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
  for (const item of active) {
    const light = itemDefinition(input.content, item.contentId).light;
    if (!light) continue;
    const previous = item.fuel!;
    const consumed = safeInteger(`${item.itemId} fuel consumed`, input.elapsed * light.fuelPerTime);
    const fuel = Math.max(0, previous - consumed);
    for (const threshold of [...light.warningThresholds].sort((left, right) => right - left)) {
      const warningId = `${item.itemId}:${threshold}`;
      if (previous > threshold && fuel <= threshold && !emitted.has(warningId)) {
        emitted.add(warningId);
        events.push({
          type: 'fuel.warning',
          eventId: input.eventId,
          itemId: item.itemId,
          threshold,
          fuel,
        });
      }
    }
    const enabled = fuel > 0;
    updated.set(item.itemId, { ...item, fuel, enabled });
    if (previous > 0 && fuel === 0) {
      events.push({ type: 'item.light-extinguished', eventId: input.eventId, itemId: item.itemId });
    }
  }
  return {
    items: input.items.map((item) => updated.get(item.itemId) ?? item),
    emittedWarnings: [...emitted].sort(),
    events,
  };
}

export function advanceSurvival(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    elapsed: number;
    eventId: OpaqueId;
    danger: boolean;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  if (!Number.isSafeInteger(input.elapsed) || input.elapsed < 0) {
    throw new RangeError('survival elapsed time must be a non-negative safe integer');
  }
  const startTime = safeInteger('survival start time', input.state.worldTime - input.elapsed);
  if (startTime < 0) throw new RangeError('survival elapsed time cannot exceed world time');
  const balance = balanceEntry(input.content);
  const heroId = input.state.hero.actorId;
  let actors = [...input.state.actors];
  let hero = actors.find((actor) => actor.actorId === heroId);
  if (!hero) throw new Error(`internal invariant: hero actor ${heroId} does not exist`);
  const events: DomainEvent[] = [];

  const previousReserve = input.state.survival.hungerReserve;
  const reserve = Math.max(
    0,
    safeInteger('hunger reserve after elapsed time', previousReserve - input.elapsed),
  );
  const previousStage = input.state.survival.hungerStage;
  const stage = hungerStage({ reserve, thresholds: balance.hungerThresholds });
  const emittedStages = new Set(input.state.survival.emittedHungerWarnings);
  const previousIndex = STAGES.indexOf(previousStage);
  const stageIndex = STAGES.indexOf(stage);
  if (stageIndex > previousIndex) {
    for (let index = previousIndex + 1; index <= stageIndex; index += 1) {
      const crossed = STAGES[index]!;
      if (emittedStages.has(crossed)) continue;
      emittedStages.add(crossed);
      events.push({
        type: 'hunger.stage-changed',
        eventId: input.eventId,
        actorId: heroId,
        previousStage: STAGES[index - 1]!,
        stage: crossed,
        reserve,
      });
    }
  }

  let nextStarvationAt = input.state.survival.nextStarvationAt;
  if (stage !== 'starving') nextStarvationAt = null;
  else if (previousStage !== 'starving' || nextStarvationAt === null) {
    const timeToStarving = Math.max(0, previousReserve - balance.hungerThresholds.starving);
    nextStarvationAt = safeInteger(
      'next starvation deadline',
      startTime + timeToStarving + balance.starvationInterval,
    );
  }
  while (
    nextStarvationAt !== null &&
    nextStarvationAt <= input.state.worldTime &&
    hero.health > 0
  ) {
    const health = Math.max(0, hero.health - balance.starvationDamage);
    events.push({
      type: 'actor.damaged',
      eventId: input.eventId,
      actorId: heroId,
      sourceActorId: heroId,
      amount: hero.health - health,
      health,
    });
    if (health === 0)
      events.push({
        type: 'actor.died',
        eventId: input.eventId,
        actorId: heroId,
        contentId: hero.contentId,
        killerActorId: heroId,
      });
    hero = { ...hero, health };
    actors = [...replaceActor(actors, hero)];
    nextStarvationAt = safeInteger(
      'next starvation deadline',
      nextStarvationAt + balance.starvationInterval,
    );
  }

  const fuel = consumeFuel({
    items: input.state.items,
    content: input.content,
    elapsed: input.elapsed,
    emittedWarnings: input.state.survival.emittedFuelWarnings,
    eventId: input.eventId,
  });
  events.push(...fuel.events);

  const conditions = advanceConditions({
    actors,
    worldTime: input.state.worldTime,
    eventId: input.eventId,
  });
  actors = [...conditions.actors];
  hero = actors.find((actor) => actor.actorId === heroId)!;
  events.push(...conditions.events);

  if (
    !input.danger &&
    hero.health > 0 &&
    !actorHasConditionTrait(hero, 'condition-trait.blocks-recovery', input.content)
  ) {
    const intervals =
      Math.floor(input.state.worldTime / balance.recoveryInterval) -
      Math.floor(startTime / balance.recoveryInterval);
    const percentage = balance.recoveryByHungerStage[stage];
    for (let index = 0; index < intervals; index += 1) {
      const requested = Math.floor((balance.recoveryAmount * percentage) / 100);
      const amount = Math.min(requested, hero.maxHealth - hero.health);
      if (amount <= 0) continue;
      hero = { ...hero, health: hero.health + amount };
      actors = [...replaceActor(actors, hero)];
      events.push({
        type: 'actor.healed',
        eventId: input.eventId,
        actorId: heroId,
        sourceActorId: heroId,
        amount,
        health: hero.health,
      });
    }
    // The Weave trickles back over the same recovery intervals, clamped to the derived maximum.
    // Deterministic and RNG-free, mirroring the health recovery above. The regen rate is the
    // hero's derived `weaveRegen` (base `weaveRegenAmount` plus equipment/condition/class
    // modifiers), not the raw balance constant, so class modifiers can boost it.
    const heroStats = deriveActorStats({
      attributes: hero.attributes,
      formulas: balance.formulas,
      weaveRegenAmount: balance.weaveRegenAmount,
      equipmentModifiers: equipmentModifiers({
        run: { actors, items: input.state.items },
        content: input.content,
        actorId: heroId,
      }).map((source) => source.modifiers),
      conditionModifiers: conditionModifiers(hero, input.content),
      heroModifiers: [input.state.hero.statModifiers],
    });
    const weaveRestored = Math.min(
      safeInteger('weave regen', heroStats.weaveRegen * intervals),
      hero.maxWeave - hero.weave,
    );
    if (weaveRestored > 0) {
      hero = { ...hero, weave: hero.weave + weaveRestored };
      actors = [...replaceActor(actors, hero)];
    }
  }

  const survival: SurvivalState = {
    hungerReserve: reserve,
    hungerStage: stage,
    nextStarvationAt,
    emittedHungerWarnings: [...emittedStages],
    emittedFuelWarnings: fuel.emittedWarnings,
  };
  return { state: { ...input.state, actors, items: fuel.items, survival }, events };
}
