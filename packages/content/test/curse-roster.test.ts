import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { CurseContentEntry } from '../src/model.js';

describe('curse roster', () => {
  it('represents all three curse anatomies: drawback-only, trigger-only, and both', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const curses = pack.entries.filter(
      (entry): entry is CurseContentEntry => entry.kind === 'curse',
    );
    expect(curses.length).toBeGreaterThan(0);

    const drawbackOnly = curses.filter(
      (curse) => Object.keys(curse.drawbackModifiers).length > 0 && curse.trigger === null,
    );
    const triggerOnly = curses.filter(
      (curse) => Object.keys(curse.drawbackModifiers).length === 0 && curse.trigger !== null,
    );
    const both = curses.filter(
      (curse) => Object.keys(curse.drawbackModifiers).length > 0 && curse.trigger !== null,
    );

    expect(drawbackOnly.length, 'expected at least one drawback-only curse').toBeGreaterThan(0);
    expect(triggerOnly.length, 'expected at least one trigger-only curse').toBeGreaterThan(0);
    expect(
      both.length,
      'expected at least one curse with both a drawback and a trigger',
    ).toBeGreaterThan(0);

    // Every curse must be one of the three anatomies -- none can be entirely empty (the compiler
    // already rejects that), and this keeps the partition exhaustive as the roster grows.
    expect(drawbackOnly.length + triggerOnly.length + both.length).toBe(curses.length);
  });

  it('never spends a drawback on maxHealth', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    // An actor's maxHealth is fixed at run creation and never rewritten from the derived value, so
    // a maxHealth drawback reads as a real penalty on the sheet while costing the hero nothing.
    // The compiler rejects it; this keeps the shipped roster honest as it grows.
    for (const entry of pack.entries) {
      if (entry.kind !== 'curse') continue;
      expect(Object.keys((entry as CurseContentEntry).drawbackModifiers), entry.id).not.toContain(
        'maxHealth',
      );
    }
  });
});
