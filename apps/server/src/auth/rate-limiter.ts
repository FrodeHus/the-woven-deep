export interface Clock {
  now(): Date;
}

export class RateLimiter {
  private readonly clock: Clock;
  private readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();

  constructor(input: Readonly<{ clock: Clock; windowMs: number }>) {
    this.clock = input.clock;
    this.windowMs = input.windowMs;
  }

  check(key: string, limit: number): boolean {
    const now = this.clock.now().getTime();
    const windowStart = now - this.windowMs;

    // Sweep the whole map first, not just `key`. Without this, a key that is only ever
    // seen once (e.g. an attacker forging a unique email per request) would never be
    // pruned again after its single hit ages out of the window, since `check` would
    // never be called for that key again — the map would grow forever. Piggy-backing a
    // full sweep on every call bounds growth to keys active within the last window.
    for (const [existingKey, timestamps] of this.hits) {
      const stillLive = timestamps.filter((timestamp) => timestamp > windowStart);
      if (stillLive.length === 0) {
        this.hits.delete(existingKey);
      } else if (stillLive.length !== timestamps.length) {
        this.hits.set(existingKey, stillLive);
      }
    }

    const withinWindow = this.hits.get(key) ?? [];

    if (withinWindow.length >= limit) {
      this.hits.set(key, withinWindow);
      return false;
    }

    withinWindow.push(now);
    this.hits.set(key, withinWindow);
    return true;
  }

  /**
   * Number of keys currently tracked. Test-only accessor used to verify that keys with
   * no live hits are evicted rather than lingering forever (see `check`'s pruning step).
   */
  size(): number {
    return this.hits.size;
  }
}
