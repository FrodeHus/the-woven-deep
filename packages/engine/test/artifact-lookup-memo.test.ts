import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { artifactById, artifactItemIds } from '../src/commerce.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/**
 * `artifactItemIds` and `artifactById` sit on hot per-command paths (`validateContentBoundRun`,
 * `consumeFuel`'s per-item loop), so they must not rescan `content.entries` per call (#171). The
 * cache is keyed by pack identity: same pack object, same derived structures.
 */
describe('pack-derived artifact lookups are memoized per pack', () => {
  it('returns the identical id set for repeated calls with the same pack', () => {
    expect(artifactItemIds(pack)).toBe(artifactItemIds(pack));
  });

  it('resolves artifacts through the memoized index with unchanged results', () => {
    const ids = [...artifactItemIds(pack)];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(artifactById(pack, id)).not.toBeNull();
    }
    expect(artifactById(pack, ids[0])).toBe(artifactById(pack, ids[0]));
    expect(artifactById(pack, 'item.not-an-artifact' as never)).toBeNull();
  });

  it('keys the cache by pack identity, not globally', () => {
    const clone: CompiledContentPack = { ...pack, entries: [...pack.entries] };
    expect(artifactItemIds(clone)).not.toBe(artifactItemIds(pack));
    expect([...artifactItemIds(clone)]).toEqual([...artifactItemIds(pack)]);
  });
});
