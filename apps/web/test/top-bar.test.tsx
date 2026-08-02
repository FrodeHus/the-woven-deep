import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopBar } from '../src/ui/panels/TopBar.js';

function snapshotOf(overrides: {
  town?: boolean;
  depth?: number;
  currency?: number;
  turnsElapsed?: number;
  banked?: number;
}): never {
  return {
    projection: {
      hero: {
        name: 'Ashwalker',
        currency: overrides.currency ?? 0,
        tempering: {
          banked: overrides.banked ?? 0,
          spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
          temperable: ['might', 'agility', 'vitality', 'wits', 'resolve'],
        },
      },
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

  it('shows a banked-tempering badge while a point is banked', () => {
    render(<TopBar snapshot={snapshotOf({ banked: 2 })} />);
    expect(screen.getByTestId('top-bar-tempering-banked')).toHaveTextContent('2 banked');
  });

  it('shows no banked-tempering badge with nothing banked', () => {
    render(<TopBar snapshot={snapshotOf({ banked: 0 })} />);
    expect(screen.queryByTestId('top-bar-tempering-banked')).not.toBeInTheDocument();
  });
});
