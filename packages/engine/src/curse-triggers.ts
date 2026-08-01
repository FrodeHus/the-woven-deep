import type {
  CompiledContentPack,
  CurseContentEntry,
  CurseTriggerEvent,
  EffectDefinition,
} from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import { revealItemCurse } from './curse.js';
import { applyEffectResult, resolveEffectSequence, withRngStream } from './effects.js';
import { EQUIPMENT_SLOT_ORDER } from './equipment.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import { rollDie } from './random.js';

/** Basis-point resolution of a curse trigger's `chanceBps` roll: 10000 bps == always. */
const BPS_RESOLUTION = 10000;

/**
 * Direction a curse-fired `effect.force-move` shoves the hero. Curse triggers always target the
 * hero as both source and target, and `resolveEffectSequence` demands a nonzero unit direction for
 * any force-move, so there is no attacker-to-target vector to derive one from. Matches the
 * engine-wide convention for self-targeted effect resolution (see `action-dispatch.ts`'s cast
 * handlers and `condition-tick.ts`).
 */
const CURSE_FORCE_MOVE_DIRECTION = { x: 1, y: 0 } as const;

function curseDefinition(content: CompiledContentPack, curseId: OpaqueId): CurseContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === curseId);
  if (!entry || entry.kind !== 'curse') {
    throw new Error(`internal invariant: curse definition ${curseId} does not exist`);
  }
  return entry;
}

/**
 * The hero's equipped cursed items, in `EQUIPMENT_SLOT_ORDER` and de-duplicated by itemId (a
 * two-handed item occupies two slots but is one item, and must roll once). That ordering is the
 * whole determinism contract of the post-pass: every curse rolls off the same effects stream in
 * this fixed sequence, so a replay of the same command draws the same values in the same order.
 */
function equippedCursedItems(state: ActiveRun): readonly ItemInstance[] {
  const hero = heroActor(state);
  const ordered: ItemInstance[] = [];
  for (const slot of EQUIPMENT_SLOT_ORDER) {
    const itemId = hero.equipment[slot];
    if (!itemId || ordered.some((item) => item.itemId === itemId)) continue;
    const item = state.items.find((candidate) => candidate.itemId === itemId);
    if (!item) throw new Error(`internal invariant: equipped item ${itemId} does not exist`);
    if (item.curse !== undefined) ordered.push(item);
  }
  return ordered;
}

/**
 * Which of the three trigger events the command's emitted events satisfy. Computed once over the
 * whole event list, which is what caps every curse at one firing per command even when several
 * qualifying events land in the same transition.
 *
 * `on-hurt-below-half` is the crossing, not the state: the hero must have been at or above half
 * `maxHealth` before the damage and strictly below it after. Pre-damage health is reconstructed
 * from the event (`health + amount`) rather than read off the state, because by the time the
 * post-pass runs the state already reflects every event in the list.
 */
function matchedTriggers(state: ActiveRun, events: readonly DomainEvent[]): ReadonlySet<string> {
  const hero = heroActor(state);
  const matched = new Set<CurseTriggerEvent>();
  for (const event of events) {
    if (event.type === 'actor.died' && event.killerActorId === hero.actorId) {
      matched.add('on-kill');
    } else if (event.type === 'actor.damaged' && event.actorId === hero.actorId) {
      const before = event.health + event.amount;
      if (!Number.isSafeInteger(before)) throw new RangeError('damage crossing overflowed');
      if (2 * event.health < hero.maxHealth && 2 * before >= hero.maxHealth) {
        matched.add('on-hurt-below-half');
      }
    } else if (event.type === 'floor.entered') {
      matched.add('on-floor-enter');
    }
  }
  return matched;
}

function fireTrigger(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    itemId: OpaqueId;
    effect: EffectDefinition;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  // A trigger firing also reveals: the hero learns what is on them the moment it bites, even if
  // some path equipped the item without revealing it.
  const revealed = revealItemCurse({
    run: input.state,
    content: input.content,
    itemId: input.itemId,
    eventId: input.eventId,
  });
  const hero = heroActor(revealed.state);
  const resolved = resolveEffectSequence({
    effects: [input.effect],
    actors: revealed.state.actors,
    items: revealed.state.items,
    features: revealed.state.features,
    floors: revealed.state.floors,
    content: input.content,
    sourceActorId: hero.actorId,
    targetActorId: hero.actorId,
    effectsState: revealed.state.rng.effects,
    worldTime: revealed.state.worldTime,
    eventId: input.eventId,
    survival: revealed.state.survival,
    survivalActorId: revealed.state.hero.actorId,
    forceMoveDirection: CURSE_FORCE_MOVE_DIRECTION,
    // Every effect a curse trigger may declare is a member of `DIRECT_EFFECTS`
    // (`CURSE_TRIGGER_EFFECT_IDS` is validated against that set at compile time), so no operation
    // table is needed and `resolveEffectSequence` cannot reject the effect as unavailable.
    operations: {},
  });
  return {
    state: applyEffectResult(revealed.state, resolved),
    events: [...revealed.events, ...resolved.events],
  };
}

/**
 * Scans one command's (or one floor transition's) emitted DomainEvents once and fires every
 * equipped curse whose trigger matches. Pure: state in, state + appended events out. Each equipped
 * curse fires at most once even when several events would match it; a single event can fire several
 * distinct equipped curses. Chance rolls and effect resolution both draw from the `effects` stream,
 * in equipped-slot order, so the sequence is stable.
 *
 * Never fires -- and never touches any RNG stream -- for a concluded run or a hero already at zero
 * health, for an unequipped cursed item, or for a curse whose definition declares no trigger.
 * Revealed-ness gates nothing: an equipped curse that fires reveals itself in the same pass.
 */
export function applyCurseTriggers(
  input: Readonly<{
    state: ActiveRun;
    content: CompiledContentPack;
    events: readonly DomainEvent[];
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  if (input.state.conclusion !== null || heroActor(input.state).health === 0) {
    return { state: input.state, events: [] };
  }
  const candidates = equippedCursedItems(input.state);
  if (candidates.length === 0) return { state: input.state, events: [] };
  const matched = matchedTriggers(input.state, input.events);
  if (matched.size === 0) return { state: input.state, events: [] };

  let state = input.state;
  const events: DomainEvent[] = [];
  for (const candidate of candidates) {
    // A curse that just killed the hero ends the pass: the same "a dead hero never triggers" rule
    // that guards the entry above applies mid-loop, so no later curse rolls off a corpse.
    if (heroActor(state).health === 0) break;
    const trigger = curseDefinition(input.content, candidate.curse!.curseId).trigger;
    if (trigger === null || !matched.has(trigger.on)) continue;
    const roll = rollDie(state.rng.effects, BPS_RESOLUTION);
    state = withRngStream(state, 'effects', roll.state);
    if (roll.value > trigger.chanceBps) continue;
    const fired = fireTrigger({
      state,
      content: input.content,
      itemId: candidate.itemId,
      effect: trigger.effect,
      eventId: input.eventId,
    });
    state = fired.state;
    events.push(...fired.events);
  }
  return { state, events };
}
