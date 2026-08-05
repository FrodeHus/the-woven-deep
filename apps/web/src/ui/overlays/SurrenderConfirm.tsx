import type { JSX } from 'react';
import { Button } from '../components/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/dialog.js';

export interface SurrenderConfirmProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/**
 * The one confirmation between the player and the end of their run. Single-step by design -- no
 * type-to-confirm -- but it states both consequences in plain terms alongside the fiction, because
 * a player who reads this dialog must not be able to be surprised by what happens after they click
 * through it. The palette entry that opens this has deliberately no keybinding: a stray keypress
 * must never be able to reach even this far.
 */
export function SurrenderConfirm({
  open,
  onOpenChange,
  onConfirm,
}: Readonly<SurrenderConfirmProps>): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="surrender-confirm">
        <DialogHeader>
          <DialogTitle>Surrender to the Deep?</DialogTitle>
          <DialogDescription>
            You set down what you were carrying and stop walking. The dark closes over you without
            any particular malice, the way water closes over a stone.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your run ends now and the Hall records it. Any Ancient Tablet fragments you are carrying
          are lost &mdash; the Deep keeps them, and they will not count toward breaking the cycle.
        </p>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Keep going
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Surrender
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
