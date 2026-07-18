import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { StepMenu, STEP_LABELS } from './StepMenu.js';

const SEED: Uint32State = [11, 22, 33, 44];

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState(SEED), ...overrides };
}

describe('STEP_LABELS', () => {
  it('maps every step number to its label', () => {
    expect(STEP_LABELS).toEqual({
      1: 'Identity',
      2: 'Calling',
      3: 'Kit',
      4: 'Attributes',
      5: 'Origin',
      6: 'Traits',
      7: 'Review',
    });
  });
});

describe('StepMenu', () => {
  it('renders one row per step with the correct labels', () => {
    const onJump = vi.fn();
    render(<StepMenu state={stubState()} current={1} onJump={onJump} />);
    for (const label of Object.values(STEP_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('option')).toHaveLength(7);
  });

  it('marks the active step selected', () => {
    const onJump = vi.fn();
    render(<StepMenu state={stubState({ name: 'Rin' })} current={2} onJump={onJump} />);
    const active = screen.getByRole('option', { name: /Calling/ });
    expect(active).toHaveAttribute('aria-selected', 'true');
    const inactive = screen.getByRole('option', { name: /Kit/ });
    expect(inactive).toHaveAttribute('aria-selected', 'false');
  });

  it('does not call onJump when clicking a step whose prerequisites are unmet', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(<StepMenu state={stubState()} current={1} onJump={onJump} />);
    await user.click(screen.getByRole('option', { name: /Kit/ }));
    expect(onJump).not.toHaveBeenCalled();
  });

  it('calls onJump when clicking a satisfied earlier step', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(
      <StepMenu
        state={stubState({ name: 'Rin', classId: 'class.wayfarer' })}
        current={3}
        onJump={onJump}
      />,
    );
    await user.click(screen.getByRole('option', { name: /Identity/ }));
    expect(onJump).toHaveBeenCalledWith(1);
    onJump.mockClear();
    await user.click(screen.getByRole('option', { name: /Calling/ }));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it('shows a muted current-value line reflecting state', () => {
    const onJump = vi.fn();
    render(<StepMenu state={stubState({ name: 'Rin' })} current={1} onJump={onJump} />);
    expect(screen.getByRole('option', { name: /Identity/ }).textContent).toMatch(/Rin/);
  });
});
