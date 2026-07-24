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
});
