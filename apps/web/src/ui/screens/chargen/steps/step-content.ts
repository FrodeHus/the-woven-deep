import type { CompiledContentPack } from '@woven-deep/content';
import type { WizardAction, WizardState } from '../../../../session/wizard-reducer.js';

export interface StepProps {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly dispatch: (action: WizardAction) => void;
}

export const OPTION_SELECTED_CLASS = 'outline outline-2 outline-accent outline-offset-2 border-accent';
