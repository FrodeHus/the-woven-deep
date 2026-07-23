import type { JSX } from 'react';
import { FacetedOptionList } from '../FacetedOptionList.js';
import { classEntries } from '../../../../session/pack-queries.js';
import type { StepProps } from './step-content.js';

export function CallingStep({
  state,
  pack,
  dispatch,
  unlockedClassIds = [],
}: StepProps): JSX.Element {
  const entries = classEntries(pack).map((entry) => {
    const selectable = entry.playable || unlockedClassIds.includes(entry.id);
    return {
      ...entry,
      glyph: entry.silhouetteGlyph,
      locked: !selectable,
      ...(!selectable && entry.unlockHint ? { lockHint: entry.unlockHint } : {}),
      selectable,
    };
  });

  return (
    <section aria-label="Calling" className="flex flex-col gap-3 font-mono">
      <FacetedOptionList
        entries={entries}
        ariaLabel="Calling"
        marker="single"
        selected={(entry) => state.classId === entry.id}
        onSelect={(entry) => {
          if (entry.selectable) dispatch({ type: 'choose-class', classId: entry.id });
        }}
      />
    </section>
  );
}
