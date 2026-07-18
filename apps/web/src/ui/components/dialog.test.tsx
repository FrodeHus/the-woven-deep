import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from './dialog.js';

function Harness() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Grimoire</DialogTitle>
        <button>first</button>
        <button>second</button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog primitive', () => {
  it('renders as a modal dialog with an accessible name', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Grimoire' })).toBeInTheDocument();
  });
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
