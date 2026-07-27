import { describe, expect, it } from 'vitest';
import type { TransientEffect } from '../effects-map.js';
import { selectNewEffects, spawnForEffect, stepParticles, type Particle } from './particles.js';

function effect(
  kind: TransientEffect['kind'],
  extra: Partial<TransientEffect> = {},
): TransientEffect {
  return { key: `${kind}-1`, kind, x: 3, y: 4, ...extra };
}

describe('spawnForEffect', () => {
  it('returns a positive number of particles for hit-flash with sane ttl', () => {
    const particles = spawnForEffect(effect('hit-flash'), 1000);
    expect(particles.length).toBeGreaterThan(0);
    for (const particle of particles) {
      expect(particle.bornAt).toBe(1000);
      expect(particle.ttlMs).toBeGreaterThan(0);
      expect(particle.ttlMs).toBeLessThan(2000);
    }
  });

  it('returns a positive number of particles for attack-streak with sane ttl', () => {
    const particles = spawnForEffect(effect('attack-streak', { toX: 6, toY: 8 }), 1000);
    expect(particles.length).toBeGreaterThan(0);
    for (const particle of particles) {
      expect(particle.ttlMs).toBeGreaterThan(0);
      expect(particle.ttlMs).toBeLessThan(2000);
    }
  });

  it('returns a positive number of particles for death-burst with sane ttl', () => {
    const particles = spawnForEffect(effect('death-burst'), 1000);
    expect(particles.length).toBeGreaterThan(0);
    for (const particle of particles) {
      expect(particle.ttlMs).toBeGreaterThan(0);
      expect(particle.ttlMs).toBeLessThan(2000);
    }
  });

  it('spawns more particles for death-burst than hit-flash', () => {
    const hit = spawnForEffect(effect('hit-flash'), 1000);
    const death = spawnForEffect(effect('death-burst'), 1000);
    expect(death.length).toBeGreaterThan(hit.length);
  });

  it('places every spawned particle at the effect origin cell (before drift)', () => {
    const particles = spawnForEffect(effect('hit-flash'), 1000);
    for (const particle of particles) {
      // hit-flash particles originate at the effect cell -- local iso coords for (3,4).
      expect(particle.x).toBeCloseTo((3 - 4) * 32, 0);
      expect(particle.y).toBeCloseTo((3 + 4) * 16, -1);
    }
  });
});

describe('stepParticles', () => {
  function fixedParticle(overrides: Partial<Particle> = {}): Particle {
    return {
      x: 0,
      y: 0,
      z: 0,
      vx: 0.05,
      vy: 0.02,
      vz: 0.1,
      bornAt: 1000,
      ttlMs: 300,
      color: 0xffffff,
      size: 3,
      additive: false,
      ...overrides,
    };
  }

  it('advances positions of live particles', () => {
    const particle = fixedParticle();
    const [stepped] = stepParticles([particle], 1010);
    expect(stepped).toBeDefined();
    expect(stepped!.x).not.toBe(particle.x);
  });

  it('removes particles whose ttl has expired by `now`', () => {
    const particle = fixedParticle({ bornAt: 1000, ttlMs: 300 });
    const stepped = stepParticles([particle], 1301);
    expect(stepped).toHaveLength(0);
  });

  it('keeps particles that have not yet expired', () => {
    const particle = fixedParticle({ bornAt: 1000, ttlMs: 300 });
    const stepped = stepParticles([particle], 1100);
    expect(stepped).toHaveLength(1);
  });

  it('is pure: same inputs yield equal (deep) outputs', () => {
    const particle = fixedParticle();
    const first = stepParticles([particle], 1050);
    const second = stepParticles([particle], 1050);
    expect(first).toEqual(second);
  });

  it('applies gravity so upward vz decays over repeated steps', () => {
    const particle = fixedParticle({ vz: 0.5, z: 0 });
    const stepOnce = stepParticles([particle], 1016);
    const stepTwice = stepParticles(stepOnce, 1032);
    expect(stepTwice[0]!.vz).toBeLessThan(stepOnce[0]!.vz);
  });
});

describe('selectNewEffects', () => {
  // Mirrors `effectsForEvents`'s `hero.damaged` branch: the SAME literal key recurring in two
  // different turns, since it is `${event.type}-${index}` (array position), not a stable event id.
  const recurringHeroHit: TransientEffect = {
    key: 'hero.damaged-0',
    kind: 'hit-flash',
    x: 1,
    y: 1,
  };

  it('spawns the same effect key again when the generation advances (a new turn)', () => {
    const first = selectNewEffects([recurringHeroHit], 1, new Set(), 12);
    expect(first.newEffects).toEqual([recurringHeroHit]);

    const second = selectNewEffects([recurringHeroHit], 2, first.seenKeys, 12);
    expect(second.newEffects).toEqual([recurringHeroHit]);
  });

  it('does not re-spawn the same effect key within the same generation (a re-feed)', () => {
    const first = selectNewEffects([recurringHeroHit], 1, new Set(), 12);
    expect(first.newEffects).toEqual([recurringHeroHit]);

    const refeed = selectNewEffects([recurringHeroHit], 1, first.seenKeys, 12);
    expect(refeed.newEffects).toEqual([]);
  });

  it('prunes seen keys from generations older than the previous one', () => {
    const gen1 = selectNewEffects([recurringHeroHit], 1, new Set(), 12);
    const gen2 = selectNewEffects([], 2, gen1.seenKeys, 12);
    // gen1's key survives one generation bump (still "last turn" relative to gen2)...
    expect([...gen2.seenKeys]).toContain('1:hero.damaged-0');
    const gen3 = selectNewEffects([], 3, gen2.seenKeys, 12);
    // ...but is pruned once a second generation has passed.
    expect([...gen3.seenKeys]).not.toContain('1:hero.damaged-0');
  });

  it('still caps spawn volume within a single generation at maxSeenKeys', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      key: `k-${i}`,
      kind: 'hit-flash' as const,
      x: 0,
      y: 0,
    }));
    const result = selectNewEffects(many, 1, new Set(), 12);
    expect(result.seenKeys.size).toBeLessThanOrEqual(12);
  });
});
