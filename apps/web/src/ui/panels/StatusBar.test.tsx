import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StatusBar } from './StatusBar.js';

const baseProjection = {
  hero: { name: 'Ashwalker', conditions: [] as { conditionId: string; name: string; color: string; stacks: number; remaining: number }[] },
  floor: { depth: 3, town: false },
  metrics: { turnsElapsed: 42 },
};

const snapshot = { projection: baseProjection } as never;

describe('StatusBar', () => {
  it('renders hero name, depth and turn count', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByText('Ashwalker')).toBeInTheDocument();
    expect(screen.getByText('Depth 3')).toBeInTheDocument();
    expect(screen.getByTestId('turn-count')).toHaveTextContent('Turn 42');
  });

  it('is a labeled group', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
  });

  it('has no aria-live attribute -- it is not itself a live region', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(screen.getByRole('group', { name: 'Status' })).not.toHaveAttribute('aria-live');
  });

  it('renders no condition badge when the hero has no active conditions', () => {
    render(<StatusBar snapshot={snapshot} />);
    expect(document.querySelector('.condition-badge')).toBeNull();
  });

  it('renders a glyph-plus-name condition badge (not color-only) tinted from the condition\'s projected color', () => {
    const withCondition = {
      projection: {
        ...baseProjection,
        hero: {
          ...baseProjection.hero,
          conditions: [{ conditionId: 'condition.poisoned', name: 'Poisoned', color: '#7ac86a', stacks: 1, remaining: 50 }],
        },
      },
    } as never;
    render(<StatusBar snapshot={withCondition} />);
    const badge = document.querySelector('.condition-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/Poisoned/);
    expect(badge.getAttribute('style')).toContain('--condition-color: #7ac86a');
  });

  it('picks the highest-stacks condition for the badge when several are active', () => {
    const withConditions = {
      projection: {
        ...baseProjection,
        hero: {
          ...baseProjection.hero,
          conditions: [
            { conditionId: 'condition.poisoned', name: 'Poisoned', color: '#7ac86a', stacks: 1, remaining: 50 },
            { conditionId: 'condition.bleeding', name: 'Bleeding', color: '#c85a5a', stacks: 3, remaining: 20 },
          ],
        },
      },
    } as never;
    render(<StatusBar snapshot={withConditions} />);
    expect(document.querySelector('.condition-badge')!.textContent).toMatch(/Bleeding/);
  });
});
