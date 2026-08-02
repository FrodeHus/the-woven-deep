import { describe, expect, it } from 'vitest';
import type { RendererCallbacks } from '../src/ui/playfield/IsoRenderer.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';

const callbacks: RendererCallbacks = {
  onCellClick: () => {},
  onCellHover: () => {},
};

function createInstance(fake: ReturnType<typeof fakePlayfieldRenderer>): void {
  fake.createRenderer(
    document.createElement('div'),
    {} as never,
    callbacks,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('fakePlayfieldRenderer.ready', () => {
  it('resolves with the latest instance when one already exists', async () => {
    const fake = fakePlayfieldRenderer();
    createInstance(fake);
    expect(await fake.ready()).toBe(fake.latest());
  });

  it('waits for an instance created after the wait starts', async () => {
    const fake = fakePlayfieldRenderer();
    const pending = fake.ready();
    setTimeout(() => createInstance(fake), 10);
    expect(await pending).toBe(fake.latest());
  });
});
