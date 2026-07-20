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
