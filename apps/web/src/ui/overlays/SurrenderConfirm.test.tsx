import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SurrenderConfirm } from './SurrenderConfirm.js';

describe('SurrenderConfirm', () => {
  it('names both consequences, so a player who reads it cannot be surprised', () => {
    render(<SurrenderConfirm open onOpenChange={() => {}} onConfirm={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/ends now/i);
    expect(dialog.textContent).toMatch(/fragment/i);
  });

  it('surrenders only on confirm, never on the way out', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<SurrenderConfirm open onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /keep going/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: /^surrender$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(<SurrenderConfirm open={false} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
