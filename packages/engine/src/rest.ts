import type { CompiledContentPack } from '@woven-deep/content';
import { actionCostFor, balanceEntry } from './actions.js';
import { actorHasConditionTrait, conditionDefinition } from './conditions.js';
import { heroActor, withActor } from './actor-model.js';
import { advanceMerchantLifecycle, scrubDepartedIntentEvents } from './merchant-lifecycle.js';
import { heroFloorPerception } from './run-perception.js';
import { projectDomainEvents } from './event-projection.js';
import { relationshipBetween } from './reactions.js';
import { resolveWorldStep } from './world-step.js';
import type { ActiveRun, DomainEvent, OpaqueId, PublicEvent, RestCompletedEvent } from './model.js';
import { tileIndex } from './model.js';
import { isVisible } from './visibility.js';

export type RestStopReason =
  | 'full-health'
  | 'maximum-duration'
  | 'visible-danger'
  | 'aware-hostile'
  | 'damage'
  | 'meaningful-sound'
  | 'hunger-warning'
  | 'fuel-warning'
  | 'condition-change'
  | 'decision-required'
  | 'hero-death';

export interface RestObservation {
  readonly fullHealth: boolean;
  readonly maximumDurationReached: boolean;
  readonly visibleDanger: boolean;
  readonly awareHostile: boolean;
  readonly damaged: boolean;
  readonly forcedMovement: boolean;
  readonly meaningfulSound: boolean;
  readonly hungerWarning: boolean;
  readonly fuelWarning: boolean;
  readonly interruptingConditionChanged: boolean;
  readonly decisionRequired: boolean;
  readonly heroDead: boolean;
}

// A rest that runs its course (heals to full or hits the duration cap) also restores the Weave to
// full, mirroring the heal-to-full; a rest cut short by danger, damage, or a warning does not.
function restedToCompletion(reason: RestStopReason): boolean {
  return reason === 'full-health' || reason === 'maximum-duration';
}

function restoreHeroWeaveToFull(state: ActiveRun): ActiveRun {
  const hero = heroActor(state);
  return hero.weave === hero.maxWeave ? state : withActor(state, { ...hero, weave: hero.maxWeave });
}

export function restStopReason(observation: RestObservation): RestStopReason | null {
  if (observation.fullHealth) return 'full-health';
  if (observation.maximumDurationReached) return 'maximum-duration';
  if (observation.visibleDanger) return 'visible-danger';
  if (observation.awareHostile) return 'aware-hostile';
  if (observation.damaged || observation.forcedMovement) return 'damage';
  if (observation.meaningfulSound) return 'meaningful-sound';
  if (observation.hungerWarning) return 'hunger-warning';
  if (observation.fuelWarning) return 'fuel-warning';
  if (observation.interruptingConditionChanged) return 'condition-change';
  if (observation.decisionRequired) return 'decision-required';
  if (observation.heroDead) return 'hero-death';
  return null;
}

function danger(
  state: ActiveRun,
  content: CompiledContentPack,
): Pick<RestObservation, 'visibleDanger' | 'awareHostile'> {
  const hero = heroActor(state);
  const floor = state.floors.find((candidate) => candidate.floorId === hero.floorId);
  if (!floor) throw new Error(`internal invariant: active floor ${hero.floorId} is missing`);
  const perception = heroFloorPerception({ state, content });
  let visibleDanger = false;
  let awareHostile = false;
  for (const actor of state.actors) {
    if (
      actor.actorId === hero.actorId ||
      actor.floorId !== hero.floorId ||
      actor.health === 0 ||
      relationshipBetween(state, hero.actorId, actor.actorId) !== 'hostile'
    )
      continue;
    awareHostile ||= actor.awareActorIds.includes(hero.actorId);
    const index = tileIndex(floor, actor.x, actor.y);
    visibleDanger ||=
      index !== undefined &&
      isVisible(perception.visibilityWords, index) &&
      perception.illumination.intensity[index]! > 0;
  }
  return { visibleDanger, awareHostile };
}

function hasInterruptingCondition(state: ActiveRun, content: CompiledContentPack): boolean {
  return actorHasConditionTrait(heroActor(state), 'condition-trait.interrupts-rest', content);
}

function interruptingConditionKey(state: ActiveRun, content: CompiledContentPack): string {
  return heroActor(state)
    .conditions.filter((condition) =>
      conditionDefinition(content, condition.conditionId).traits.includes(
        'condition-trait.interrupts-rest',
      ),
    )
    .map(
      (condition) =>
        `${condition.conditionId}:${condition.stacks}:${condition.expiresAt ?? 'permanent'}`,
    )
    .sort()
    .join('|');
}

function meaningfulSound(events: readonly DomainEvent[], heroId: OpaqueId): boolean {
  return events.some(
    (event) =>
      (event.type === 'actor.moved' && event.actorId !== heroId) ||
      ((event.type === 'attack.hit' || event.type === 'attack.missed') &&
        event.actorId !== heroId) ||
      event.type === 'door.opened' ||
      event.type === 'door.closed',
  );
}

export interface RestResult {
  readonly state: ActiveRun;
  readonly events: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly stopReason: RestStopReason;
  readonly elapsed: number;
  readonly effectiveHealing: number;
}

function completedEvent(
  eventId: OpaqueId,
  stopReason: RestStopReason,
  elapsed: number,
  effectiveHealing: number,
): RestCompletedEvent {
  return { type: 'rest.completed', eventId, stopReason, elapsed, effectiveHealing };
}

export function resolveRest(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    eventId: OpaqueId;
    until: 'healed' | 'interrupted';
    maximumDuration: number;
    maxInternalActions?: number;
  }>,
): RestResult {
  if (!Number.isSafeInteger(input.maximumDuration) || input.maximumDuration <= 0) {
    throw new RangeError('rest maximum duration must be a positive safe integer');
  }
  const rules = balanceEntry(input.content);
  if (input.maximumDuration > rules.restMaximumDuration) {
    throw new RangeError(
      `rest maximum duration cannot exceed balance limit ${rules.restMaximumDuration}`,
    );
  }
  const start = input.state;
  const startHero = heroActor(start);
  const initialDanger = danger(start, input.content);
  const initialReason = restStopReason({
    fullHealth: input.until === 'healed' && startHero.health === startHero.maxHealth,
    maximumDurationReached: false,
    ...initialDanger,
    damaged: false,
    forcedMovement: false,
    meaningfulSound: false,
    hungerWarning: false,
    fuelWarning: false,
    interruptingConditionChanged: hasInterruptingCondition(start, input.content),
    decisionRequired: false,
    heroDead: startHero.health === 0,
  });
  if (initialReason) {
    // Rest that completes without a substep still observes the global merchant deadlines, so an
    // already-due merchant (e.g. straight after load) resolves at this boundary too.
    const lifecycle = advanceMerchantLifecycle({
      state: start,
      content: input.content,
      previousWorldTime: start.worldTime,
      nextWorldTime: start.worldTime,
      eventId: input.eventId,
    });
    const lifecyclePublic =
      lifecycle.events.length === 0
        ? []
        : projectDomainEvents({
            state: lifecycle.state,
            content: input.content,
            heroId: startHero.actorId,
            events: lifecycle.events,
          });
    const completed = completedEvent(input.eventId, initialReason, 0, 0);
    return {
      state: restedToCompletion(initialReason)
        ? restoreHeroWeaveToFull(lifecycle.state)
        : lifecycle.state,
      events: [...lifecycle.events, completed],
      publicEvents: [...lifecyclePublic, completed],
      stopReason: initialReason,
      elapsed: 0,
      effectiveHealing: 0,
    };
  }

  let state = start;
  let effectiveHealing = 0;
  const events: DomainEvent[] = [];
  const publicEvents: PublicEvent[] = [];
  const limit = input.maxInternalActions ?? 10_000;
  const waitCost = actionCostFor(rules, 'action.wait');
  let internalActions = 0;
  while (internalActions < limit) {
    const before = heroActor(state);
    const chargedEnergy = before.energy - waitCost;
    const nextStepDuration =
      chargedEnergy >= rules.readinessThreshold
        ? 0
        : Math.ceil((rules.readinessThreshold - chargedEnergy) / before.speed);
    const elapsedBeforeStep = state.worldTime - start.worldTime;
    if (elapsedBeforeStep + nextStepDuration > input.maximumDuration) {
      const completed = completedEvent(
        input.eventId,
        'maximum-duration',
        elapsedBeforeStep,
        effectiveHealing,
      );
      return {
        state: restoreHeroWeaveToFull(state),
        events: [...events, completed],
        publicEvents: [...publicEvents, completed],
        stopReason: 'maximum-duration',
        elapsed: elapsedBeforeStep,
        effectiveHealing,
      };
    }
    const beforeInterrupting = interruptingConditionKey(state, input.content);
    const step = resolveWorldStep({
      state,
      content: input.content,
      eventId: input.eventId,
      action: { type: 'wait', actorId: before.actorId, cost: waitCost },
      maxInternalActions: limit - internalActions - 1,
    });
    internalActions += step.internalActions + 1;
    state = step.state;
    events.push(...step.events);
    publicEvents.push(...step.publicEvents);
    // A merchant may depart in a later substep than the one that recorded its intent change;
    // scrub the whole accumulated command so no dangling actor reference is recorded.
    scrubDepartedIntentEvents({ events, publicEvents, departureEvents: step.events });
    const after = heroActor(state);
    for (const event of step.events) {
      if (event.type === 'actor.healed' && event.actorId === after.actorId)
        effectiveHealing += event.amount;
    }
    const elapsed = state.worldTime - start.worldTime;
    const currentDanger = danger(state, input.content);
    const reason = restStopReason({
      fullHealth: input.until === 'healed' && after.health === after.maxHealth,
      maximumDurationReached: elapsed >= input.maximumDuration,
      ...currentDanger,
      damaged: step.events.some(
        (event) => event.type === 'actor.damaged' && event.actorId === after.actorId,
      ),
      forcedMovement: step.events.some(
        (event) => event.type === 'actor.forced-move' && event.actorId === after.actorId,
      ),
      meaningfulSound: meaningfulSound(step.events, after.actorId),
      hungerWarning: step.events.some((event) => event.type === 'hunger.stage-changed'),
      fuelWarning: step.events.some(
        (event) => event.type === 'fuel.warning' || event.type === 'item.light-extinguished',
      ),
      interruptingConditionChanged:
        beforeInterrupting !== interruptingConditionKey(state, input.content),
      decisionRequired: false,
      heroDead: after.health === 0,
    });
    if (reason) {
      const completed = completedEvent(input.eventId, reason, elapsed, effectiveHealing);
      return {
        state: restedToCompletion(reason) ? restoreHeroWeaveToFull(state) : state,
        events: [...events, completed],
        publicEvents: [...publicEvents, completed],
        stopReason: reason,
        elapsed,
        effectiveHealing,
      };
    }
  }
  throw new Error(`rest internal action safety limit ${limit} exceeded`);
}
