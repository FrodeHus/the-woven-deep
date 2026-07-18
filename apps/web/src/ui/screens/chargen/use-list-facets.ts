import { useMemo, useState } from 'react';

export const FACET_THRESHOLD = 6;

export interface Facetable {
  name: string;
  description?: string;
  tags: readonly string[];
}

export interface ListFacets<T extends Facetable> {
  visible: boolean;
  query: string;
  setQuery: (q: string) => void;
  activeTag: string | null;
  setActiveTag: (t: string | null) => void;
  allTags: readonly string[];
  filtered: readonly T[];
  shown: number;
  total: number;
}

export function useListFacets<T extends Facetable>(items: readonly T[]): ListFacets<T> {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const visible = items.length > FACET_THRESHOLD;

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags) tags.add(tag);
    }
    return [...tags].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        needle.length === 0 ||
        item.name.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle);
      const matchesTag = activeTag === null || item.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [items, query, activeTag]);

  return {
    visible,
    query,
    setQuery,
    activeTag,
    setActiveTag,
    allTags,
    filtered,
    shown: filtered.length,
    total: items.length,
  };
}
