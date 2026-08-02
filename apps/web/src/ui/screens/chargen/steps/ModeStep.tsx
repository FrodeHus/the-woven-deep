import type { JSX } from 'react';
import { RUN_MODES, type RunMode } from '@woven-deep/engine';
import type { StepProps } from './step-content.js';
import { OPTION_SELECTED_CLASS } from './step-content.js';
import { MODE_LABELS } from '../../../mode-label.js';

const MODE_BLURBS: Readonly<Record<RunMode, string>> = {
  classic: 'The true Deep. Death is final. The Hall remembers.',
  wanderer:
    "Walk the Deep unbound. Death is a setback — rise again at the floor's mouth. The Hall does not watch.",
};

export function ModeStep({ state, dispatch }: StepProps): JSX.Element {
  return (
    <section aria-label="Mode" className="flex flex-col gap-3 font-mono">
      <div role="radiogroup" aria-label="Run mode" className="flex flex-col gap-2">
        {RUN_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.mode === mode}
            onClick={() => dispatch({ type: 'choose-mode', mode })}
            className={`flex flex-col gap-1 rounded-md border border-line bg-raised p-3 text-left ${
              state.mode === mode ? OPTION_SELECTED_CLASS : ''
            }`}
          >
            <span className="font-serif text-base text-fg-strong">{MODE_LABELS[mode]}</span>
            <span className="text-sm text-muted">{MODE_BLURBS[mode]}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-subtle">This choice is locked for the life of the run.</p>
    </section>
  );
}
