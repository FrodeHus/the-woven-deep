import { describe, expect, it } from 'vitest';
import * as sessionCore from '../src/index.js';

describe('session-core public API', () => {
  it('exports the intents + command-builder surface moved from apps/web', () => {
    expect(typeof sessionCore.buildIntent).toBe('function');
    expect(typeof sessionCore.itemById).toBe('function');
    expect(typeof sessionCore.heroOf).toBe('function');
    expect(typeof sessionCore.chebyshev).toBe('function');
  });

  it('exports the dispatch surface extracted from GuestSession', () => {
    expect(typeof sessionCore.dispatchIntent).toBe('function');
    expect(typeof sessionCore.dispatchCommand).toBe('function');
  });
});
