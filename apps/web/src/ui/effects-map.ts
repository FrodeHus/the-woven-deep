import type { OpaqueId, PublicEvent } from '@woven-deep/engine';

export interface TransientEffect {
  readonly key: string;
  readonly kind: 'hit-flash' | 'attack-streak' | 'death-burst';
  readonly x: number;
  readonly y: number;
  readonly toX?: number;
  readonly toY?: number;
}

export const MAX_TRANSIENT_EFFECTS = 12;

export type ActorPositions = ReadonlyMap<OpaqueId, Readonly<{ x: number; y: number }>>;

/** Mirrors `projection.hero.conditions` (`packages/engine/src/projection.ts:566-567`) -- the ONLY
 * per-condition data the client ever receives is `{conditionId, name, color, stacks, remaining}`;
 * actor conditions (non-hero) are NOT projected at all, so the aura/badge this module supports can
 * only ever represent the HERO's own conditions, never an NPC's. */
export interface ProjectedCondition {
  readonly conditionId: string;
  readonly name: string;
  readonly color: string;
  readonly stacks: number;
  readonly remaining: number | null;
}

/**
 * Picks the ONE condition an aura/badge represents when several are simultaneously active:
 * highest `stacks` wins; a tie (including the common all-1-stack case) falls back to array order,
 * i.e. the hero's first-listed condition -- there is no severity ranking in the projection to
 * break the tie any other way, and inventing one here would be presenting an opinion as engine
 * truth. Disclosed simplification, per the brief ("multiple conditions -> the highest-stacks or
 * first"): a hero with several active conditions only ever shows ONE tint/glyph at a time.
 */
export function pickPrimaryCondition(
  conditions: readonly ProjectedCondition[],
): ProjectedCondition | undefined {
  if (conditions.length === 0) return undefined;
  return conditions.reduce((best, candidate) =>
    candidate.stacks > best.stacks ? candidate : best,
  );
}

/**
 * Maps one snapshot's hero-visible public events to transient world-coordinate effects.
 *
 * NOTE on the `positions` parameter: `PublicEvent` itself carries no position for most combat
 * kinds (`actor.damaged`, `combat.observed`, `actor.died`, and their partial-visibility variants
 * expose only actor identifiers, never x/y — confirmed against `packages/engine/src/model.ts`).
 * Only `ItemThrownEvent` embeds a point (`to`). Since `TransientEffect` must report world
 * coordinates, this mapping needs a last-known actor/hero position lookup that the caller
 * maintains across renders (actors that just died are already gone from the current
 * `GameplayProjection`, so their death position must come from a snapshot taken before they were
 * removed). `EffectsLayer` owns that lookup and passes it in here; this is a disclosed deviation
 * from the brief's literal two-argument signature, made because the two-argument form cannot
 * satisfy "hit-flash at the target cell" / "death-burst" for any event that lacks an embedded
 * point.
 */
export function effectsForEvents(
  events: readonly PublicEvent[],
  heroId: OpaqueId,
  positions: ActorPositions = new Map(),
): readonly TransientEffect[] {
  const effects: TransientEffect[] = [];

  const at = (actorId: OpaqueId): Readonly<{ x: number; y: number }> | undefined =>
    positions.get(actorId);

  /*
   * Ember-bolt / spell-cast discriminator (Task 7 finding): `CombatObservedPublicEvent` -- the
   * only event any spell attack, ember-bolt included, ever produces -- carries exactly
   * `{outcome, attackerActorId, targetActorId, attackerName?, targetName?}` and NO spell/weapon
   * id (verified against `packages/engine/src/model.ts`; `CastCommand.spellId` never survives
   * into any `PublicEvent`, and no field on `CombatObservedPublicEvent` distinguishes a spell
   * cast from a melee swing). `ItemThrownEvent` DOES carry an `itemId`, but that identifies a
   * thrown ITEM, not a cast spell -- ember-bolt is cast, never thrown, so it never produces that
   * event either. There is therefore no honest discriminator to key a distinct warm ember-bolt
   * streak off: every spell and every melee attack collapses onto the same generic
   * 'attack-streak' kind below. This is a disclosed limitation, not an oversight -- do not fake
   * one by guessing from `attackerName`/`targetName` text.
   *
   * Root cause is one layer deeper than projection: the DOMAIN events `AttackHitEvent`/
   * `AttackMissedEvent` never capture a spell/weapon id either (the reducer discards
   * `CastCommand.spellId` before any event is emitted), so a future fix must widen the
   * domain-event shape in the reducer, not just `projectDomainEvents`.
   */
  events.forEach((event, index) => {
    const key = `${event.type}-${index}`;
    switch (event.type) {
      case 'hero.damaged': {
        const origin = at(heroId);
        if (origin) effects.push({ key, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.damaged': {
        const origin = at(event.actorId);
        if (origin)
          effects.push({ key: event.eventId, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.damage-observed': {
        const origin = at(event.actorId);
        if (origin)
          effects.push({ key: event.eventId, kind: 'hit-flash', x: origin.x, y: origin.y });
        break;
      }
      case 'combat.observed': {
        const from = at(event.attackerActorId);
        const to = at(event.targetActorId);
        if (from && to) {
          effects.push({
            key: event.eventId,
            kind: 'attack-streak',
            x: from.x,
            y: from.y,
            toX: to.x,
            toY: to.y,
          });
        }
        break;
      }
      case 'item.thrown': {
        const from = at(event.actorId);
        if (from) {
          effects.push({
            key: event.eventId,
            kind: 'attack-streak',
            x: from.x,
            y: from.y,
            toX: event.to.x,
            toY: event.to.y,
          });
        }
        break;
      }
      case 'actor.died': {
        const origin = at(event.actorId);
        if (origin)
          effects.push({ key: event.eventId, kind: 'death-burst', x: origin.x, y: origin.y });
        break;
      }
      case 'actor.death-observed': {
        const origin = at(event.actorId);
        if (origin)
          effects.push({ key: event.eventId, kind: 'death-burst', x: origin.x, y: origin.y });
        break;
      }
      default:
        break;
    }
  });

  return effects.length > MAX_TRANSIENT_EFFECTS ? effects.slice(-MAX_TRANSIENT_EFFECTS) : effects;
}
