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
});
