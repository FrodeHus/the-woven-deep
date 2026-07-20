import type { JSX } from 'react';
import { FacetedOptionList } from '../FacetedOptionList.js';
import { classEntries } from '../../../../session/pack-queries.js';
import { type StepProps } from './step-content.js';

export function CallingStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = classEntries(pack).map((entry) => ({
    ...entry,
    glyph: entry.silhouetteGlyph,
    locked: !entry.playable,
    ...(entry.unlockHint ? { lockHint: entry.unlockHint } : {}),
  }));

  return (
    <section aria-label="Calling" className="flex flex-col gap-3 font-mono">
      <FacetedOptionList
        entries={entries}
        ariaLabel="Calling"
        marker="single"
        selected={(entry) => state.classId === entry.id}
        onSelect={(entry) => { if (entry.playable) dispatch({ type: 'choose-class', classId: entry.id }); }}
      />
    </section>
  );
}
