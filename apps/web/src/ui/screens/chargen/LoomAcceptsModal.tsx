import type { JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import { classById } from '../../../session/pack-queries.js';
import type { WizardState } from '../../../session/wizard-reducer.js';
import { Button } from '../../components/button.js';
import { Dialog, DialogContent, DialogTitle } from '../../components/dialog.js';

/** Composes the woven sentence from the wizard state + pack rather than accepting pre-formatted
 * text, so the modal stays the single place that turns "name + calling + kit" into prose --
 * callers only ever pass the same `state`/`pack` they already have. */
function wovenSentence(state: WizardState, pack: CompiledContentPack): string {
  const classEntry = state.classId === null ? undefined : classById(pack, state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const name = state.name.trim() || 'The nameless one';
  const calling = classEntry?.name ?? 'a nameless calling';
  const kitName = kit?.name ?? 'an unmarked kit';
  return `${name}, ${calling} of the ${kitName} kit, steps onto the first stair.`;
}

export interface LoomAcceptsModalProps {
  readonly open: boolean;
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly onDescend: () => void;
  readonly onCancel: () => void;
}

/** The confirmation modal wedged between the WEAVE action and the real `onConfirm` -- Escape and
 * backdrop clicks both route through `onCancel` (the `Dialog` primitive's `onOpenChange` fires for
 * either), so there is exactly one way out that isn't `DESCEND`. */
export function LoomAcceptsModal({
  open,
  state,
  pack,
  onDescend,
  onCancel,
}: LoomAcceptsModalProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="flex max-w-md flex-col items-center gap-3 border-4 border-double border-accent bg-raised text-center">
        <span aria-hidden="true" className="text-subtle">
          {'──── ❦ ────'}
        </span>
        <DialogTitle>THE LOOM ACCEPTS</DialogTitle>
        <p className="m-0 text-sm text-fg">{wovenSentence(state, pack)}</p>
        <p className="m-0 text-xs text-muted">The Deep will remember this one. Eventually.</p>
        <Button type="button" className="mt-2 w-full" onClick={onDescend}>
          DESCEND
        </Button>
      </DialogContent>
    </Dialog>
  );
}
