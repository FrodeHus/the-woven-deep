import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OptionRow } from './OptionRow.js';

describe('OptionRow', () => {
  it('shows (•) and aria-selected="true" when selected in single mode', () => {
    render(<OptionRow name="Warrior" marker="single" selected onSelect={() => {}} />);
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row.textContent).toContain('(•)');
  });

  it('shows ( ) when not selected in single mode', () => {
    render(<OptionRow name="Warrior" marker="single" selected={false} onSelect={() => {}} />);
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('aria-selected', 'false');
    expect(row.textContent).toContain('( )');
  });

  it('shows [×] when selected in multi mode', () => {
    render(<OptionRow name="Stealth" marker="multi" selected onSelect={() => {}} />);
    expect(screen.getByRole('option').textContent).toContain('[×]');
  });

  it('shows [ ] when not selected in multi mode', () => {
    render(<OptionRow name="Stealth" marker="multi" selected={false} onSelect={() => {}} />);
    expect(screen.getByRole('option').textContent).toContain('[ ]');
  });

  it('is aria-disabled and shows lockHint when locked, and does not call onSelect on click', () => {
    const onSelect = vi.fn();
    render(
      <OptionRow
        name="Paladin"
        marker="single"
        selected={false}
        locked
        lockHint="Requires level 5"
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row.textContent).toContain('Requires level 5');
    expect(row.textContent).toContain('⊘');
    row.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect when clicked and not locked', () => {
    const onSelect = vi.fn();
    render(<OptionRow name="Warrior" marker="single" selected={false} onSelect={onSelect} />);
    screen.getByRole('option').click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('applies selected styling classes', () => {
    render(<OptionRow name="Warrior" marker="single" selected onSelect={() => {}} />);
    const row = screen.getByRole('option');
    expect(row.className).toContain('border-accent');
    expect(row.className).toContain('bg-raised');
  });

  it('renders optional meta, description, and tags', () => {
    render(
      <OptionRow
        name="Warrior"
        marker="single"
        selected={false}
        meta="STR +2"
        description="A stalwart fighter."
        tags={['Melee', 'Tank']}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('STR +2')).toBeInTheDocument();
    expect(screen.getByText('A stalwart fighter.')).toBeInTheDocument();
    expect(screen.getByText('Melee')).toBeInTheDocument();
    expect(screen.getByText('Tank')).toBeInTheDocument();
  });

  it('calls onSelect when Enter or Space is pressed on a focused option', () => {
    const onSelect = vi.fn();
    render(<OptionRow name="Warrior" marker="single" selected={false} onSelect={onSelect} />);
    const row = screen.getByRole('option');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('does not call onSelect on Enter or Space when locked', () => {
    const onSelect = vi.fn();
    render(
      <OptionRow name="Paladin" marker="single" selected={false} locked onSelect={onSelect} />,
    );
    const row = screen.getByRole('option');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is aria-disabled and shows disabledReason (not a lock hint) when disabled, and does not call onSelect on click', () => {
    const onSelect = vi.fn();
    render(
      <OptionRow
        name="Steady hands"
        marker="multi"
        selected={false}
        disabled
        disabledReason="2/2 traits picked"
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('option');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row.textContent).toContain('2/2 traits picked');
    expect(row.textContent).not.toContain('⊘');
    row.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not call onSelect on Enter or Space when disabled', () => {
    const onSelect = vi.fn();
    render(
      <OptionRow
        name="Steady hands"
        marker="multi"
        selected={false}
        disabled
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('option');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a disabled row distinguishably from a locked row (marker and styling differ)', () => {
    const { unmount } = render(
      <OptionRow
        name="Steady hands"
        marker="multi"
        selected={false}
        disabled
        disabledReason="2/2 traits picked"
        onSelect={() => {}}
      />,
    );
    const disabledRow = screen.getByRole('option');
    expect(disabledRow.textContent).not.toContain('⊘');
    expect(disabledRow.className).not.toContain('border-dashed');
    unmount();

    render(
      <OptionRow
        name="Paladin"
        marker="single"
        selected={false}
        locked
        lockHint="Requires level 5"
        onSelect={() => {}}
      />,
    );
    const lockedRow = screen.getByRole('option');
    expect(lockedRow.textContent).toContain('⊘');
    expect(lockedRow.className).toContain('border-dashed');
    expect(lockedRow.textContent).not.toContain('2/2 traits picked');
  });

  it('lets locked win when both locked and disabled are passed', () => {
    const onSelect = vi.fn();
    render(
      <OptionRow
        name="Paladin"
        marker="single"
        selected={false}
        locked
        lockHint="Requires level 5"
        disabled
        disabledReason="should not show"
        onSelect={onSelect}
      />,
    );
    const row = screen.getByRole('option');
    expect(row.textContent).toContain('⊘');
    expect(row.textContent).toContain('Requires level 5');
    expect(row.textContent).not.toContain('should not show');
    expect(row.className).toContain('border-dashed');
  });

  it('renders an optional glyph tile', () => {
    render(
      <OptionRow
        name="Warrior"
        marker="single"
        selected={false}
        glyph="⚔"
        glyphColor="#d99a2b"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('⚔')).toBeInTheDocument();
  });
});
