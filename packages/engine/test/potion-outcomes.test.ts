import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  allocateIdentificationMap,
  createDemoRun,
  heroActor,
  resolveCommand,
  type ActiveRun,
  type ItemInstance,
} from '../src/index.js';

const HERO_ID = 'hero.demo';
const POTION_ITEM_ID = 'item.hero.draught';

/** Every potion in the shuffled pool, so a newly authored one is covered the day it lands. */
function poolPotionIds(pack: CompiledContentPack): readonly string[] {
  return pack.entries
    .filter(
      (entry) =>
        entry.kind === 'item' && entry.identification.poolId === 'identification-pool.potions',
    )
    .map((entry) => entry.id)
    .sort();
}

describe('drinking a potion', () => {
  let pack: CompiledContentPack;

  beforeAll(async () => {
    pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
  });

  function runHolding(contentId: string, health: number): ActiveRun {
    const base = createDemoRun();
    const allocated = allocateIdentificationMap({ content: pack, rng: base.rng });
    const potion: ItemInstance = {
      itemId: POTION_ITEM_ID,
      contentId,
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: false,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'backpack', actorId: HERO_ID },
    };
    return {
      ...base,
      contentHash: pack.hash,
      identification: allocated.identification,
      rng: allocated.rng,
      encounterDecisions: pack.entries
        .filter((entry) => entry.kind === 'encounter')
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((entry) => ({
          encounterId: entry.id,
          baseProbability: entry.runAppearanceChance,
          protectionBonus: 0,
          effectiveProbability: entry.runAppearanceChance,
          eligible: true,
          reachedEligibleDepth: false,
          encountered: false,
          instancesCreated: 0,
        })),
      actors: base.actors.map((actor) =>
        actor.actorId === HERO_ID ? { ...actor, health } : actor,
      ),
      items: [potion],
    };
  }

  function drink(run: ActiveRun) {
    return resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.drink',
        expectedRevision: run.revision,
        itemId: POTION_ITEM_ID,
        target: null,
      },
      { content: pack },
    );
  }

  // Two authoring traps this covers, both of which pass content validation cleanly and only bite a
  // player mid-run (see the potion-risk design):
  //  - `use-item` resolves only `DIRECT_EFFECT_IDS` and passes an empty `operations` seam, so a
  //    potion built on e.g. `effect.reveal` throws `effect operation ... is unavailable` on drink.
  //  - `actions.ts` gates a few effects on hero state (`effect.curse.remove` needs a revealed
  //    curse), and on an UNIDENTIFIED item a free, costless rejection fingerprints the appearance.
  // A hero with no curse, no conditions, and nothing special in the pack must be able to drink
  // every potion in the pool, so both traps surface here.
  it('resolves every potion in the pool without an unavailable or gated effect', () => {
    for (const contentId of poolPotionIds(pack)) {
      const run = runHolding(contentId, 12);
      expect(() => drink(run)).not.toThrow();
      const resolved = drink(run);
      expect({ contentId, status: resolved.result.status }).toEqual({
        contentId,
        status: 'applied',
      });
    }
  });

  it('reveals the appearance of every potion it resolves, harmful ones included', () => {
    for (const contentId of poolPotionIds(pack)) {
      const run = runHolding(contentId, 12);
      const resolved = drink(run);
      const appearanceId = run.identification.appearanceByContentId[contentId]!;
      expect({ contentId, known: resolved.state.identification.knownAppearanceIds }).toEqual({
        contentId,
        known: [appearanceId],
      });
    }
  });

  it('leaves the hero worse off for a bitter draught: damage now, poison after', () => {
    const run = runHolding('item.bitter-potion', 12);
    const resolved = drink(run);
    const hero = heroActor(resolved.state);
    expect(hero.health).toBeLessThan(12);
    expect(hero.conditions.map((condition) => condition.conditionId)).toContain(
      'condition.sickened',
    );
  });

  it('sets a searing phial alight on the drinker', () => {
    const run = runHolding('item.searing-potion', 12);
    const resolved = drink(run);
    const hero = heroActor(resolved.state);
    expect(hero.health).toBeLessThan(12);
    expect(hero.conditions.map((condition) => condition.conditionId)).toContain(
      'condition.burning',
    );
  });

  it('heals for a numbing tonic and charges for it in accuracy', () => {
    const run = runHolding('item.numbing-potion', 5);
    const resolved = drink(run);
    const hero = heroActor(resolved.state);
    expect(hero.health).toBeGreaterThan(5);
    expect(hero.conditions.map((condition) => condition.conditionId)).toContain(
      'condition.chilled',
    );
  });

  it('feeds on a clouded draught and drinks even with nothing to cure', () => {
    const base = runHolding('item.clouded-potion', 12);
    // The demo hero starts at the authored hunger maximum, where a restore has nowhere to go.
    const run: ActiveRun = { ...base, survival: { ...base.survival, hungerReserve: 2000 } };
    const resolved = drink(run);
    expect(heroActor(resolved.state).health).toBe(12);
    expect(resolved.state.survival.hungerReserve).toBeGreaterThan(run.survival.hungerReserve);
    expect(resolved.state.items.some((item) => item.itemId === POTION_ITEM_ID)).toBe(false);
  });

  it('answers the pool it belongs to: a clouded draught clears burning and sickness', () => {
    const bitten = runHolding('item.clouded-potion', 12);
    const afflicted: ActiveRun = {
      ...bitten,
      actors: bitten.actors.map((actor) =>
        actor.actorId === HERO_ID
          ? {
              ...actor,
              conditions: [
                { conditionId: 'condition.burning', stacks: 1, expiresAtWorldTime: 999999 },
                { conditionId: 'condition.sickened', stacks: 1, expiresAtWorldTime: 999999 },
              ],
            }
          : actor,
      ),
    };
    expect(heroActor(drink(afflicted).state).conditions).toEqual([]);
  });
});
