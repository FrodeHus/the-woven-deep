import { useMemo, type JSX } from 'react';
import { FacetedOptionList } from '../FacetedOptionList.js';
import { classEntries } from '../../../../session/pack-queries.js';
import type { StepProps } from './step-content.js';

interface FacetedKit {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
}

export function KitStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const classEntry = classEntries(pack).find((entry) => entry.id === state.classId);
  const entries = useMemo<readonly FacetedKit[]>(
    () => (classEntry?.kits ?? []).map((kit) => ({ id: kit.kitId, name: kit.name, tags: [] })),
    [classEntry],
  );

  if (!classEntry) {
    return <p className="text-sm text-muted">Choose a calling first.</p>;
  }

  return (
    <section aria-label="Kit" className="flex flex-col gap-3 font-mono">
      <FacetedOptionList
        entries={entries}
        ariaLabel="Kit"
        marker="single"
        selected={(entry) => state.kitId === entry.id}
        onSelect={(entry) => dispatch({ type: 'choose-kit', kitId: entry.id })}
      />
    </section>
  );
}
