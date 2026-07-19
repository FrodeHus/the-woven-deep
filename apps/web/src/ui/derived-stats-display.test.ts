import { describe, expect, it } from 'vitest';
import { DERIVED_STAT_NAMES } from '@woven-deep/engine';
import { PLAYER_HIDDEN_DERIVED_STATS, playerVisibleDerivedStats } from './derived-stats-display.js';

describe('playerVisibleDerivedStats', () => {
  it('excludes the light-out internal knobs', () => {
    const visible = playerVisibleDerivedStats();
    expect(visible).not.toContain('lightOutRevealRadius');
    expect(visible).not.toContain('lightOutMemoryPersists');
  });

  it('includes every other DERIVED_STAT_NAMES entry', () => {
    const visible = playerVisibleDerivedStats();
    for (const name of DERIVED_STAT_NAMES) {
      if (PLAYER_HIDDEN_DERIVED_STATS.has(name)) continue;
      expect(visible).toContain(name);
    }
    expect(visible.length).toBe(DERIVED_STAT_NAMES.length - PLAYER_HIDDEN_DERIVED_STATS.size);
  });
});
