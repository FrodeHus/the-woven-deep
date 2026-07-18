import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListFacets } from './use-list-facets.js';

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `item ${i}`,
    description: '',
    tags: i % 2 ? ['melee'] : ['ranged'],
  }));
}

describe('useListFacets', () => {
  it('is hidden at or below the threshold', () => {
    const { result } = renderHook(() => useListFacets(makeItems(6)));
    expect(result.current.visible).toBe(false);
  });

  it('is visible above the threshold and filters by query (name+description, case-insensitive)', () => {
    const { result } = renderHook(() => useListFacets(makeItems(7)));
    expect(result.current.visible).toBe(true);
    act(() => result.current.setQuery('ITEM 3'));
    expect(result.current.filtered.map((i) => i.name)).toEqual(['item 3']);
  });

  it('filters by active tag and ALL clears it', () => {
    const { result } = renderHook(() => useListFacets(makeItems(7)));
    act(() => result.current.setActiveTag('melee'));
    expect(result.current.filtered.every((i) => i.tags.includes('melee'))).toBe(true);
    expect(result.current.filtered.length).toBeGreaterThan(0);
    expect(result.current.filtered.length).toBeLessThan(7);

    act(() => result.current.setActiveTag(null));
    expect(result.current.filtered).toHaveLength(7);
  });
});
