import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, ObservableCell, PublicEvent } from '@woven-deep/engine';
import { EffectsLayer } from '../src/ui/EffectsLayer.js';

const PITCH_TORCH_LIGHT = {
  color: [255, 154, 68] as const, radius: 5, strength: 220,
  fuelCapacity: 800, fuelPerTime: 2, warningThresholds: [200, 80], fuelTags: [],
};

function pack(entries: readonly Record<string, unknown>[]): CompiledContentPack {
  return {
    schemaVersion: 5, hash: 'hash.test', entries, generationReport: { foundationalCategories: [] },
  } as unknown as CompiledContentPack;
}

function emptyCell(index: number, x: number, y: number): ObservableCell {
  return { index, x, y, knowledge: 'unknown', intensity: 0 };
}

function makeProjection(input: Readonly<{
  floorId?: string; heroX: number; heroY: number;
  equipment?: Record<string, unknown>;
  actors?: readonly Record<string, unknown>[];
}>): GameplayProjection {
  const width = 20; const height = 10;
  const cells: ObservableCell[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) cells.push(emptyCell(y * width + x, x, y));
  return {
    floor: { floorId: input.floorId ?? 'floor.one', width, height, cells },
    hero: {
      actorId: 'actor.hero', name: 'Ada', x: input.heroX, y: input.heroY,
      equipment: input.equipment ?? {},
    },
    actors: input.actors ?? [],
    features: [], groundItems: [], actions: [],
    metrics: {} as GameplayProjection['metrics'],
    conclusion: null,
  } as unknown as GameplayProjection;
}

const CAMERA = { x: 0, y: 0 };
const VIEWPORT = { width: 20, height: 10 };

describe('EffectsLayer', () => {
  it('renders no glow when the hero has no enabled equipped light', () => {
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    const { container } = render(
      <EffectsLayer projection={projection} pack={pack([])} lastEvents={[]} camera={CAMERA} viewport={VIEWPORT} />,
    );
    expect(container.querySelector('.glow')).toBeNull();
  });

  it('renders a glow at the hero cell scaled by remaining fuel, tagged with the light item source', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5,
      equipment: { 'off-hand': { contentId: 'item.pitch-torch', enabled: true, fuel: 400 } },
    });
    const { container } = render(
      <EffectsLayer
        projection={projection}
        pack={pack([{ kind: 'item', id: 'item.pitch-torch', name: 'Pitch torch', light: PITCH_TORCH_LIGHT }])}
        lastEvents={[]}
        camera={CAMERA}
        viewport={VIEWPORT}
      />,
    );
    const glow = container.querySelector('.glow');
    expect(glow).not.toBeNull();
    expect(glow!.getAttribute('data-source')).toBe('item.pitch-torch');
    expect(glow!.getAttribute('style')).toContain('--glow-intensity: 0.5');
  });

  it('does not glow when the equipped light is disabled', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5,
      equipment: { 'off-hand': { contentId: 'item.pitch-torch', enabled: false, fuel: 400 } },
    });
    const { container } = render(
      <EffectsLayer
        projection={projection}
        pack={pack([{ kind: 'item', id: 'item.pitch-torch', name: 'Pitch torch', light: PITCH_TORCH_LIGHT }])}
        lastEvents={[]}
        camera={CAMERA}
        viewport={VIEWPORT}
      />,
    );
    expect(container.querySelector('.glow')).toBeNull();
  });

  it('renders a transient hit-flash effect mapped from lastEvents at the actor cell', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5, actors: [{ actorId: 'actor.rat', x: 8, y: 5 }],
    });
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: 'actor.rat', sourceActorId: 'actor.hero', amount: 4, health: 6 },
    ];
    const { container } = render(
      <EffectsLayer projection={projection} pack={pack([])} lastEvents={events} camera={CAMERA} viewport={VIEWPORT} />,
    );
    const effect = container.querySelector('.effect-hit-flash');
    expect(effect).not.toBeNull();
    expect(effect!.getAttribute('style')).toContain('--x: 8');
    expect(effect!.getAttribute('style')).toContain('--y: 5');
  });

  it('does not render an effect whose world position falls outside the viewport', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5, actors: [{ actorId: 'actor.rat', x: 19, y: 9 }],
    });
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: 'actor.rat', sourceActorId: 'actor.hero', amount: 4, health: 6 },
    ];
    const smallViewport = { width: 10, height: 10 };
    const { container } = render(
      <EffectsLayer
        projection={projection} pack={pack([])} lastEvents={events} camera={CAMERA} viewport={smallViewport}
      />,
    );
    expect(container.querySelector('.effect-hit-flash')).toBeNull();
  });

  it('clears live effects when the floor changes, so a burst from the previous floor never renders onto the new one', () => {
    const projection = makeProjection({
      floorId: 'floor.one', heroX: 5, heroY: 5, actors: [{ actorId: 'actor.rat', x: 8, y: 5 }],
    });
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: 'actor.rat', sourceActorId: 'actor.hero', amount: 4, health: 6 },
    ];
    const { container, rerender } = render(
      <EffectsLayer projection={projection} pack={pack([])} lastEvents={events} camera={CAMERA} viewport={VIEWPORT} />,
    );
    expect(container.querySelector('.effect-hit-flash')).not.toBeNull();

    const nextFloorProjection = makeProjection({ floorId: 'floor.two', heroX: 2, heroY: 2 });
    rerender(
      <EffectsLayer
        projection={nextFloorProjection} pack={pack([])} lastEvents={[]} camera={CAMERA} viewport={VIEWPORT}
      />,
    );
    expect(container.querySelector('.effect-hit-flash')).toBeNull();
  });

  it('removes a transient effect once its animation ends', () => {
    const projection = makeProjection({
      heroX: 5, heroY: 5, actors: [{ actorId: 'actor.rat', x: 8, y: 5 }],
    });
    const events: PublicEvent[] = [
      { type: 'actor.damaged', eventId: 'event.1', actorId: 'actor.rat', sourceActorId: 'actor.hero', amount: 4, health: 6 },
    ];
    const { container } = render(
      <EffectsLayer projection={projection} pack={pack([])} lastEvents={events} camera={CAMERA} viewport={VIEWPORT} />,
    );
    const effect = container.querySelector('.effect-hit-flash')!;
    fireEvent.animationEnd(effect);
    expect(container.querySelector('.effect-hit-flash')).toBeNull();
  });

  it('is entirely decorative: aria-hidden and non-interactive', () => {
    const projection = makeProjection({ heroX: 5, heroY: 5 });
    const { container } = render(
      <EffectsLayer projection={projection} pack={pack([])} lastEvents={[]} camera={CAMERA} viewport={VIEWPORT} />,
    );
    const layer = container.querySelector('.effects-layer')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });
});
