import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

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

afterEach(() => {
  cleanup();
});
