import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no ResizeObserver. PlayScreen only needs the constructor shape (observe/unobserve/
// disconnect) to exist so mounting it doesn't throw; PlayScreen tests assert the wiring (camera
// and viewport plumbing) rather than pixel measurement, which is `layout.test.ts`'s job.
class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

afterEach(() => {
  cleanup();
});
