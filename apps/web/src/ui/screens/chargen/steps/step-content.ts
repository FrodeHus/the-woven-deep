import type { CompiledContentPack } from '@woven-deep/content';
import type { WizardAction, WizardState } from '../../../../session/wizard-reducer.js';

export interface StepProps {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly dispatch: (action: WizardAction) => void;
  /** The signed-in profile's earned, content-`playable:false` class ids (from `AccountState`,
   * `evaluateUnlocks`-derived server-side). Empty for guests, so every content-locked class stays
   * locked for them. `CallingStep` is the only consumer today; optional/defaults to `[]` there so
   * every other step's existing render call keeps compiling unchanged. */
  readonly unlockedClassIds?: readonly string[];
}

export const OPTION_SELECTED_CLASS =
  'outline outline-2 outline-accent outline-offset-2 border-accent';
