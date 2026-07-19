import type { JSX } from 'react';
import { modifiersMeta } from '@/ui/derived-stats-display.js';
import { FacetedOptionList } from '../FacetedOptionList.js';
import { backgroundEntries } from '../../../../session/pack-queries.js';
import { type StepProps } from './step-content.js';

export function OriginStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = backgroundEntries(pack).map((entry) => {
    const meta = modifiersMeta(entry.modifiers);
    return { ...entry, ...(meta ? { meta } : {}) };
  });

  return (
    <section aria-label="Origin" className="flex flex-col gap-3 font-mono">
      <FacetedOptionList
        entries={entries}
        ariaLabel="Origin"
        marker="single"
        selected={(entry) => state.backgroundId === entry.id}
        onSelect={(entry) => dispatch({ type: 'choose-background', backgroundId: entry.id })}
      />
    </section>
  );
}
