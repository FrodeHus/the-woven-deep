import { useMemo, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { HeroChoices, Uint32State } from '@woven-deep/engine';
import { DEFAULT_SETTINGS, type Settings } from '../../session/settings.js';
import {
  initialWizardState, wizardChoices, wizardReduce, type WizardAction, type WizardState,
} from '../../session/wizard-reducer.js';
import { Button } from '../components/button.js';
import { HeroRecord } from './chargen/HeroRecord.js';
import { STEP_LABELS, StepMenu } from './chargen/StepMenu.js';
import {
  AttributesStep, CallingStep, IdentityStep, KitStep, OriginStep, ReviewStep, TraitsStep, type StepProps,
} from './chargen/steps.js';

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

/**
 * The character-generation console: a fixed-height three-pane shell over the pure `wizardReduce`
 * state machine. Left is `StepMenu` (build order + jump), center is the active step's body
 * (switched on `state.step` so each body remounts and its own facet/filter state resets), right is
 * the live `HeroRecord`. Whether "Next" can be pressed is derived by asking the reducer itself --
 * dispatching `next` speculatively and checking whether the state actually changed -- rather than
 * duplicating `wizardReduce`'s step-completion rules here, so illegal transitions stay
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
  const canWeave = state.step === 7 && choices !== null;

  const weave = (): void => {
    if (!choices) return;
    if (state.onboardingEnabled !== (settings.onboarding === 'on')) {
      onChangeSettings({ ...settings, onboarding: state.onboardingEnabled ? 'on' : 'off' });
    }
    onConfirm(choices, state.portraitGlyph);
  };

  const onJump = (target: WizardState['step']): void => {
    let next = state;
    while (next.step < target) {
      const advanced = wizardReduce(next, { type: 'next' }, context);
      if (advanced === next) break;
      next = advanced;
    }
    while (next.step > target) {
      const receded = wizardReduce(next, { type: 'back' }, context);
      if (receded === next) break;
      next = receded;
    }
    if (next !== state) setState(next);
  };

  const stepProps: StepProps = { state, pack, dispatch };

  return (
    <div className="flex h-screen flex-col gap-2 bg-deep p-2 text-fg font-mono">
      <header aria-label={`Step ${state.step} of 7: ${STEP_LABELS[state.step]}`} className="flex items-baseline gap-2 border-b border-line px-1 pb-2">
        <h1 className="m-0 font-serif text-lg text-accent-strong">Weave a hero</h1>
        <span className="text-sm uppercase tracking-wide text-muted">{`Step ${state.step} of 7 — ${STEP_LABELS[state.step]}`}</span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[236px_1fr_340px] gap-2">
        <div className="min-h-0 overflow-y-auto rounded-md border border-line bg-surface p-2">
          <StepMenu state={state} current={state.step} onJump={onJump} pack={pack} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <main className="min-h-0 flex-1 overflow-y-auto">
            {state.step === 1 && <IdentityStep {...stepProps} />}
            {state.step === 2 && <CallingStep {...stepProps} />}
            {state.step === 3 && <KitStep {...stepProps} />}
            {state.step === 4 && <AttributesStep {...stepProps} />}
            {state.step === 5 && <OriginStep {...stepProps} />}
            {state.step === 6 && <TraitsStep {...stepProps} />}
            {state.step === 7 && <ReviewStep {...stepProps} />}
          </main>
          <nav className="flex items-center justify-between gap-2 border-t border-line pt-2">
            <Button type="button" variant="outline" onClick={() => dispatch({ type: 'back' })} disabled={state.step === 1}>
              {'◂ BACK'}
            </Button>
            <span className="text-sm text-muted">{`${state.step} / 7`}</span>
            {state.step < 7 && (
              <Button type="button" onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance}>
                {'NEXT ▸'}
              </Button>
            )}
            {state.step === 7 && (
              <Button type="button" disabled={!canWeave} onClick={weave}>
                {'WEAVE ▸'}
              </Button>
            )}
          </nav>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-md border border-line bg-surface p-3">
          <HeroRecord state={state} pack={pack} onWeave={weave} canWeave={canWeave} />
        </div>
      </div>
    </div>
  );
}
