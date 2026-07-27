import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopBar } from '../src/ui/panels/TopBar.js';

function snapshotOf(overrides: {
  town?: boolean;
  depth?: number;
  currency?: number;
  turnsElapsed?: number;
}): never {
  return {
    projection: {
      hero: { name: 'Ashwalker', currency: overrides.currency ?? 0 },
      floor: { depth: overrides.depth ?? 1, town: overrides.town ?? false },
      metrics: { turnsElapsed: overrides.turnsElapsed ?? 0 },
    },
  } as never;
}

describe('TopBar', () => {
  it('renders the town location while in town', () => {
    render(<TopBar snapshot={snapshotOf({ town: true })} />);
    expect(screen.getByTestId('top-bar-location')).toHaveTextContent(/town/i);
  });

  it('renders DEPTH N for a dungeon floor', () => {
    render(<TopBar snapshot={snapshotOf({ town: false, depth: 3 })} />);
    expect(screen.getByTestId('top-bar-location')).toHaveTextContent('DEPTH 3');
  });

  it("shows the hero's currency as gold in the accent color", () => {
    render(<TopBar snapshot={snapshotOf({ currency: 32 })} />);
    const gold = screen.getByTestId('top-bar-gold');
    expect(gold).toHaveTextContent('32 gold');
    expect(gold).toHaveClass('text-accent');
  });

  it('shows the current turn count', () => {
    render(<TopBar snapshot={snapshotOf({ turnsElapsed: 42 })} />);
    expect(screen.getByTestId('turn-count')).toHaveTextContent('Turn 42');
  });

  it('shows the game title', () => {
    render(<TopBar snapshot={snapshotOf({})} />);
    expect(screen.getByText('THE WOVEN DEEP')).toBeInTheDocument();
  });
});
