import type { PublicEvent } from '@woven-deep/engine';

export interface LogLine {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'combat' | 'warning' | 'system';
}

export const LOG_CAPACITY = 200;

interface RenderedLine {
  readonly text: string;
  readonly tone: LogLine['tone'];
}

function renderEvent(event: PublicEvent): RenderedLine | null {
  switch (event.type) {
    case 'actor.damaged':
      return { text: `The creature takes ${event.amount} damage.`, tone: 'combat' };
    case 'actor.died':
      return { text: 'The creature dies.', tone: 'combat' };
    case 'hero.damaged':
      return { text: `You take ${event.amount} damage.`, tone: 'combat' };
    case 'combat.observed':
      return {
        text: event.outcome === 'hit'
          ? `${event.attackerName ?? 'Something'} hits ${event.targetName ?? 'something'}.`
          : `${event.attackerName ?? 'Something'} misses ${event.targetName ?? 'something'}.`,
        tone: 'combat',
      };
    case 'item.picked-up':
      return { text: 'You pick up an item.', tone: 'info' };
    case 'item.equipped':
      return { text: 'You equip an item.', tone: 'info' };
    case 'item.consumed':
      return { text: 'You consume an item.', tone: 'info' };
    case 'item.light-extinguished':
      return { text: 'Your light source goes out.', tone: 'warning' };
    case 'item.refueled':
      return { text: 'You refill your light source.', tone: 'info' };
    case 'fuel.warning':
      return { text: `Your light is running low on fuel (${event.fuel} remaining).`, tone: 'warning' };
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
      return { text: `That cannot be done (${event.reason}).`, tone: 'system' };
    case 'run.concluded':
      return { text: 'Your run has concluded.', tone: 'system' };
    default:
      return null;
  }
}

export function foldEventsIntoLog(
  log: readonly LogLine[],
  events: readonly PublicEvent[],
  nextId: number,
): Readonly<{ log: readonly LogLine[]; nextId: number }> {
  let entries = [...log];
  let id = nextId;
  for (const event of events) {
    const rendered = renderEvent(event);
    if (!rendered) continue;
    entries.push({ id, text: rendered.text, tone: rendered.tone });
    id += 1;
  }
  if (entries.length > LOG_CAPACITY) {
    entries = entries.slice(entries.length - LOG_CAPACITY);
  }
  return { log: entries, nextId: id };
}
