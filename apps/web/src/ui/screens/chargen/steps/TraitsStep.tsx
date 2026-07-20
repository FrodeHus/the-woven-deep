import type { JSX } from 'react';
import { modifiersMeta } from '@/ui/derived-stats-display.js';
import { FacetedOptionList } from '../FacetedOptionList.js';
import { traitEntries } from '../../../../session/pack-queries.js';
import type { StepProps } from './step-content.js';

export function TraitsStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const atCap = state.traitIds.length >= 2;
  const entries = traitEntries(pack).map((entry) => {
    const selected = state.traitIds.includes(entry.id);
    const meta = modifiersMeta(entry.modifiers);
    return {
      ...entry,
      ...(meta ? { meta } : {}),
      disabled: !selected && atCap,
      ...(!selected && atCap ? { disabledReason: '2/2 traits picked' } : {}),
    };
  });

  return (
    <section aria-label="Traits" className="flex flex-col gap-3 font-mono">
      <FacetedOptionList
        entries={entries}
        ariaLabel="Traits"
        marker="multi"
        selected={(entry) => state.traitIds.includes(entry.id)}
        onSelect={(entry) => dispatch({ type: 'toggle-trait', traitId: entry.id })}
      >
        <span className="text-sm text-muted">{`${state.traitIds.length}/2`}</span>
      </FacetedOptionList>
    </section>
  );
}
