import type {
  BackgroundContentEntry, ClassContentEntry, CompiledContentPack, TraitContentEntry,
} from '@woven-deep/content';
import type { WizardAction, WizardState } from '../../../../session/wizard-reducer.js';

export interface StepProps {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly dispatch: (action: WizardAction) => void;
}

export const OPTION_SELECTED_CLASS = 'outline outline-2 outline-accent outline-offset-2 border-accent';

export function classEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return pack.entries.filter((entry): entry is ClassContentEntry => entry.kind === 'class');
}

export function backgroundEntries(pack: CompiledContentPack): readonly BackgroundContentEntry[] {
  return pack.entries.filter((entry): entry is BackgroundContentEntry => entry.kind === 'background');
}

export function traitEntries(pack: CompiledContentPack): readonly TraitContentEntry[] {
  return pack.entries.filter((entry): entry is TraitContentEntry => entry.kind === 'trait');
}
