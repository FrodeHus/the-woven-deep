import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO, createNewRun, encodeActiveRun, type ActiveRun,
} from '@woven-deep/engine';
import { GuestSession } from '../src/session/guest-session.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { triggerResize } from './setup.js';

let pack: CompiledContentPack;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function fakeStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: string) => { store.set(key, value); },
  };
}

function session(): GuestSession {
  return new GuestSession({ pack, storage: fakeStorage(), seed: SEED });
}

/** A fresh session with the hero already standing on the town's stairs down, so a test can
 * dispatch `{ type: 'descend' }` directly without walking there first. */
function sessionAtTownStairs(): GuestSession {
  const fresh = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const heroActor = fresh.actors.find((actor) => actor.playerControlled)!;
  const town = fresh.floors.find((floor) => floor.floorId === heroActor.floorId)!;
  const atStairDown: ActiveRun = {
    ...fresh,
    actors: fresh.actors.map((actor) => actor.actorId === heroActor.actorId
      ? { ...actor, x: town.stairDown!.x, y: town.stairDown!.y } : actor),
  };
  const storage = fakeStorage();
  storage.set(SAVE_KEY, encodeActiveRun(atStairDown));
  return new GuestSession({ pack, storage });
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

// Regression coverage for the bounded playfield zoom (see `zoomForFloor` in layout.ts): a fresh
// run boots straight into the compact 34x16 town floor. `--zoom` is derived from a real probe
// measurement and applied to `.playfield`, not computed in parallel -- by stubbing the probe to
// report an unzoomed cell size and asserting the pane picks a zoom step (rather than asserting a
// raw pixel viewport count, which is layout.test.ts's job for the pure function itself). Layout A
// never reflows its columns, so only the map pane and cell probes need stubbing here -- there is
// no separate container-width measurement to drive.
describe('PlayScreen playfield zoom', () => {
  it('applies a --zoom > 1 to .playfield when a small floor (town) sits in a spacious pane', () => {
    const { container } = render(<PlayScreen session={session()} pack={pack} />);
    const mapPane = container.querySelector('.map-pane')!;
    const probe = container.querySelector('.cell-probe')!;
    // `.cell-probe-base` is what `zoomForFloor` is actually fed (see PlayScreen's measure effect):
    // it reports the base (1x) cell size regardless of the applied zoom, so it must be stubbed
    // with the SAME unzoomed size as `.cell-probe`'s initial (zoom=1) reading.
    const probeBase = container.querySelector('.cell-probe-base')!;

    stubRect(mapPane, 2000, 2000);
    stubRect(probe, 8, 16);
    stubRect(probeBase, 8, 16);
    act(() => {
      triggerResize(mapPane);
    });

    const playfield = container.querySelector('.playfield') as HTMLDivElement;
    const zoom = Number(playfield.style.getPropertyValue('--zoom'));
    expect(zoom).toBeGreaterThan(1);
    expect(zoom).toBeLessThanOrEqual(2);
  });

  it('leaves --zoom at 1 when the floor already fills the pane at 1x (dungeon-sized floor case)', () => {
    const { container } = render(<PlayScreen session={session()} pack={pack} />);
    const mapPane = container.querySelector('.map-pane')!;
    const probe = container.querySelector('.cell-probe')!;
    const probeBase = container.querySelector('.cell-probe-base')!;

    stubRect(mapPane, 400, 300);
    stubRect(probe, 8, 16);
    stubRect(probeBase, 8, 16);
    act(() => {
      triggerResize(mapPane);
    });

    const playfield = container.querySelector('.playfield') as HTMLDivElement;
    expect(Number(playfield.style.getPropertyValue('--zoom'))).toBe(1);
  });

  // Regression for the bug caught during Task 8's browser verification: the map-pane measure
  // effect originally had `[]` deps and closed over `projection.floor` from mount time, so
  // descending/ascending stairs (which changes the floor's dimensions but fires no pane resize)
  // left the PREVIOUS floor's zoom applied to the new floor. This must FAIL if the effect's
  // dependency array loses `projection.floor.floorId` — verified by temporarily reverting that
  // dependency to `[]` and confirming this test goes red, then restoring it.
  it('re-derives --zoom when the floor changes (a descend), without any new pane resize event', () => {
    const guestSession = sessionAtTownStairs();
    const { container } = render(<PlayScreen session={guestSession} pack={pack} />);
    const mapPane = container.querySelector('.map-pane')!;
    const probe = container.querySelector('.cell-probe')!;
    const probeBase = container.querySelector('.cell-probe-base')!;

    // A pane roomy enough that the compact town floor (34x16) reaches the max 2x zoom step, but a
    // dungeon floor (160x50) can only reach 1.5x — two different, both non-trivial answers, so a
    // stale zoom left over from the town would be visibly wrong rather than accidentally correct.
    stubRect(mapPane, 2000, 2000);
    stubRect(probe, 8, 16);
    stubRect(probeBase, 8, 16);
    act(() => {
      triggerResize(mapPane);
    });

    const playfield = container.querySelector('.playfield') as HTMLDivElement;
    expect(Number(playfield.style.getPropertyValue('--zoom'))).toBe(2);

    // Descend — this changes `projection.floor.floorId` (town -> a depth-1 dungeon floor) but
    // does not touch the map pane's own box, so no ResizeObserver notification fires on its own.
    act(() => {
      guestSession.dispatch({ type: 'descend' });
    });

    expect(Number(playfield.style.getPropertyValue('--zoom'))).toBe(1.5);
  });
});
