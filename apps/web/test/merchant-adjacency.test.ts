import { describe, expect, it } from 'vitest';
import type { GameplayProjection } from '@woven-deep/engine';
import {
  adjacentMerchant,
  chebyshev,
  merchantActors,
  tradeIsAvailable,
} from '../src/session/projection-view.js';

// The merchant-adjacency predicates only read `hero.{x,y}` and each actor's
// `{actorId, x, y, factionName, tradeAvailable}`, so a minimally-shaped projection exercises them.

interface TestActor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly factionName?: string;
  readonly tradeAvailable?: boolean;
}

function projectionOf(
  hero: { x: number; y: number },
  actors: readonly TestActor[],
): GameplayProjection {
  return { hero, actors } as unknown as GameplayProjection;
}

const merchant = (over: Partial<TestActor>): TestActor => ({
  actorId: 'actor.merchant',
  x: 6,
  y: 5,
  factionName: 'Provisioners Guild',
  ...over,
});

describe('chebyshev', () => {
  it('is the king-move distance between two positions', () => {
    expect(chebyshev({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(1);
    expect(chebyshev({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    expect(chebyshev({ x: 5, y: 5 }, { x: 8, y: 6 })).toBe(3);
    expect(chebyshev({ x: 5, y: 5 }, { x: 2, y: 5 })).toBe(3);
  });
});

describe('merchantActors', () => {
  it('keeps only actors carrying a factionName', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [
      merchant({ actorId: 'actor.a' }),
      { actorId: 'actor.rat', x: 6, y: 5 },
    ]);
    expect(merchantActors(projection).map((actor) => actor.actorId)).toEqual(['actor.a']);
  });
});

describe('adjacentMerchant', () => {
  it('returns the merchant the hero is Chebyshev-adjacent to', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [merchant({ x: 6, y: 5 })]);
    expect(adjacentMerchant(projection)?.actorId).toBe('actor.merchant');
  });

  it('ignores a merchant more than one cell away', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [merchant({ x: 8, y: 5 })]);
    expect(adjacentMerchant(projection)).toBeUndefined();
  });

  it('ignores a merchant the hero is standing on', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [merchant({ x: 5, y: 5 })]);
    expect(adjacentMerchant(projection)).toBeUndefined();
  });

  it('ignores a non-merchant actor even when adjacent', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [{ actorId: 'actor.rat', x: 6, y: 5 }]);
    expect(adjacentMerchant(projection)).toBeUndefined();
  });

  it('returns an adjacent merchant regardless of trade availability', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [
      merchant({ x: 6, y: 5, tradeAvailable: false }),
    ]);
    expect(adjacentMerchant(projection)?.actorId).toBe('actor.merchant');
  });

  it('picks the lowest actor-id when several merchants are adjacent', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [
      merchant({ actorId: 'actor.z', x: 6, y: 5 }),
      merchant({ actorId: 'actor.a', x: 4, y: 5 }),
    ]);
    expect(adjacentMerchant(projection)?.actorId).toBe('actor.a');
  });
});

describe('tradeIsAvailable', () => {
  it('is true for an adjacent merchant with trade available', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [merchant({ x: 6, y: 5 })]);
    expect(tradeIsAvailable(projection)).toBe(true);
  });

  it("is false when the adjacent merchant's trade is unavailable", () => {
    const projection = projectionOf({ x: 5, y: 5 }, [
      merchant({ x: 6, y: 5, tradeAvailable: false }),
    ]);
    expect(tradeIsAvailable(projection)).toBe(false);
  });

  it('is false when the only merchant is too far', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [merchant({ x: 8, y: 5 })]);
    expect(tradeIsAvailable(projection)).toBe(false);
  });

  it('is false when no actor is a merchant', () => {
    const projection = projectionOf({ x: 5, y: 5 }, [{ actorId: 'actor.rat', x: 6, y: 5 }]);
    expect(tradeIsAvailable(projection)).toBe(false);
  });
});
