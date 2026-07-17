import { describe, expect, it } from 'vitest';
import { healthBand, heroAnnouncements, type HeroAnnounceSnapshot } from '../src/ui/hero-announce.js';

function snap(overrides: Partial<HeroAnnounceSnapshot> = {}): HeroAnnounceSnapshot {
  return { health: 100, maxHealth: 100, hungerStage: 'Fed', conditions: [], ...overrides };
}

describe('healthBand', () => {
  it('classifies ratios into ok/low/critical at the 50% and 25% thresholds', () => {
    expect(healthBand(100, 100)).toBe('ok');
    expect(healthBand(51, 100)).toBe('ok');
    expect(healthBand(50, 100)).toBe('low');
    expect(healthBand(26, 100)).toBe('low');
    expect(healthBand(25, 100)).toBe('critical');
    expect(healthBand(1, 100)).toBe('critical');
  });

  it('degrades to ok when maxHealth is zero (no divide-by-zero)', () => {
    expect(healthBand(0, 0)).toBe('ok');
  });
});

describe('heroAnnouncements', () => {
  it('says nothing when nothing significant changed', () => {
    expect(heroAnnouncements(snap(), snap())).toEqual([]);
  });

  it('announces crossing below 50% health', () => {
    expect(heroAnnouncements(snap({ health: 80 }), snap({ health: 45 }))).toEqual(['Health low.']);
  });

  it('announces crossing below 25% health', () => {
    expect(heroAnnouncements(snap({ health: 45 }), snap({ health: 20 }))).toEqual(['Health critical.']);
  });

  it('does NOT announce a health drop that stays within the same band (no screen-reader spam)', () => {
    expect(heroAnnouncements(snap({ health: 90 }), snap({ health: 60 }))).toEqual([]);
    expect(heroAnnouncements(snap({ health: 45 }), snap({ health: 30 }))).toEqual([]);
  });

  it('announces recovery when the band improves', () => {
    expect(heroAnnouncements(snap({ health: 20 }), snap({ health: 80 }))).toEqual(['Health recovering.']);
  });

  it('announces a hunger stage change', () => {
    expect(heroAnnouncements(snap({ hungerStage: 'Fed' }), snap({ hungerStage: 'Hungry' })))
      .toEqual(['Hunger: Hungry.']);
  });

  it('announces a newly gained condition by name', () => {
    const next = snap({ conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned' }] });
    expect(heroAnnouncements(snap(), next)).toEqual(['Afflicted: Poisoned.']);
  });

  it('announces a condition fading off', () => {
    const prev = snap({ conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned' }] });
    expect(heroAnnouncements(prev, snap())).toEqual(['Poisoned has faded.']);
  });

  it('stays silent when a present condition only changes stacks/duration', () => {
    const prev = snap({ conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned' }] });
    const next = snap({ conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned' }] });
    expect(heroAnnouncements(prev, next)).toEqual([]);
  });

  it('can emit several announcements at once', () => {
    const prev = snap({ health: 80, hungerStage: 'Fed' });
    const next = snap({ health: 20, hungerStage: 'Starving', conditions: [{ conditionId: 'c.bleed', name: 'Bleeding' }] });
    expect(heroAnnouncements(prev, next)).toEqual(['Health critical.', 'Hunger: Starving.', 'Afflicted: Bleeding.']);
  });
});
