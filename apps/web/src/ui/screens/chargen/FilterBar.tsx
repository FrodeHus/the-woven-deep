import { Input } from '@/ui/components/input.js';
import { cn } from '@/ui/lib/cn.js';
import { TagChip } from './chargen-components.js';
import type { Facetable, ListFacets } from './use-list-facets.js';

export function FilterBar<T extends Facetable>({ facets }: { facets: ListFacets<T> }) {
  if (!facets.visible) return null;

  return (
    <div className="flex flex-col gap-2 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-muted">⌕</span>
        <Input
          value={facets.query}
          onChange={(e) => facets.setQuery(e.target.value)}
          placeholder="Search..."
          className="flex-1"
        />
        <span className="text-subtle whitespace-nowrap">
          {facets.shown}/{facets.total}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => facets.setActiveTag(null)}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-mono',
            facets.activeTag === null ? 'bg-accent text-deep' : 'border border-line text-muted',
          )}
        >
          ALL
        </button>
        {facets.allTags.map((tag) => (
          <TagChip
            key={tag}
            label={tag}
            selected={facets.activeTag === tag}
            onClick={() => facets.setActiveTag(facets.activeTag === tag ? null : tag)}
          />
        ))}
      </div>
    </div>
  );
}
