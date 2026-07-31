import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MinimapPanel } from './MinimapPanel.js';

function cell(
  index: number,
  x: number,
  y: number,
  knowledge: 'unknown' | 'remembered' | 'visible',
  overrides: Readonly<{ glyph?: string; token?: string }> = {},
) {
  return {
    index,
    x,
    y,
    knowledge,
    intensity: knowledge === 'visible' ? 200 : 0,
    ...(knowledge !== 'unknown' ? { tint: [120, 90, 60] as const, glyph: '.' } : {}),
    ...overrides,
  };
}

/** The lit hero: one enabled equipment item is all `heroLightIsOut` reads. */
const LIT_EQUIPMENT = { offHand: { itemId: 'item.lantern', enabled: true } };
const DARK_EQUIPMENT = { offHand: { itemId: 'item.lantern', enabled: false } };

function snapshotOf(
  town: boolean,
  options: Readonly<{ cells?: readonly unknown[]; lit?: boolean }> = {},
) {
  const cells = options.cells ?? [
    cell(0, 0, 0, 'unknown'),
    cell(1, 1, 0, 'remembered'),
    cell(2, 0, 1, 'visible'),
  ];
  return {
    projection: {
      floor: { floorId: 'floor.test', town, width: 2, height: 2, cells },
      hero: {
        x: 0,
        y: 1,
        equipment: options.lit === false ? DARK_EQUIPMENT : LIT_EQUIPMENT,
      },
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

  it('marks a discovered way down and a discovered way up with their own markers', () => {
    render(
      <MinimapPanel
        snapshot={snapshotOf(false, {
          cells: [
            cell(0, 0, 0, 'visible', { glyph: '>', token: 'terrain.stair' }),
            cell(1, 1, 0, 'remembered', { glyph: '<', token: 'terrain.stair' }),
          ],
        })}
      />,
    );
    expect(screen.getByTestId('minimap-stair-down')).toBeInTheDocument();
    expect(screen.getByTestId('minimap-stair-up')).toBeInTheDocument();
  });

  it('does not mark an undiscovered stair', () => {
    render(
      <MinimapPanel
        snapshot={snapshotOf(false, {
          cells: [cell(0, 0, 0, 'unknown', { glyph: '>', token: 'terrain.stair' })],
        })}
      />,
    );
    expect(screen.queryByTestId('minimap-stair-down')).not.toBeInTheDocument();
  });

  it('blanks the map when the hero carries no burning light', () => {
    render(
      <MinimapPanel
        snapshot={snapshotOf(false, {
          lit: false,
          cells: [cell(0, 0, 0, 'visible', { glyph: '>', token: 'terrain.stair' })],
        })}
      />,
    );
    expect(screen.getByTestId('minimap-no-light')).toBeInTheDocument();
    expect(screen.queryByTestId('minimap-stair-down')).not.toBeInTheDocument();
    expect(screen.getByTestId('minimap')).toHaveAttribute('data-light-out', 'true');
  });

  it('keeps the town minimap lit even without a burning light, matching the fully-lit playfield', () => {
    render(
      <MinimapPanel
        snapshot={snapshotOf(true, {
          lit: false,
          cells: [cell(0, 0, 0, 'visible', { glyph: '>', token: 'terrain.stair' })],
        })}
      />,
    );
    expect(screen.queryByTestId('minimap-no-light')).not.toBeInTheDocument();
    expect(screen.getByTestId('minimap-stair-down')).toBeInTheDocument();
    expect(screen.getByTestId('minimap')).not.toHaveAttribute('data-light-out');
  });
});
