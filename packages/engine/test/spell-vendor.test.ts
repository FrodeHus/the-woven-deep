import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type MerchantPopulation,
  type Uint32State,
} from '../src/index.js';
import type { CompiledContentPack } from '@woven-deep/content';

const SEED = [1, 2, 3, 4] as unknown as Uint32State;

let pack: CompiledContentPack;
beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function vendorPopulation(run: ActiveRun): MerchantPopulation | undefined {
  const vendor = run.actors.find((actor) => actor.contentId === 'npc.town-spellvendor');
  if (!vendor?.populationId) return undefined;
  return run.populations.find(
    (population): population is MerchantPopulation =>
      population.model === 'merchant' && population.populationId === vendor.populationId,
  );
}

describe('spell vendor', () => {
  it('compiles the vendor content and its stock table', () => {
    expect(pack.entries.some((e) => e.id === 'npc.town-spellvendor')).toBe(true);
    expect(pack.entries.some((e) => e.id === 'encounter.town-spellvendor')).toBe(true);
    expect(pack.entries.some((e) => e.id === 'loot-table.town-spellvendor-stock')).toBe(true);
  });

  it('places the permanent spell vendor as an actor on the town floor at run start', () => {
    // The town is the run's only floor at creation; merchants materialize as actors on it.
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const townFloorId = run.activeFloorId;
    const vendor = run.actors.find(
      (actor) => actor.contentId === 'npc.town-spellvendor' && actor.floorId === townFloorId,
    );
    expect(vendor).toBeDefined();
  });

  it('materializes deterministic vendor stock across identical seeds', () => {
    const a = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const b = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const stockOf = (run: ActiveRun) => vendorPopulation(run)?.stockItemIds ?? null;
    expect(stockOf(a)).not.toBeNull();
    expect(JSON.stringify(stockOf(a))).toBe(JSON.stringify(stockOf(b)));
  });
});
