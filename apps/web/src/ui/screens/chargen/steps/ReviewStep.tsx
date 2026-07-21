import type { JSX } from 'react';
import { ATTRIBUTE_ORDER } from '@woven-deep/engine';
import {
  ATTRIBUTE_LABELS,
  DERIVED_STAT_LABELS,
  playerVisibleDerivedStats,
} from '@/ui/derived-stats-display.js';
import {
  stepIsSatisfied,
  wizardPreview,
  type WizardState,
} from '../../../../session/wizard-reducer.js';
import {
  backgroundEntries,
  balanceEntry,
  classEntries,
  traitEntries,
} from '../../../../session/pack-queries.js';
import { DotLeaderRow } from '../chargen-components.js';
import { STEP_LABELS } from '../StepMenu.js';
import type { StepProps } from './step-content.js';

const REVIEW_GATED_STEPS: readonly WizardState['step'][] = [1, 2, 3, 4, 5, 6];

export function ReviewStep({ state, pack }: StepProps): JSX.Element {
  const classEntry = classEntries(pack).find((entry) => entry.id === state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const background = backgroundEntries(pack).find((entry) => entry.id === state.backgroundId);
  const chosenTraits = traitEntries(pack).filter((entry) => state.traitIds.includes(entry.id));
  const stats = wizardPreview(state, pack);
  const balance = balanceEntry(pack);

  const attributesSummary = ATTRIBUTE_ORDER.map(
    (attributeName) =>
      `${ATTRIBUTE_LABELS[attributeName]} ${state.attributes?.[attributeName] ?? '—'}`,
  ).join(', ');
  const marksSummary =
    chosenTraits.length > 0 ? chosenTraits.map((trait) => trait.name).join(', ') : 'None';

  const missingSteps = REVIEW_GATED_STEPS.filter((step) => !stepIsSatisfied(state, step));
  const ready = missingSteps.length === 0;

  return (
    <section aria-label="Review" className="flex flex-col gap-3 font-mono">
      <div className="flex flex-col gap-1">
        <DotLeaderRow label="Name" value={state.name || '—'} />
        <DotLeaderRow label="Calling" value={classEntry?.name ?? '—'} />
        <DotLeaderRow label="Kit" value={kit?.name ?? '—'} />
        <DotLeaderRow label="Attributes" value={attributesSummary} />
        <DotLeaderRow label="Origin" value={background?.name ?? '—'} />
        <DotLeaderRow label="Marks" value={marksSummary} />
        {balance && <DotLeaderRow label="Starting gold" value={`${balance.startingCurrency}g`} />}
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
      {ready ? (
        <div role="status" className="rounded-md border border-good px-3 py-2 text-sm text-good">
          Every thread is in place. Pull it — weave the hero and descend.
        </div>
      ) : (
        <div role="status" className="rounded-md border border-warn px-3 py-2 text-sm text-warn">
          {`Threads are missing: ${missingSteps.map((step) => STEP_LABELS[step]).join(', ')}. Steps marked ○ in the left rail still need choices.`}
        </div>
      )}
    </section>
  );
}
