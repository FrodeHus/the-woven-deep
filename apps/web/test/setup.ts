import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no WebGL, so the real PixiJS `IsoRenderer` can never mount in a test. Replace it with an
// inert stand-in for every test file: PlayScreen renders that do not inject their own `createRenderer`
// (App-level boot tests, keyboard/palette tests) get this harmless renderer instead of a real Pixi
// context. Tests that need to observe or drive the renderer inject `fakePlayfieldRenderer` explicitly.
vi.mock('../src/ui/playfield/IsoRenderer.js', () => ({
  IsoRenderer: class {
    init(): Promise<void> {
      return Promise.resolve();
    }
    setSnapshot(): void {}
    setTargeting(): void {}
    destroy(): void {}
  },
}));

// The playfield canvas fetches its sprite atlas once via `fetch(ATLAS_URL)`; jsdom has no `fetch`,
// so serve the real atlas JSON off disk for that URL. Any other URL is unhandled on purpose -- a
// test that reaches the network is a mistake, not a silent no-op.
const atlasJson = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../public/playfield/atlas-dungeon.json'),
  'utf8',
);
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/playfield/atlas-dungeon.json')) {
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(atlasJson) as unknown,
    } as Response;
  }
  throw new Error(`unexpected fetch in test: ${url}`);
}) as typeof fetch;

// jsdom has no ResizeObserver. PlayScreen only needs the constructor shape (observe/unobserve/
// disconnect) to exist so mounting it doesn't throw; most PlayScreen tests assert the wiring
// (camera and viewport plumbing) rather than pixel measurement, which is `layout.test.ts`'s job.
// A few tests (the tier-derivation feedback-loop regression) do need to simulate a real resize
// notification for a specific observed element, so the stub tracks which instances are observing
// which elements and exposes a test-only `triggerResize` to fire their callbacks on demand.
const observersByElement = new Map<Element, Set<ResizeObserverStub>>();

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  private readonly elements = new Set<Element>();

  observe(element: Element): void {
    this.elements.add(element);
    let stubs = observersByElement.get(element);
    if (!stubs) {
      stubs = new Set();
      observersByElement.set(element, stubs);
    }
    stubs.add(this);
  }

  unobserve(element: Element): void {
    this.elements.delete(element);
    observersByElement.get(element)?.delete(this);
  }

  disconnect(): void {
    for (const element of this.elements) observersByElement.get(element)?.delete(this);
    this.elements.clear();
  }

  /** test-only: invoked by `triggerResize` to simulate a browser resize notification. */
  notify(element: Element): void {
    this.callback([{ target: element } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

/**
 * Test-only: simulates the browser firing a ResizeObserver callback for `element`, for every
 * stub instance currently observing it. Components under test (PlayScreen) re-read
 * `getBoundingClientRect()` inside the callback rather than trusting the observer entry, so pair
 * this with mocking `getBoundingClientRect` per element to pin distinct widths for distinct
 * observed nodes (e.g. the triptych container vs. the map pane).
 */
export function triggerResize(element: Element): void {
  const stubs = observersByElement.get(element);
  if (!stubs) return;
  for (const stub of stubs) stub.notify(element);
}

// jsdom logs "Not implemented: getContext" to stderr; stub it (returning null) so test output is clean.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
});

// jsdom has no scrollIntoView -- `cmdk` (the command-palette primitive) calls it on the selected
// item whenever the filtered set changes, which would otherwise throw for every CommandPalette
// test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
