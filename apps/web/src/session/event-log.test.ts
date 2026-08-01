import { describe, expect, it } from 'vitest';
import { foldEventsIntoLog } from './event-log.js';

describe('foldEventsIntoLog', () => {
  it('renders a learned-spell line', () => {
    const { log } = foldEventsIntoLog(
      [],
      [{ type: 'spell.learned', eventId: 'e1', actorId: 'hero.demo', spellId: 'spell.fireball' }],
      0,
    );
    expect(log.map((line) => line.text)).toContain('You learn a new spell.');
  });

  it('renders a refused inextinguishable-light line', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'action.invalid',
          eventId: 'e1',
          commandId: 'command.douse-grace',
          reason: 'light.inextinguishable',
        },
      ],
      0,
    );
    expect(log).toMatchObject([{ text: 'Its light will not be hidden.', tone: 'system' }]);
  });

  it('renders a currency-collected line', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'currency.collected',
          eventId: 'e1',
          actorId: 'hero.demo',
          amount: 12,
          currency: 52,
        },
      ],
      0,
    );
    expect(log).toMatchObject([{ text: 'You gather 12 gold.', tone: 'info' }]);
  });

  it('logs the authored reveal text when a curse reveals', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'curse.revealed',
          eventId: 'e1',
          itemId: 'item.a.0001',
          curseId: 'curse.leaden-weight',
          revealText: 'It settles onto you like wet earth, and does not lift.',
        },
      ],
      0,
    );
    expect(log).toMatchObject([
      { text: 'It settles onto you like wet earth, and does not lift.', tone: 'curse' },
    ]);
  });

  it('logs a curse removal', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'curse.removed',
          eventId: 'e1',
          itemId: 'item.a.0001',
          curseId: 'curse.leaden-weight',
        },
      ],
      0,
    );
    expect(log).toMatchObject([
      { text: 'The weight lifts. The thing is only iron again.', tone: 'curse' },
    ]);
  });

  it('logs the refusal when a cursed item will not come free', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'action.invalid',
          eventId: 'e1',
          commandId: 'command.unequip',
          reason: 'item.cursed',
        },
      ],
      0,
    );
    expect(log).toMatchObject([{ text: 'It will not come free.', tone: 'system' }]);
  });

  it('logs nothing for a floor entry', () => {
    const { log } = foldEventsIntoLog(
      [],
      [{ type: 'floor.entered', eventId: 'e1', floorId: 'floor.2', depth: 2, firstEntry: true }],
      0,
    );
    expect(log).toEqual([]);
  });
});
