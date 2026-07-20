import type { JSX } from 'react';
import { ATTRIBUTE_ORDER } from '@woven-deep/engine';
import { DERIVED_STAT_LABELS, playerVisibleDerivedStats } from '@/ui/derived-stats-display.js';
import { wizardPreview } from '../../../../session/wizard-reducer.js';
import { backgroundEntries, classEntries, traitEntries } from '../../../../session/pack-queries.js';
import { DotLeaderRow } from '../chargen-components.js';
import { type StepProps } from './step-content.js';

export function ReviewStep({ state, pack }: StepProps): JSX.Element {
  const classEntry = classEntries(pack).find((entry) => entry.id === state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const background = backgroundEntries(pack).find((entry) => entry.id === state.backgroundId);
  const chosenTraits = traitEntries(pack).filter((entry) => state.traitIds.includes(entry.id));
  const stats = wizardPreview(state, pack);

  return (
    <section aria-label="Review" className="flex flex-col gap-3 font-mono">
      <h2 className="m-0 font-serif text-2xl text-accent-strong">{state.name || '—'}</h2>
      <div className="flex flex-col gap-1">
        <DotLeaderRow label="Calling" value={classEntry?.name ?? '—'} />
        <DotLeaderRow label="Kit" value={kit?.name ?? '—'} />
        <DotLeaderRow label="Origin" value={background?.name ?? '—'} />
        <DotLeaderRow
          label="Traits"
          value={
            chosenTraits.length > 0 ? chosenTraits.map((trait) => trait.name).join(', ') : 'None'
          }
        />
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <h3 className="m-0 text-sm font-semibold text-fg-strong">Attributes</h3>
        {ATTRIBUTE_ORDER.map((attributeName) => (
          <DotLeaderRow
            key={attributeName}
            label={attributeName.charAt(0).toUpperCase() + attributeName.slice(1)}
            value={String(state.attributes?.[attributeName] ?? '—')}
          />
        ))}
      </div>
      {stats && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <h3 className="m-0 text-sm font-semibold text-fg-strong">Derived stats</h3>
          {playerVisibleDerivedStats().map((statName) => (
            <DotLeaderRow
              key={statName}
              label={DERIVED_STAT_LABELS[statName]}
              value={String(stats[statName])}
            />
          ))}
        </div>
      )}
      <p className="m-0 text-sm italic text-muted">
        {`${state.name || 'This hero'} steps into the dark, ${classEntry?.name ?? 'unproven'} and ${background?.name ?? 'unbound by fate'}.`}
      </p>
    </section>
  );
}
