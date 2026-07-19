import type { JSX, ReactNode } from 'react';
import { FilterBar } from './FilterBar.js';
import { OptionRow } from './OptionRow.js';
import { useListFacets } from './use-list-facets.js';
import { useListNavigation } from '../roving-focus.js';

/** An entry a `FacetedOptionList` can render as an `OptionRow`, after filtering/tagging via
 * `useListFacets`. */
export interface FacetedOptionListEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly glyph?: string;
  readonly glyphColor?: string;
  readonly meta?: string;
  readonly locked?: boolean;
  readonly lockHint?: string;
}

/** The shared `FilterBar` + `useListFacets` + listbox + `OptionRow` scaffold used by the chargen
 * steps that pick one (or several) content entries from a searchable, taggable list. `children`
 * renders between the filter bar and the listbox, for a step that needs to show something there
 * (e.g. a selection counter). */
export function FacetedOptionList<T extends FacetedOptionListEntry>({
  entries, ariaLabel, marker, selected, onSelect, children,
}: {
  readonly entries: readonly T[];
  readonly ariaLabel: string;
  readonly marker: 'single' | 'multi';
  readonly selected: (entry: T) => boolean;
  readonly onSelect: (entry: T) => void;
  readonly children?: ReactNode;
}): JSX.Element {
  const facets = useListFacets(entries);
  const { registerItem, handleArrowKeys } = useListNavigation(facets.filtered.length);

  return (
    <>
      <FilterBar facets={facets} />
      {children}
      <div
        role="listbox"
        aria-label={ariaLabel}
        {...(marker === 'multi' ? { 'aria-multiselectable': 'true' } : {})}
        className="flex flex-col gap-1.5"
        onKeyDown={handleArrowKeys}
      >
        {facets.filtered.map((entry, index) => (
          <OptionRow
            key={entry.id}
            ref={registerItem(index)}
            {...(entry.glyph ? { glyph: entry.glyph } : {})}
            {...(entry.glyphColor ? { glyphColor: entry.glyphColor } : {})}
            name={entry.name}
            {...(entry.meta ? { meta: entry.meta } : {})}
            {...(entry.description ? { description: entry.description } : {})}
            tags={entry.tags}
            marker={marker}
            selected={selected(entry)}
            locked={entry.locked ?? false}
            {...(entry.lockHint ? { lockHint: entry.lockHint } : {})}
            onSelect={() => onSelect(entry)}
          />
        ))}
      </div>
    </>
  );
}
