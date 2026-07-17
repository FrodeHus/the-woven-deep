import { useMemo, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeroChoices, Uint32State } from '@woven-deep/engine';
import { DEFAULT_SETTINGS, type Settings } from '../../session/settings.js';
import {
  initialWizardState, wizardChoices, wizardReduce, type WizardAction, type WizardState,
} from '../../session/wizard-reducer.js';
import {
  AttributesStep, BackgroundTraitsStep, ClassStep, KitStep, MethodStep, NameStep, SummaryStep,
} from './chargen-steps.js';

export interface ChargenScreenProps {
  readonly pack: CompiledContentPack;
  readonly seed: Uint32State;
  /** Step 1's "Show guidance on your first delve" toggle seeds from `settings.onboarding`, and
   * `onConfirm` below writes the guest's choice back through `onChangeSettings` -- both optional,
   * defaulting to `DEFAULT_SETTINGS`/a no-op, so every pre-existing caller/test (which never
   * exercises the onboarding toggle) keeps compiling and passing unchanged. */
  readonly settings?: Settings;
  readonly onChangeSettings?: (next: Settings) => void;
  /** The portrait glyph is client-only cosmetic state (never engine data — see `PORTRAIT_GLYPHS`),
   * so it rides beside `HeroChoices` here rather than inside it. */
  readonly onConfirm: (choices: HeroChoices, portraitGlyph: string) => void;
}

const STEP_LABELS: Readonly<Record<WizardState['step'], string>> = {
  1: 'Name & portrait',
  2: 'Attribute method',
  3: 'Attributes',
  4: 'Class',
  5: 'Kit',
  6: 'Background & traits',
  7: 'Summary',
};

/**
 * The character-generation wizard: hosts the pure `wizardReduce` state machine and renders the
 * step matching `state.step`. Whether "Next" can be pressed is derived by asking the reducer
 * itself — dispatching `next` speculatively and checking whether the state actually changed —
 * rather than duplicating `wizardReduce`'s step-completion rules here, so illegal transitions stay
 * unrepresentable in exactly one place.
 */
export function ChargenScreen({
  pack, seed, settings = DEFAULT_SETTINGS, onChangeSettings = () => {}, onConfirm,
}: ChargenScreenProps): JSX.Element {
  const [state, setState] = useState<WizardState>(() => initialWizardState(seed, settings.onboarding === 'on'));
  const context = useMemo(() => ({ pack, seed }), [pack, seed]);

  const dispatch = (action: WizardAction): void => {
    setState((previous) => wizardReduce(previous, action, context));
  };

  const canAdvance = wizardReduce(state, { type: 'next' }, context) !== state;
  const choices = wizardChoices(state);

  const stepProps = { state, pack, dispatch };

  return (
    <div className="chargen-screen">
      <header className="chargen-progress" aria-label={`Step ${state.step} of 7: ${STEP_LABELS[state.step]}`}>
        <p className="chargen-step-label">{`Step ${state.step} of 7 — ${STEP_LABELS[state.step]}`}</p>
      </header>
      <main className="chargen-main">
        {state.step === 1 && <NameStep {...stepProps} />}
        {state.step === 2 && <MethodStep {...stepProps} />}
        {state.step === 3 && <AttributesStep {...stepProps} />}
        {state.step === 4 && <ClassStep {...stepProps} />}
        {state.step === 5 && <KitStep {...stepProps} />}
        {state.step === 6 && <BackgroundTraitsStep {...stepProps} />}
        {state.step === 7 && <SummaryStep {...stepProps} />}
      </main>
      <nav className="chargen-nav">
        <button type="button" onClick={() => dispatch({ type: 'back' })} disabled={state.step === 1}>
          Back
        </button>
        {state.step < 7 && (
          <button type="button" onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance}>
            Next
          </button>
        )}
        {state.step === 7 && (
          <button
            type="button"
            disabled={choices === null}
            onClick={() => {
              if (!choices) return;
              if (state.onboardingEnabled !== (settings.onboarding === 'on')) {
                onChangeSettings({ ...settings, onboarding: state.onboardingEnabled ? 'on' : 'off' });
              }
              onConfirm(choices, state.portraitGlyph);
            }}
          >
            Confirm
          </button>
        )}
      </nav>
    </div>
  );
}
