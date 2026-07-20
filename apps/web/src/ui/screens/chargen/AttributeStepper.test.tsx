import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttributeStepper } from './AttributeStepper.js';

describe('AttributeStepper', () => {
  it('renders abbr, label, and cost note', () => {
    render(
      <AttributeStepper
        abbr="STR"
        abbrColor="#c23b52"
        label="Strength"
        cost={2}
        value={3}
        max={10}
        canDecrement
        canIncrement
        onDecrement={() => {}}
        onIncrement={() => {}}
      />,
    );
    expect(screen.getByText('STR')).toBeInTheDocument();
    expect(screen.getByText('Strength')).toBeInTheDocument();
    expect(screen.getByText('2 pts')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('disables + when canIncrement is false and does not call onIncrement on click', () => {
    const onIncrement = vi.fn();
    render(
      <AttributeStepper
        abbr="STR"
        abbrColor="#c23b52"
        label="Strength"
        cost={2}
        value={10}
        max={10}
        canDecrement
        canIncrement={false}
        onDecrement={() => {}}
        onIncrement={onIncrement}
      />,
    );
    const plus = screen.getByRole('button', { name: '+' });
    expect(plus).toBeDisabled();
    plus.click();
    expect(onIncrement).not.toHaveBeenCalled();
  });

  it('disables − when canDecrement is false and does not call onDecrement on click', () => {
    const onDecrement = vi.fn();
    render(
      <AttributeStepper
        abbr="STR"
        abbrColor="#c23b52"
        label="Strength"
        cost={2}
        value={0}
        max={10}
        canDecrement={false}
        canIncrement
        onDecrement={onDecrement}
        onIncrement={() => {}}
      />,
    );
    const minus = screen.getByRole('button', { name: '−' });
    expect(minus).toBeDisabled();
    minus.click();
    expect(onDecrement).not.toHaveBeenCalled();
  });

  it('calls onDecrement when − clicked and enabled', () => {
    const onDecrement = vi.fn();
    render(
      <AttributeStepper
        abbr="STR"
        abbrColor="#c23b52"
        label="Strength"
        cost={2}
        value={3}
        max={10}
        canDecrement
        canIncrement
        onDecrement={onDecrement}
        onIncrement={() => {}}
      />,
    );
    screen.getByRole('button', { name: '−' }).click();
    expect(onDecrement).toHaveBeenCalledOnce();
  });

  it('calls onIncrement when + clicked and enabled', () => {
    const onIncrement = vi.fn();
    render(
      <AttributeStepper
        abbr="STR"
        abbrColor="#c23b52"
        label="Strength"
        cost={2}
        value={3}
        max={10}
        canDecrement
        canIncrement
        onDecrement={() => {}}
        onIncrement={onIncrement}
      />,
    );
    screen.getByRole('button', { name: '+' }).click();
    expect(onIncrement).toHaveBeenCalledOnce();
  });
});
