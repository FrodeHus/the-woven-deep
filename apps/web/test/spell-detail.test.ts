import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import { describeSpell, aoeBadge } from '../src/session/spell-detail.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('aoeBadge', () => {
  it('formats a burst radius', () => {
    expect(aoeBadge({ shape: 'burst', radius: 2 })).toBe('burst r2');
  });
  it('formats line/cone without radius', () => {
    expect(aoeBadge({ shape: 'line', radius: 4 })).toBe('line');
    expect(aoeBadge({ shape: 'cone', radius: 3 })).toBe('cone');
  });
  it('returns null when absent', () => {
    expect(aoeBadge(undefined)).toBeNull();
  });
});

describe('describeSpell', () => {
  it('summarizes a burst spell from the pack + runtime view', () => {
    const spell = {
      spellId: 'spell.fireball',
      name: 'Fireball',
      weaveCost: 6,
      range: 6,
      targetingId: 'target.burst',
      aoe: { shape: 'burst', radius: 2 },
    } as const;
    const detail = describeSpell({ spell, pack });
    expect(detail.aoeBadge).toBe('burst r2');
    expect(detail.rangeLabel).toBe('Range 6');
    expect(detail.targetingLabel).toMatch(/burst/i);
    expect(detail.effects.length).toBeGreaterThan(0); // from SpellContentEntry.effects
  });
});
