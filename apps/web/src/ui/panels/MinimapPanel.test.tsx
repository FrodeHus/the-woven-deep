import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MinimapPanel } from './MinimapPanel.js';

function cell(
  index: number,
  x: number,
  y: number,
  knowledge: 'unknown' | 'remembered' | 'visible',
) {
  return {
    index,
    x,
    y,
    knowledge,
    intensity: knowledge === 'visible' ? 200 : 0,
    ...(knowledge !== 'unknown' ? { tint: [120, 90, 60] as const, glyph: '.' } : {}),
  };
}

function snapshotOf(town: boolean) {
  const cells = [cell(0, 0, 0, 'unknown'), cell(1, 1, 0, 'remembered'), cell(2, 0, 1, 'visible')];
  return {
    projection: {
      floor: { floorId: 'floor.test', town, width: 2, height: 2, cells },
      hero: { x: 0, y: 1 },
    },
  } as never;
}

describe('MinimapPanel', () => {
  it('renders a labeled map region with the fixed data-testid', () => {
    render(<MinimapPanel snapshot={snapshotOf(false)} />);
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /map/i })).toBeInTheDocument();
  });

  it('does not throw when the floor is the town', () => {
    expect(() => render(<MinimapPanel snapshot={snapshotOf(true)} />)).not.toThrow();
    expect(screen.getByTestId('minimap')).toBeInTheDocument();
  });
});
