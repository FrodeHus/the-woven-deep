import { describe, expect, it } from 'vitest';
import { effectLabel, humanize } from '../src/ui/labels.js';

describe('humanize', () => {
  it('takes the last dot segment, turns dashes into spaces, and sentence-cases it', () => {
    expect(humanize('fixture.standing-lamp')).toBe('Standing lamp');
  });

  it('has nothing to strip for a token with no dots or dashes', () => {
    expect(humanize('heal')).toBe('Heal');
  });

  it('handles a token with multiple dot segments -- only the last one is kept', () => {
    expect(humanize('effect.item.consume')).toBe('Consume');
  });
});

describe('effectLabel', () => {
  it('phrases a heal effect with its dice, omitting a zero bonus', () => {
    expect(effectLabel('effect.heal', { dice: { count: 1, sides: 4, bonus: 0 } })).toBe('Heal 1d4');
  });

  it('phrases a heal effect with a positive bonus', () => {
    expect(effectLabel('effect.heal', { dice: { count: 1, sides: 4, bonus: 1 } })).toBe('Heal 1d4+1');
  });

  it('phrases a damage effect with its dice and damage type', () => {
    expect(effectLabel('effect.damage', { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 1 } }))
      .toBe('Deal 1d6+1 fire damage');
  });

  it('phrases a hunger-restore effect with its amount', () => {
    expect(effectLabel('effect.hunger.restore', { amount: 1800 })).toBe('Restore hunger (+1800)');
  });

  it('falls back to humanize for an effect id with no recognized parameter shape', () => {
    expect(effectLabel('effect.item.consume', { quantity: 1 })).toBe('Consume');
  });

  it('falls back to humanize for a wholly unknown effect id', () => {
    expect(effectLabel('effect.bleed', {})).toBe('Bleed');
  });

  it('falls back to humanize when a recognized effect id is missing its expected parameter shape', () => {
    expect(effectLabel('effect.heal', {})).toBe('Heal');
  });
});
