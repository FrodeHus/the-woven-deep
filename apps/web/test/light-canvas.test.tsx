import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, ObservableCell } from '@woven-deep/engine';
import { LightCanvas } from '../src/ui/LightCanvas.js';

const PITCH_TORCH_LIGHT = {
  color: [255, 154, 68] as const, radius: 5, strength: 220,
  fuelCapacity: 800, fuelPerTime: 2, warningThresholds: [200, 80], fuelTags: [],
};

const LAMP_VAULT = {
  id: 'vault.town', kind: 'vault', legend: {
    L: {
      terrain: 'floor', entrance: false, slot: null,
      light: {
        idSuffix: 'lamp', glyph: '1', presentationToken: 'fixture.lamp',
        color: [255, 179, 71], radius: 6, strength: 180, enabled: true,
      },
    },
  },
};

function pack(entries: readonly Record<string, unknown>[]): CompiledContentPack {
  return {
    schemaVersion: 5, hash: 'hash.test', entries, generationReport: { foundationalCategories: [] },
  } as unknown as CompiledContentPack;
}

function emptyCell(index: number, x: number, y: number, extra: Partial<ObservableCell> = {}): ObservableCell {
  return { index, x, y, knowledge: 'unknown', intensity: 0, ...extra };
}

function makeProjection(input: Readonly<{
  heroX: number; heroY: number;
  equipment?: Record<string, unknown>;
  cells?: readonly ObservableCell[];
}>): GameplayProjection {
  const width = 20; const height = 10;
  const cells: ObservableCell[] = input.cells
    ? [...input.cells]
    : (() => {
      const generated: ObservableCell[] = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) generated.push(emptyCell(y * width + x, x, y));
      }
      return generated;
    })();
  return {
    floor: { floorId: 'floor.one', width, height, cells },
    hero: {
      actorId: 'actor.hero', name: 'Ada', x: input.heroX, y: input.heroY,
      equipment: input.equipment ?? {},
    },
    actors: [], features: [], groundItems: [], actions: [],
    metrics: {} as GameplayProjection['metrics'],
    conclusion: null,
  } as unknown as GameplayProjection;
}

const CAMERA = { x: 0, y: 0 };
const VIEWPORT = { width: 20, height: 10 };
const CELL_SIZE = { width: 10, height: 16 };

/** A minimal, spy-recording fake matching just the 2D context surface `LightCanvas` calls. */
function fakeContext2d(): Readonly<{
  ctx: Partial<CanvasRenderingContext2D>; fillCalls: number;
}> {
  const gradient = { addColorStop: vi.fn() };
  const state = { fillCalls: 0 };
  const ctx: Partial<CanvasRenderingContext2D> = {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    clearRect: vi.fn(), setTransform: vi.fn(),
    createRadialGradient: vi.fn(() => gradient as unknown as CanvasGradient),
    fill: vi.fn(() => { state.fillCalls += 1; }),
    fillStyle: '' as unknown as CanvasRenderingContext2D['fillStyle'],
    filter: '' as unknown as CanvasRenderingContext2D['filter'],
    globalCompositeOperation: 'source-over' as unknown as CanvasRenderingContext2D['globalCompositeOperation'],
  };
  return { ctx, get fillCalls() { return state.fillCalls; } } as unknown as Readonly<{
    ctx: Partial<CanvasRenderingContext2D>; fillCalls: number;
  }>;
}

function mockCanvasContext(ctx: Partial<CanvasRenderingContext2D> | null): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as RenderingContext,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LightCanvas', () => {
  it('renders nothing when settings.lighting is "classic"', () => {
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    const { container } = render(
      <LightCanvas
        projection={projection} pack={pack([])} camera={CAMERA} viewport={VIEWPORT}
        cellSize={CELL_SIZE} lighting="classic"
      />,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('renders nothing and logs a breadcrumb when lighting is "smooth" but canvas 2D is unavailable', () => {
    // jsdom's own HTMLCanvasElement.getContext (stubbed in test/setup.ts) already returns null,
    // so no extra mocking is needed here to exercise the unavailable path.
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    const { container } = render(
      <LightCanvas
        projection={projection} pack={pack([])} camera={CAMERA} viewport={VIEWPORT}
        cellSize={CELL_SIZE} lighting="smooth"
      />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('canvas 2D unavailable'));
  });

  it('mounts a canvas and fills at least once per visible light source, with a mocked 2D context', () => {
    const { ctx } = fakeContext2d();
    mockCanvasContext(ctx);

    const cells: ObservableCell[] = [
      emptyCell(0, 8, 5, {
        knowledge: 'visible', fixture: { lightId: 'light.lamp-1', glyph: '1', token: 'fixture.lamp' },
      }),
    ];
    const projection = makeProjection({
      heroX: 5, heroY: 5, cells,
      equipment: { 'off-hand': { contentId: 'item.pitch-torch', enabled: true, fuel: 800 } },
    });
    const contentPack = pack([
      { id: 'item.pitch-torch', kind: 'item', light: PITCH_TORCH_LIGHT },
      LAMP_VAULT,
    ]);

    const { container } = render(
      <LightCanvas
        projection={projection} pack={contentPack} camera={CAMERA} viewport={VIEWPORT}
        cellSize={CELL_SIZE} lighting="smooth"
      />,
    );

    expect(container.querySelector('canvas')).not.toBeNull();
    // Two light sources (hero + one visible fixture), two fill passes each (rim + core).
    expect(ctx.fill).toHaveBeenCalled();
    expect((ctx.fill as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('renders nothing for classic mode even with a mocked 2D context available', () => {
    const { ctx } = fakeContext2d();
    mockCanvasContext(ctx);
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    const { container } = render(
      <LightCanvas
        projection={projection} pack={pack([])} camera={CAMERA} viewport={VIEWPORT}
        cellSize={CELL_SIZE} lighting="classic"
      />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(ctx.fill).not.toHaveBeenCalled();
  });
});
