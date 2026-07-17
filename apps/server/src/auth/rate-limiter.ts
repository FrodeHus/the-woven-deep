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

    const existing = this.hits.get(key) ?? [];
    const withinWindow = existing.filter((timestamp) => timestamp > windowStart);

    if (withinWindow.length >= limit) {
      this.hits.set(key, withinWindow);
      return false;
    }

    withinWindow.push(now);
    this.hits.set(key, withinWindow);
    return true;
  }
}
