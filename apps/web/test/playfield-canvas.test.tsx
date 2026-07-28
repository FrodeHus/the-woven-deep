import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import type { TargetingVisual } from '../src/ui/playfield/IsoRenderer.js';
import { PlayfieldCanvas } from '../src/ui/playfield/PlayfieldCanvas.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';

// PlayfieldCanvas only ever forwards the snapshot/pack/targeting to the renderer, so a minimal cast
// stand-in is enough here -- the real projection shape is exercised by the PlayScreen suites.
const snapshot = {
  projection: { floor: { floorId: 'floor.test', width: 1, height: 1, cells: [] } },
} as unknown as SessionSnapshot;
const pack = {} as unknown as CompiledContentPack;

describe('PlayfieldCanvas', () => {
  it('renders nothing until the atlas loads, then mounts and inits the renderer lazily', async () => {
    const fake = fakePlayfieldRenderer();
    render(
      <PlayfieldCanvas
        snapshot={snapshot}
        pack={pack}
        targeting={null}
        hoverCursor={null}
        onCellClick={() => {}}
        onCellHover={() => {}}
        createRenderer={fake.createRenderer}
      />,
    );

    // Nothing is mounted before the atlas promise resolves.
    expect(fake.instances).toHaveLength(0);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    const host = await screen.findByRole('img');
    expect(host).toBeInTheDocument();
    expect(fake.instances).toHaveLength(1);
    await waitFor(() => expect(fake.latest().snapshots).toContain(snapshot));
  });

  it('forwards a synthetic pointer click through onCellClick with the renderer-computed cell', async () => {
    const onCellClick = vi.fn();
    const fake = fakePlayfieldRenderer();
    render(
      <PlayfieldCanvas
        snapshot={snapshot}
        pack={pack}
        targeting={null}
        hoverCursor={null}
        onCellClick={onCellClick}
        onCellHover={() => {}}
        createRenderer={fake.createRenderer}
      />,
    );
    await screen.findByRole('img');

    act(() => fake.latest().click({ x: 3, y: 4 }, 'primary'));
    expect(onCellClick).toHaveBeenCalledWith({ x: 3, y: 4 }, 'primary');
  });

  it('pushes each targeting change to the renderer and destroys it on unmount', async () => {
    const fake = fakePlayfieldRenderer();
    const targeting: TargetingVisual = {
      validCells: new Set(['1,1']),
      affectedCells: new Set(),
      reticle: { x: 1, y: 1 },
    };
    const { rerender, unmount } = render(
      <PlayfieldCanvas
        snapshot={snapshot}
        pack={pack}
        targeting={null}
        hoverCursor={null}
        onCellClick={() => {}}
        onCellHover={() => {}}
        createRenderer={fake.createRenderer}
      />,
    );
    await screen.findByRole('img');
    await waitFor(() => expect(fake.latest().targetings.length).toBeGreaterThan(0));

    rerender(
      <PlayfieldCanvas
        snapshot={snapshot}
        pack={pack}
        targeting={targeting}
        hoverCursor={null}
        onCellClick={() => {}}
        onCellHover={() => {}}
        createRenderer={fake.createRenderer}
      />,
    );
    await waitFor(() => expect(fake.latest().lastTargeting()).toBe(targeting));

    const instance = fake.latest();
    unmount();
    expect(instance.destroyed).toBe(true);
  });
});
