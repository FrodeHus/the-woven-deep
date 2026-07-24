import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import { scrollAimSpell } from '../src/session/scroll-targeting.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('scrollAimSpell', () => {
  it('returns the aimed spell for an offensive scroll (ember bolt = target.actor)', () => {
    const spell = scrollAimSpell(pack, 'item.ember-scroll');
    expect(spell?.spellId).toBe('spell.ember-bolt');
    expect(spell?.targetingId).toBe('target.actor');
  });

  it('returns the AoE spell for a burst scroll (cinder breath / arc lance)', () => {
    const spell = scrollAimSpell(pack, 'item.cinder-breath-scroll');
    expect(spell?.targetingId).toMatch(/^target\.(burst|line|cone)$/);
    expect(spell?.aoe).toBeDefined();
  });

  it('returns null for a tome (learn, no aim)', () => {
    expect(scrollAimSpell(pack, 'item.fireball-tome')).toBeNull();
  });

  it('returns null for a non-spell item', () => {
    expect(scrollAimSpell(pack, 'item.travel-ration')).toBeNull();
  });

  it('returns null for undefined content id (unidentified item)', () => {
    expect(scrollAimSpell(pack, undefined)).toBeNull();
  });
});
