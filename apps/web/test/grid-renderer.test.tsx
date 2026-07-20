import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { GameplayProjection, ObservableCell } from '@woven-deep/engine';
import { fixtureFlickerStyle, GridRenderer, materialClass } from '../src/ui/GridRenderer.js';

function unknownCell(index: number, x: number, y: number): ObservableCell {
  return { index, x, y, knowledge: 'unknown', intensity: 0 };
}

function makeFloor(
  width: number,
  height: number,
  floorId = 'floor.test',
): GameplayProjection['floor'] {
  const cells: ObservableCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) cells.push(unknownCell(y * width + x, x, y));
  }
  return { floorId, depth: 1, town: false, width, height, cells };
}

function withCell(
  floor: GameplayProjection['floor'],
  x: number,
  y: number,
  patch: Partial<ObservableCell>,
): GameplayProjection['floor'] {
  const index = y * floor.width + x;
  const cells = floor.cells.map((cell) =>
    cell.index === index ? { ...cell, x, y, index, ...patch } : cell,
  );
  return { ...floor, cells };
}

function baseProjection(
  floor: GameplayProjection['floor'],
  hero: { x: number; y: number },
): GameplayProjection {
  return {
    floor,
    hero: { actorId: 'actor.hero', name: 'Ada', x: hero.x, y: hero.y },
    actors: [],
    features: [],
    groundItems: [],
    actions: [],
    metrics: {} as GameplayProjection['metrics'],
    conclusion: null,
  } as unknown as GameplayProjection;
}

describe('GridRenderer', () => {
  it('renders exactly the viewport window of cells, keyed by world coordinates', () => {
    let floor = makeFloor(60, 20);
    floor = withCell(floor, 12, 5, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 200,
      tint: [255, 200, 100],
    });
    const projection = baseProjection(floor, { x: 0, y: 0 });
    const camera = { x: 10, y: 3 };
    render(
      <GridRenderer projection={projection} camera={camera} viewport={{ width: 40, height: 15 }} />,
    );

    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const cells = grid.querySelectorAll('[data-cell]');
    expect(cells).toHaveLength(40 * 15);
    expect(grid.querySelector('[data-cell="10,3"]')).not.toBeNull();
    expect(grid.querySelector('[data-cell="9,3"]')).toBeNull();

    const visible = grid.querySelector('[data-cell="12,5"]')!;
    expect(visible).toHaveClass('cell-visible');
    expect(visible.getAttribute('style')).toContain('--light');
  });

  it('renders unknown cells empty, remembered cells dim, and overlays hero > actor > item > tile glyphs', () => {
    let floor = makeFloor(6, 1);
    // x1: remembered
    floor = withCell(floor, 1, 0, {
      knowledge: 'remembered',
      glyph: '.',
      token: 'tile.floor',
      intensity: 24,
    });
    // x2: visible, fixture glyph wins over tile glyph
    floor = withCell(floor, 2, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 180,
      fixture: { lightId: 'light.wall-1', glyph: 'F', token: 'fixture.wall-torch' },
    });
    // x3: visible, ground-item glyph wins over tile glyph (no fixture)
    floor = withCell(floor, 3, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 180,
    });
    // x4: visible, actor glyph wins over item glyph
    floor = withCell(floor, 4, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 180,
    });
    // x5: visible, hero glyph wins over everything (hero also "occupies" x4's actor cell test separately)
    floor = withCell(floor, 5, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 180,
    });

    const projection: GameplayProjection = {
      ...baseProjection(floor, { x: 5, y: 0 }),
      actors: [{ actorId: 'actor.rat', x: 4, y: 0, glyph: 'r' }],
      groundItems: [
        { itemId: 'item.a', x: 3, y: 0, glyph: 'i' },
        { itemId: 'item.b', x: 4, y: 0, glyph: 'i' },
      ],
    } as unknown as GameplayProjection;

    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 6, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });

    const unknown = grid.querySelector('[data-cell="0,0"]')!;
    expect(unknown).toHaveClass('cell-unknown');
    expect(unknown.textContent).toBe('');

    const remembered = grid.querySelector('[data-cell="1,0"]')!;
    expect(remembered).toHaveClass('cell-remembered');
    expect(remembered.textContent).toBe('.');

    expect(grid.querySelector('[data-cell="2,0"]')!.textContent).toBe('F');
    expect(grid.querySelector('[data-cell="3,0"]')!.textContent).toBe('i');
    expect(grid.querySelector('[data-cell="4,0"]')!.textContent).toBe('r');
    expect(grid.querySelector('[data-cell="5,0"]')!.textContent).toBe('@');
  });

  it('marks the hero cell with the hero glyph @ and an accessible label', () => {
    let floor = makeFloor(3, 1);
    floor = withCell(floor, 1, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'tile.floor',
      intensity: 180,
    });
    const projection = baseProjection(floor, { x: 1, y: 0 });

    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 3, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const heroCell = grid.querySelector('[data-cell="1,0"]')!;
    expect(heroCell.textContent).toBe('@');
    expect(heroCell.getAttribute('aria-label')).toMatch(/hero/i);
  });

  it('pads with empty out-of-floor cells when the floor is smaller than the viewport', () => {
    const floor = makeFloor(3, 3);
    const projection = baseProjection(floor, { x: 1, y: 1 });
    // A negative-origin centering case: viewport bigger than the floor on both axes.
    const camera = { x: -1, y: -1 };
    render(
      <GridRenderer projection={projection} camera={camera} viewport={{ width: 5, height: 5 }} />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const cells = grid.querySelectorAll('[data-cell]');
    expect(cells).toHaveLength(9);
    expect(grid.querySelector('[data-cell="-1,-1"]')).toBeNull();
    expect(grid.querySelector('[data-cell="0,0"]')).not.toBeNull();
    // The container itself must still expose viewport.width * viewport.height slots.
    expect(grid.children).toHaveLength(25);
  });

  it('applies the material class beside cell-visible/cell-remembered on the DOM', () => {
    let floor = makeFloor(3, 1);
    floor = withCell(floor, 0, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'terrain.floor',
      intensity: 180,
    });
    floor = withCell(floor, 1, 0, {
      knowledge: 'remembered',
      glyph: '#',
      token: 'terrain.wall',
      intensity: 10,
    });
    const projection = baseProjection(floor, { x: 2, y: 0 });

    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 3, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });

    expect(grid.querySelector('[data-cell="0,0"]')).toHaveClass('cell-visible', 'mat-floor');
    expect(grid.querySelector('[data-cell="1,0"]')).toHaveClass('cell-remembered', 'mat-wall');
  });

  it('never applies a material class to an unknown cell (it carries no terrain token)', () => {
    const floor = makeFloor(2, 1);
    const projection = baseProjection(floor, { x: 0, y: 0 });
    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 2, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const cell = grid.querySelector('[data-cell="0,0"]')!;
    expect(cell.className).toBe('cell cell-unknown');
  });

  it('applies the fixture-flicker class and per-fixture --flicker-delay/--flicker-duration vars to a visible fixture cell', () => {
    let floor = makeFloor(1, 1);
    floor = withCell(floor, 0, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'terrain.floor',
      intensity: 180,
      fixture: { lightId: 'light.wall-torch-1', glyph: 'F', token: 'fixture.wall-torch' },
    });
    const projection = baseProjection(floor, { x: 5, y: 5 });
    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 1, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    const cell = grid.querySelector('[data-cell="0,0"]')!;
    expect(cell).toHaveClass('fixture-flicker');
    const style = cell.getAttribute('style')!;
    expect(style).toContain('--flicker-delay');
    expect(style).toContain('--flicker-duration');
  });

  it('never applies fixture-flicker to a cell with no fixture', () => {
    let floor = makeFloor(1, 1);
    floor = withCell(floor, 0, 0, {
      knowledge: 'visible',
      glyph: '.',
      token: 'terrain.floor',
      intensity: 180,
    });
    const projection = baseProjection(floor, { x: 5, y: 5 });
    render(
      <GridRenderer
        projection={projection}
        camera={{ x: 0, y: 0 }}
        viewport={{ width: 1, height: 1 }}
      />,
    );
    const grid = screen.getByRole('grid', { name: /dungeon/i });
    expect(grid.querySelector('[data-cell="0,0"]')).not.toHaveClass('fixture-flicker');
  });
});

describe('fixtureFlickerStyle', () => {
  it('is deterministic: the same lightId produces the same delay/duration every call', () => {
    const first = fixtureFlickerStyle('light.wall-torch-1');
    const second = fixtureFlickerStyle('light.wall-torch-1');
    expect(second).toEqual(first);
  });

  it('produces different jitter for different lightIds (not a constant)', () => {
    const a = fixtureFlickerStyle('light.wall-torch-1');
    const b = fixtureFlickerStyle('light.wall-torch-2');
    expect(a).not.toEqual(b);
  });
});

describe('materialClass', () => {
  const cases: ReadonlyArray<readonly [string, { token?: string; tileId?: number }, string]> = [
    ['wall', { token: 'terrain.wall' }, 'mat-wall'],
    ['floor', { token: 'terrain.floor' }, 'mat-floor'],
    ['door', { token: 'terrain.door' }, 'mat-door'],
    ['pillar', { token: 'terrain.pillar' }, 'mat-pillar'],
    ['stair-up (tileId 4)', { token: 'terrain.stair', tileId: 4 }, 'mat-stair-up'],
    ['stair-down (tileId 5)', { token: 'terrain.stair', tileId: 5 }, 'mat-stair-down'],
    ['void', { token: 'terrain.void' }, 'mat-void'],
    ['no token', {}, ''],
    ['unrecognized token', { token: 'terrain.bogus' }, ''],
  ];

  for (const [label, cell, expected] of cases) {
    it(`maps ${label} to '${expected}'`, () => {
      expect(materialClass(cell)).toBe(expected);
    });
  }

  it('defaults an ambiguous stair tileId (neither 4 nor 5) to stair-up rather than throwing', () => {
    expect(materialClass({ token: 'terrain.stair', tileId: 99 })).toBe('mat-stair-up');
  });
});
