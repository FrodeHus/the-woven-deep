import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../../src/auth/rate-limiter.js';

class FakeClock implements Clock {
  private current: Date;

  constructor(start: string) {
    this.current = new Date(start);
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('RateLimiter', () => {
  it('allows up to the limit hits in a window then blocks', () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const limiter = new RateLimiter({ clock, windowMs: 60 * 60 * 1000 });

    expect(limiter.check('key', 3)).toBe(true);
    expect(limiter.check('key', 3)).toBe(true);
    expect(limiter.check('key', 3)).toBe(true);
    expect(limiter.check('key', 3)).toBe(false);
  });

  it('re-allows after the window elapses', () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const limiter = new RateLimiter({ clock, windowMs: 60 * 60 * 1000 });

    expect(limiter.check('key', 1)).toBe(true);
    expect(limiter.check('key', 1)).toBe(false);

    clock.advance(60 * 60 * 1000 + 1);

    expect(limiter.check('key', 1)).toBe(true);
  });

  it('treats distinct keys independently', () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const limiter = new RateLimiter({ clock, windowMs: 60 * 60 * 1000 });

    expect(limiter.check('a', 1)).toBe(true);
    expect(limiter.check('a', 1)).toBe(false);
    expect(limiter.check('b', 1)).toBe(true);
  });

  it('prunes old timestamps so only in-window hits count toward the limit', () => {
    const clock = new FakeClock('2026-07-17T00:00:00.000Z');
    const limiter = new RateLimiter({ clock, windowMs: 1000 });

    expect(limiter.check('key', 2)).toBe(true);
    clock.advance(1001);
    expect(limiter.check('key', 2)).toBe(true);
    expect(limiter.check('key', 2)).toBe(true);
    expect(limiter.check('key', 2)).toBe(false);
  });
});
