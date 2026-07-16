import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun } from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import type { SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { triggerResize } from './setup.js';

// Regression for the tier feedback loop found by real-browser probing: `layoutTier` was fed the
// MAP PANE's measured width, but the tier sets `data-tier` on the triptych, which changes the
// pane's own CSS grid column (1fr 4fr 1fr full vs 1fr 5fr 0 compact) — a loop where every tier
// switch changes the very measurement that produced it. In jsdom we can't reproduce the CSS grid
// math, so we pin the invariant structurally: mock the container and pane to report DIFFERENT
// widths, and assert the tier tracks the container, never the pane.
let pack: CompiledContentPack;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function fakeStorage(): SessionStorageLike {
  let value: string | null = null;
  return { get: () => value, set: (v: string) => { value = v; } };
}

function session(): GuestSession {
  return new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
}

/** Stubs `getBoundingClientRect` so a given element reports a fixed width/height, independent of
 * jsdom's real (always-zero) layout box, and independent of any other mocked element. */
function stubRect(element: Element, width: number, height = 600): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlayScreen tier derivation', () => {
  it('derives data-tier from the triptych container width, not the map pane width', () => {
    const { container } = render(<PlayScreen session={session()} pack={pack} />);
    const triptych = container.querySelector('.triptych')!;
    const mapPane = container.querySelector('.map-pane')!;

    // Container reports a full-tier width; pane reports a much narrower (minimal-tier) width —
    // exactly what the real CSS grid produces once `data-tier="compact"` shrinks the pane column.
    stubRect(triptych, 1400);
    stubRect(mapPane, 400);
    act(() => {
      triggerResize(triptych);
      triggerResize(mapPane);
    });

    expect(triptych).toHaveAttribute('data-tier', 'full');
  });

  it('never changes the tier when only the pane width changes', () => {
    const { container } = render(<PlayScreen session={session()} pack={pack} />);
    const triptych = container.querySelector('.triptych')!;
    const mapPane = container.querySelector('.map-pane')!;

    stubRect(triptych, 1400);
    stubRect(mapPane, 1173);
    act(() => {
      triggerResize(triptych);
      triggerResize(mapPane);
    });
    expect(triptych).toHaveAttribute('data-tier', 'full');

    // Simulate the oscillation: the pane's own width swings wildly (as it does under the real CSS
    // feedback loop) while the container never moves. The tier must not react.
    stubRect(mapPane, 939);
    act(() => triggerResize(mapPane));
    expect(triptych).toHaveAttribute('data-tier', 'full');

    stubRect(mapPane, 300);
    act(() => triggerResize(mapPane));
    expect(triptych).toHaveAttribute('data-tier', 'full');
  });

  it('changes the tier when the container width crosses a threshold, even with the pane held fixed', () => {
    const { container } = render(<PlayScreen session={session()} pack={pack} />);
    const triptych = container.querySelector('.triptych')!;
    const mapPane = container.querySelector('.map-pane')!;

    stubRect(triptych, 1400);
    stubRect(mapPane, 500);
    act(() => {
      triggerResize(triptych);
      triggerResize(mapPane);
    });
    expect(triptych).toHaveAttribute('data-tier', 'full');

    stubRect(triptych, 700); // below the compact threshold (760) -> minimal
    act(() => triggerResize(triptych));
    expect(triptych).toHaveAttribute('data-tier', 'minimal');
  });
});
