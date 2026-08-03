import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { GameplayProjection } from '@woven-deep/engine';
import { TemperOverlay } from '../src/ui/overlays/TemperOverlay.js';

const ATTRIBUTES = { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 } as const;

function projection(
  overrides: Readonly<{
    banked: number;
    attributes?: Readonly<Record<string, number>>;
    temperable?: readonly string[];
  }>,
): GameplayProjection {
  const attributes = overrides.attributes ?? ATTRIBUTES;
  const temperable = overrides.temperable ?? Object.keys(attributes);
  return {
    hero: {
      attributes,
      tempering: {
        banked: overrides.banked,
        spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
        temperable,
      },
    },
  } as unknown as GameplayProjection;
}

function projectionWithBanked(banked: number): GameplayProjection {
  return projection({ banked });
}

function projectionWithCappedMight(): GameplayProjection {
  return projection({
    banked: 1,
    attributes: { ...ATTRIBUTES, might: 30 },
    temperable: ['agility', 'vitality', 'wits', 'resolve'],
  });
}

function projectionAllCapped(banked: number): GameplayProjection {
  return projection({
    banked,
    attributes: { might: 30, agility: 30, vitality: 30, wits: 30, resolve: 30 },
    temperable: [],
  });
}

describe('TemperOverlay', () => {
  it('shows one row per attribute with the banked count', () => {
    render(
      <TemperOverlay projection={projectionWithBanked(2)} onTemper={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('2 points banked')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Might|Agility|Vitality|Wits|Resolve/ }),
    ).toHaveLength(5);
  });

  it('offers no temper affordance at all for a capped attribute', () => {
    render(
      <TemperOverlay
        projection={projectionWithCappedMight()}
        onTemper={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // A capped row carries its reason instead of a permanently dead button (see the row branch in
    // `TemperOverlay`): there is nothing to click, so there is no button to disable.
    expect(screen.queryByRole('button', { name: /Might/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agility/ })).toBeEnabled();
  });

  it('says the points are held when everything is capped', () => {
    render(
      <TemperOverlay projection={projectionAllCapped(2)} onTemper={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Held by the Deep.')).toBeInTheDocument();
  });

  it('dispatches the chosen attribute', async () => {
    const onTemper = vi.fn();
    const user = userEvent.setup();
    render(
      <TemperOverlay projection={projectionWithBanked(1)} onTemper={onTemper} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /Vitality/ }));
    expect(onTemper).toHaveBeenCalledWith('vitality');
  });

  it('disables every attribute button when nothing is banked, even though none is capped', () => {
    render(
      <TemperOverlay projection={projectionWithBanked(0)} onTemper={vi.fn()} onClose={vi.fn()} />,
    );
    for (const button of screen.getAllByRole('button', {
      name: /Might|Agility|Vitality|Wits|Resolve/,
    })) {
      expect(button).toBeDisabled();
    }
  });

  it('says how points are earned when nothing is banked', () => {
    render(
      <TemperOverlay projection={projectionWithBanked(0)} onTemper={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/deeper/i)).toBeInTheDocument();
    // The held-by-the-Deep line is about UNSPENDABLE banked points -- with nothing banked there is
    // nothing being held, so it must not appear.
    expect(screen.queryByText('Held by the Deep.')).not.toBeInTheDocument();
  });

  it('marks a capped attribute at its maximum rather than leaving the row dead', () => {
    render(
      <TemperOverlay
        projection={projectionWithCappedMight()}
        onTemper={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('at maximum')).toBeInTheDocument();
  });

  it('explains both reasons when nothing is banked AND everything is capped', () => {
    render(
      <TemperOverlay projection={projectionAllCapped(0)} onTemper={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/deeper/i)).toBeInTheDocument();
    expect(screen.getAllByText('at maximum')).toHaveLength(5);
  });

  it('calls onClose from the close affordance', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <TemperOverlay projection={projectionWithBanked(1)} onTemper={vi.fn()} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
