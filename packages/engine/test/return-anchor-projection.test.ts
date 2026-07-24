import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type ActiveRun,
} from '../src/index.js';

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

describe('returnAnchorDepth projection', () => {
  it('is absent when no recall anchor is set', () => {
    const run = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
    const projection = projectGameplayState({ state: run, content: pack });
    expect('returnAnchorDepth' in projection).toBe(false);
  });

  it('resolves the anchored floor depth when set', () => {
    const run = createNewRun({ pack, seed: [1, 2, 3, 4], hero: DEFAULT_GUEST_HERO });
    const anchor = run.floors[0]!;
    const anchored: ActiveRun = { ...run, returnAnchorFloorId: anchor.floorId };
    const projection = projectGameplayState({ state: anchored, content: pack });
    expect(projection.returnAnchorDepth).toBe(anchor.depth);
  });
});
