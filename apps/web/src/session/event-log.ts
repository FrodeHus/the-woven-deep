import type { CompiledContentPack } from '@woven-deep/content';
import type { HauntView, PublicEvent } from '@woven-deep/engine';
import { hauntDisplayName, hauntEncounterLine, hauntFarewellLine } from './haunt-lines.js';

/** A spell entry's name, or the honest degradation `haunt-lines.ts`'s `killerPhrase` uses for a
 * content-drifted id -- a `spell.cast` event outlives the pack it was cast against exactly the
 * way a kill record does. */
function spellDisplayName(pack: CompiledContentPack, spellId: string): string {
  const entry = pack.entries.find((candidate) => candidate.id === spellId);
  return entry !== undefined && entry.kind === 'spell' ? entry.name : 'a spell';
}

export interface LogLine {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'combat' | 'warning' | 'system' | 'curse';
}

export const LOG_CAPACITY = 200;

/** The projection data a haunt's spoken record line reads from -- optional so every existing
 * caller with no projection at hand (or an event stream with no haunt sightings in it) keeps
 * working unchanged; only `haunt.sighted` consults it. */
export interface LogContext {
  readonly haunts: readonly HauntView[];
  readonly pack: CompiledContentPack;
}

interface RenderedLine {
  readonly text: string;
  readonly tone: LogLine['tone'];
}

function renderEvent(event: PublicEvent, context: LogContext | undefined): RenderedLine | null {
  switch (event.type) {
    case 'actor.damaged':
      return { text: `The creature takes ${event.amount} damage.`, tone: 'combat' };
    case 'actor.died':
      return { text: 'The creature dies.', tone: 'combat' };
    case 'hero.damaged':
      return { text: `You take ${event.amount} damage.`, tone: 'combat' };
    case 'combat.observed':
      return {
        text:
          event.outcome === 'hit'
            ? `${event.attackerName ?? 'Something'} hits ${event.targetName ?? 'something'}.`
            : `${event.attackerName ?? 'Something'} misses ${event.targetName ?? 'something'}.`,
        tone: 'combat',
      };
    case 'item.picked-up':
      return { text: 'You pick up an item.', tone: 'info' };
    case 'currency.collected':
      return { text: `You gather ${event.amount} gold.`, tone: 'info' };
    case 'item.equipped':
      return { text: 'You equip an item.', tone: 'info' };
    case 'item.consumed':
      return { text: 'You consume an item.', tone: 'info' };
    case 'item.light-extinguished':
      return { text: 'Your light source goes out.', tone: 'warning' };
    case 'item.refueled':
      return { text: 'You refill your light source.', tone: 'info' };
    case 'fuel.warning':
      return {
        text: `Your light is running low on fuel (${event.fuel} remaining).`,
        tone: 'warning',
      };
    case 'hunger.stage-changed':
      return { text: `You grow more ${event.stage}.`, tone: 'warning' };
    case 'rest.completed':
      return { text: `You stop resting (${event.stopReason}).`, tone: 'info' };
    case 'feature.revealed':
      return { text: 'You spot something hidden nearby.', tone: 'info' };
    case 'door.opened':
      return { text: 'A door opens.', tone: 'info' };
    case 'door.closed':
      return { text: 'A door closes.', tone: 'info' };
    case 'trap.triggered':
      return { text: 'A trap is triggered!', tone: 'warning' };
    case 'sound.heard':
      return { text: `You hear ${event.category} to the ${event.direction}.`, tone: 'info' };
    case 'action.invalid':
      switch (event.reason) {
        case 'door.locked':
          return { text: 'The door is locked.', tone: 'system' };
        case 'door.not-adjacent':
          return { text: 'You are too far from the door.', tone: 'system' };
        case 'door.occupied':
          return { text: 'Something is blocking the doorway.', tone: 'system' };
        case 'door.already-open':
          return { text: 'The door is already open.', tone: 'system' };
        case 'door.already-closed':
          return { text: 'The door is already closed.', tone: 'system' };
        case 'door.missing':
          return { text: 'There is no door there.', tone: 'system' };
        case 'blocked.door':
          return { text: 'The door is closed.', tone: 'system' };
        case 'blocked.door-locked':
          return { text: 'The door is locked — it needs a key or a lockpick.', tone: 'system' };
        case 'blocked.chest':
          return { text: 'A chest blocks the way.', tone: 'system' };
        case 'blocked.wall':
        case 'blocked.bounds':
        case 'blocked.void':
          return { text: 'A wall blocks the way.', tone: 'system' };
        case 'blocked.pillar':
          return { text: 'A pillar blocks the way.', tone: 'system' };
        case 'blocked.corner':
          return { text: 'You cannot squeeze between those corners.', tone: 'system' };
        case 'blocked.actor':
          return { text: 'Something is in the way.', tone: 'system' };
        case 'light.inextinguishable':
          return { text: 'Its light will not be hidden.', tone: 'system' };
        case 'item.cursed':
          return { text: 'It will not come free.', tone: 'system' };
        case 'offer.refused':
          return { text: 'The haunt does not want this.', tone: 'system' };
        case 'temper.unavailable':
          return { text: 'The Deep has given you nothing to spend.', tone: 'system' };
        case 'temper.capped':
          return { text: 'That part of you can harden no further.', tone: 'system' };
        case 'signature.no-charges':
          return { text: 'The relic is spent — it will wake on the next floor.', tone: 'system' };
        default:
          return { text: `That cannot be done (${event.reason}).`, tone: 'system' };
      }
    case 'spell.learned':
      return { text: 'You learn a new spell.', tone: 'info' };
    case 'spell.cast': {
      // A seen cast only ever names the hero or a haunt (see `champion-casting.ts`: no other
      // monster carries `abilityIds`), so "not a recognized haunt actor" means "the hero" -- the
      // hero is always visible to itself, so this branch covers the hero's own casts too. Silent
      // without context, exactly like `haunt.sighted`: the spell's name lives in the content pack
      // this renderer does not otherwise carry.
      if (!context) return null;
      const spell = spellDisplayName(context.pack, event.spellId);
      const haunt = context.haunts.find((candidate) => candidate.actorId === event.actorId);
      return haunt
        ? { text: `${hauntDisplayName(haunt)} casts ${spell}.`, tone: 'combat' }
        : { text: `You cast ${spell}.`, tone: 'combat' };
    }
    case 'run.concluded':
      return { text: 'Your run has concluded.', tone: 'system' };
    case 'curse.revealed':
      return { text: event.revealText, tone: 'curse' };
    case 'curse.removed':
      return { text: 'The weight lifts. The thing is only iron again.', tone: 'curse' };
    case 'hero.tempering-banked':
      return { text: 'The Deep tempers those who dare it.', tone: 'info' };
    case 'hero.tempered':
      return {
        text: `${event.attribute.charAt(0).toUpperCase()}${event.attribute.slice(1)} hardens to ${event.value}.`,
        tone: 'info',
      };
    // Descent already narrates itself (the floor-transition UI) -- an explicit no-op case rather
    // than falling to `default` keeps this switch's coverage of `PublicEvent` honest.
    case 'floor.entered':
      return null;
    case 'haunt.sighted': {
      // Silent without context: the line is record prose the engine deliberately does not carry,
      // so a caller with no projection at hand renders nothing rather than something wrong.
      if (!context) return null;
      const haunt = context.haunts.find(
        (candidate) =>
          candidate.hallRecordId === event.hallRecordId && candidate.role === event.role,
      );
      return haunt ? { text: hauntEncounterLine(haunt, context.pack), tone: 'curse' } : null;
    }
    case 'haunt.appeased': {
      // Silent without context, exactly like `haunt.sighted` above.
      if (!context) return null;
      const haunt = context.haunts.find(
        (candidate) =>
          candidate.hallRecordId === event.hallRecordId && candidate.role === event.role,
      );
      return haunt ? { text: hauntFarewellLine(haunt), tone: 'curse' } : null;
    }
    default:
      return null;
  }
}

export function foldEventsIntoLog(
  log: readonly LogLine[],
  events: readonly PublicEvent[],
  nextId: number,
  context?: LogContext,
): Readonly<{ log: readonly LogLine[]; nextId: number }> {
  let entries = [...log];
  let id = nextId;
  for (const event of events) {
    const rendered = renderEvent(event, context);
    if (!rendered) continue;
    entries.push({ id, text: rendered.text, tone: rendered.tone });
    id += 1;
  }
  if (entries.length > LOG_CAPACITY) {
    entries = entries.slice(entries.length - LOG_CAPACITY);
  }
  return { log: entries, nextId: id };
}
