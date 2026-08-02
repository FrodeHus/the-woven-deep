import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ClassContentEntry, FallenChampionTemplateContentEntry } from '@woven-deep/content';
import {
  artifactItemIds,
  createFallenHeroRunDecisions,
  guaranteedUniqueItemIds,
  createNewRun,
  DEFAULT_GUEST_HERO,
  decodeActiveRun,
  descendToNextFloor,
  encodeActiveRun,
  heroActor,
  heroFromChoices,
  itemLightSources,
  resolveCommand,
  validateActiveRun,
  validateContentBoundRun,
  type ActiveRun,
  type FallenHeroStandingSnapshot,
  type HeroChoices,
  type ResolutionContext,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [11, 22, 33, 44] as const;

describe('createNewRun', () => {
  it('builds a valid, deterministic schema-v17 run starting in the authored town', () => {
    const first = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const second = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(encodeActiveRun(first)).toBe(encodeActiveRun(second));
    expect(() => validateActiveRun(first)).not.toThrow();
    expect(first.schemaVersion).toBe(17);
    expect(first.mode).toBe('classic');
    expect(first.hero.tempering).toEqual({
      banked: 0,
      spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
    });
    expect(first.offeredArtifact).toBeNull();
    expect(first.artifactsUndiscovered).toEqual([]);
    expect(first.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(first.restockedMilestones).toEqual([]);
    // The town is the run's only floor at creation -- depth 1 is generated later, on the hero's
    // first descent through the town's dungeon-entrance stair-down.
    expect(first.floors).toHaveLength(1);
    expect(first.floors[0]?.depth).toBe(0);
    expect(first.floors[0]?.floorId).toBe('floor.depth-000');
    expect(first.activeFloorId).toBe(first.floors[0]?.floorId);
    expect(first.floors[0]?.stairUp).toBeNull();
    expect(first.floors[0]?.stairDown).not.toBeNull();
    // The town never counts toward floorsEntered/deepestDepth: those track dungeon progress.
    expect(first.metrics.floorsEntered).toBe(0);
    expect(first.metrics.deepestDepth).toBe(0);
    expect(first.conclusion).toBeNull();
    expect(first.contentHash).toBe(pack.hash);
  });

  it('places and equips the default hero at the town entrance plaza', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = heroActor(run);
    expect(hero.playerControlled).toBe(true);
    expect(hero.attributes).toEqual({
      might: 10,
      agility: 10,
      vitality: 10,
      wits: 10,
      resolve: 10,
    });
    expect(run.hero.name).toBe('Wayfarer');
    const floor = run.floors[0]!;
    expect(hero.floorId).toBe(floor.floorId);
    // The hero starts adjacent to (not on) the dungeon entrance's stair-down tile.
    expect({ x: hero.x, y: hero.y }).not.toEqual(floor.stairDown);
    const equippedContent = Object.values(hero.equipment)
      .filter((id): id is string => id !== null)
      .map((itemId) => run.items.find((item) => item.itemId === itemId)?.contentId)
      .sort();
    expect(equippedContent).toEqual(['item.iron-sword', 'item.leather-armor', 'item.pitch-torch']);
    const torch = run.items.find((item) => item.contentId === 'item.pitch-torch')!;
    expect(torch.enabled).toBe(true);
    expect(torch.fuel).toBe(800);
    const rations = run.items.find((item) => item.contentId === 'item.travel-ration')!;
    expect(rations.location).toEqual({ type: 'backpack', actorId: hero.actorId });
    expect(rations.quantity).toBe(3);
  });

  it("grants the hero the balance entry's startingCurrency, not zero", () => {
    const balance = pack.entries.find((entry) => entry.id === 'balance.core-gameplay');
    if (balance?.kind !== 'balance')
      throw new Error('expected balance.core-gameplay content entry');
    expect(balance.startingCurrency).toBeGreaterThan(0);
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(run.hero.currency).toBe(balance.startingCurrency);
  });

  it('derives different runs from different seeds and round-trips the codec', () => {
    const a = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const b = createNewRun({ pack, seed: [5, 6, 7, 8], hero: DEFAULT_GUEST_HERO });
    expect(a.runId).not.toBe(b.runId);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(a)))).toBe(encodeActiveRun(a));
  });

  it('derives hero maxHealth from attributes and starts at full health', () => {
    const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(heroActor(run).maxHealth).toBe(20); // 10 + 10*1 with the retuned formula
    expect(heroActor(run).health).toBe(20);
    const tough = {
      ...DEFAULT_GUEST_HERO,
      attributes: { ...DEFAULT_GUEST_HERO.attributes, vitality: 14 },
    };
    const toughRun = createNewRun({ pack, seed: SEED, hero: tough });
    expect(heroActor(toughRun).maxHealth).toBe(24);
    expect(heroActor(toughRun).health).toBe(24);
  });

  it('carries classTags and statModifiers onto the hero state', () => {
    const run = createNewRun({
      pack,
      seed: SEED,
      hero: { ...DEFAULT_GUEST_HERO, classTags: ['wayfarer'], statModifiers: { search: 1 } },
    });
    expect(run.hero.classTags).toEqual(['wayfarer']);
    expect(run.hero.statModifiers).toEqual({ search: 1 });
  });

  it('ignores an enabled:true override on a non-light equipped item instead of propagating it (a hand-authored hero, or a stale kit, could still carry one)', () => {
    const run = createNewRun({
      pack,
      seed: SEED,
      hero: {
        ...DEFAULT_GUEST_HERO,
        equipped: [
          { contentId: 'item.iron-sword', slot: 'main-hand', enabled: true },
          { contentId: 'item.leather-armor', slot: 'body', enabled: true },
        ],
      },
    });
    const sword = run.items.find((item) => item.contentId === 'item.iron-sword')!;
    const armor = run.items.find((item) => item.contentId === 'item.leather-armor')!;
    expect(sword.enabled).toBeNull();
    expect(sword.fuel).toBeNull();
    expect(armor.enabled).toBeNull();
    // The real crash this guards against: content-bound validation (run by
    // resolveCommand on a hero's first command) rejects a non-light item that
    // carries fuel/enabled state. validateActiveRun alone does not catch this --
    // it only checks save-schema shape, not cross-referenced content invariants.
    expect(() => validateContentBoundRun(run, pack)).not.toThrow();
  });

  it('rejects an all-zero seed and unknown equipment content', () => {
    expect(() => createNewRun({ pack, seed: [0, 0, 0, 0], hero: DEFAULT_GUEST_HERO })).toThrow(
      /seed/i,
    );
    expect(() =>
      createNewRun({
        pack,
        seed: SEED,
        hero: {
          ...DEFAULT_GUEST_HERO,
          equipped: [{ contentId: 'item.no-such-thing', slot: 'main-hand' }],
        },
      }),
    ).toThrow(/item\.no-such-thing/);
  });

  // Closes the gap that let the kit-created-hero-crashes-on-first-command regression slip
  // through with only 1-of-4 bundled kits under test: every playable class's every kit must
  // survive chargen -> createNewRun -> content-bound validation -> a first resolved command.
  // Kits are discovered from the compiled pack (not hardcoded), so a future kit is covered
  // automatically instead of silently falling through untested.
  it('survives chargen, createNewRun, content-bound validation, and a first command for every playable class and kit', () => {
    const backgroundId = 'background.caravan-guard';
    const context: ResolutionContext = { content: pack };
    const playableClasses = pack.entries.filter(
      (entry): entry is ClassContentEntry => entry.kind === 'class' && entry.playable,
    );
    expect(playableClasses.length).toBeGreaterThan(0);

    let checked = 0;
    for (const classEntry of playableClasses) {
      for (const kit of classEntry.kits) {
        const choices: HeroChoices = {
          name: 'Coverage Hero',
          method: 'roll',
          attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
          classId: classEntry.id,
          kitId: kit.kitId,
          backgroundId,
          traitIds: [],
        };
        const hero = heroFromChoices({ pack, choices });
        const run = createNewRun({ pack, seed: SEED, hero });
        expect(() => validateContentBoundRun(run, pack)).not.toThrow();

        const wait = resolveCommand(
          run,
          {
            type: 'wait',
            commandId: `command.coverage-${classEntry.id}-${kit.kitId}`,
            expectedRevision: run.revision,
          },
          context,
        );
        expect(wait.result.status).toBe('applied');
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  // Regression lock for the itemId-collision fix in new-run.ts (`heroEquippedItemId`/
  // `heroBackpackItemId` discriminate by slot/index, not contentId alone): the lamplighter's
  // torchbearer kit deliberately equips item.pitch-torch AND carries a second item.pitch-torch in
  // the backpack. Before that fix, both instances would derive the SAME itemId from contentId
  // alone, violating the save schema's strictly-increasing/unique itemId invariant that
  // `validateOrderedIds` (save-schema.ts) enforces — `encodeActiveRun` would throw.
  it('encodes a torchbearer-kit run without an itemId collision on its duplicated pitch-torch contentId', () => {
    const choices: HeroChoices = {
      name: 'Torchbearer',
      method: 'roll',
      attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
      classId: 'class.lamplighter',
      kitId: 'torchbearer',
      backgroundId: 'background.caravan-guard',
      traitIds: [],
    };
    const hero = heroFromChoices({ pack, choices });
    const run = createNewRun({ pack, seed: SEED, hero });

    const torchItems = run.items.filter((item) => item.contentId === 'item.pitch-torch');
    expect(torchItems).toHaveLength(2);
    expect(new Set(torchItems.map((item) => item.itemId)).size).toBe(2);
    expect(() => validateActiveRun(run)).not.toThrow();
    expect(() => encodeActiveRun(run)).not.toThrow();
  });

  it('defaults a new run to classic mode', () => {
    expect(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }).mode).toBe('classic');
  });

  it('creates a wanderer run when asked', () => {
    expect(
      createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' }).mode,
    ).toBe('wanderer');
  });

  it('consumes identical randomness in both modes', () => {
    const classic = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'classic' });
    const wanderer = createNewRun({
      pack,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      mode: 'wanderer',
    });
    expect(wanderer.rng).toEqual(classic.rng);
    expect({ ...wanderer, mode: 'classic' }).toEqual(classic);
  });

  it('starts a new run with zeroed tempering', () => {
    expect(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }).hero.tempering).toEqual({
      banked: 0,
      spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
    });
  });

  describe('engine-required floor loot tables', () => {
    const MISSING = 'loot-table.chest-mid';

    function packMissingChestMid(): CompiledContentPack {
      return { ...pack, entries: pack.entries.filter((entry) => entry.id !== MISSING) };
    }

    it('rejects run creation against a pack missing one, naming the id', () => {
      expect(() =>
        createNewRun({ pack: packMissingChestMid(), seed: SEED, hero: DEFAULT_GUEST_HERO }),
      ).toThrow(MISSING);
    });

    it('rejects a save load against a pack missing one, naming the id', () => {
      const blob = encodeActiveRun(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
      expect(() => decodeActiveRun(blob, packMissingChestMid())).toThrow(MISSING);
      // The save itself is fine, so decoding it without a pack still succeeds.
      expect(() => decodeActiveRun(blob)).not.toThrow();
    });
  });
});

describe('createNewRun records input', () => {
  function standing(rank: number): FallenHeroStandingSnapshot {
    const hallRecordId = `hall.new-run-${rank}`;
    const heirloom = {
      contentId: 'item.iron-sword',
      sourceItemId: `item.new-run-original-${rank}`,
      enchantment: null,
      condition: 81,
      charges: null,
      fuel: null,
      curse: null,
      qualityRank: 2,
      displayName: `Iron Sword ${rank}`,
      glyph: ')',
      color: '#d8d8d8',
      originatingHallRecordId: hallRecordId,
    };
    return {
      rank,
      hallRecordId,
      heroName: rank === 1 ? 'Ada' : `Bryn ${rank}`,
      portraitGlyph: '@',
      classTags: ['fighter'],
      attributes: { might: 18 - rank, agility: 12, vitality: 16, wits: 10, resolve: 14 },
      equippedItemContentIds: ['item.iron-sword'],
      signatureAbilityIds: ['spell.ember-bolt'],
      deathDepth: 5,
      sourceContentHash: 'b'.repeat(64),
      heirloom,
      cause: null,
      deathInventory: [heirloom],
    };
  }

  function championTemplate(source: CompiledContentPack): FallenChampionTemplateContentEntry {
    const entry = source.entries.find(
      (candidate): candidate is FallenChampionTemplateContentEntry =>
        candidate.kind === 'fallen-champion-template',
    );
    if (!entry) throw new Error('content pack requires a fallen-champion-template');
    return entry;
  }

  function packWithOfferPercent(percent: number): CompiledContentPack {
    return {
      ...pack,
      entries: pack.entries.map((entry) =>
        entry.kind === 'balance'
          ? { ...entry, generation: { ...entry.generation, artifactOfferPercent: percent } }
          : entry,
      ),
    };
  }

  function vaultPool(source: CompiledContentPack): readonly string[] {
    const bossUniques = guaranteedUniqueItemIds(source);
    return [...artifactItemIds(source)].filter((id) => !bossUniques.has(id)).sort();
  }

  const EMPTY_RECORDS = {
    standings: [],
    undiscoveredArtifactIds: [],
    conqueredChampionRecordIds: [],
  } as const;

  it('leaves the omitted-records run byte-identical to the recordless creation path', () => {
    const omitted = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const empty = createNewRun({
      pack,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      records: EMPTY_RECORDS,
    });
    expect(encodeActiveRun(empty)).toBe(encodeActiveRun(omitted));
    expect(omitted.offeredArtifact).toBeNull();
    expect(omitted.artifactsUndiscovered).toEqual([]);
    expect(omitted.fallenHeroStandings).toEqual([]);
    expect(omitted.fallenHeroDecisions).toEqual([]);
    expect(omitted.conqueredChampionRecordIds).toEqual([]);
    // Pinned digest: the no-records path must never drift, including its RNG streams. The encoded
    // run carries the pack hash, so every content edit moves this digest through `contentHash`
    // alone; a delta in any other field is a real behavioral drift and must not be re-pinned away.
    // Re-pinned for the identification.mode: instance sweep (base weapon/armor/shield/ring/light
    // equipment moves off `known`), which changes the default hero's starting-item identified
    // state, and again for the sixth (trigger-only) curse added to the roster, which moves
    // `contentHash` -- both are expected drift, not a behavioral regression. Re-pinned again for
    // save schema v14 (`ItemInstance.curse`), which moves `schemaVersion` alone, and again for
    // re-authoring `curse.hungering-edge`'s inert `maxHealth` drawback onto `meleeAccuracy`, which
    // was verified to move `contentHash` and nothing else in the encoded run.
    // Re-pinned again for the Town Curios Dealer's new `merchant-service.remove-curse` offer
    // (content/encounters/town-merchants.yaml) plus the matching `neutral`/`trusted` faction
    // `serviceIds` grant (content/npc-factions/town-merchants.yaml): `materializeMerchant` rolls
    // one `remainingUses` die per authored service
    // (packages/engine/src/merchant-stock.ts:120-129), so the curios dealer's now-two-entry
    // `services` list consumes one additional `merchant-stock` roll during town materialization.
    // That shifts the shared `merchant-stock` stream for every merchant materialized afterward
    // (verified: the Town Spell Vendor's stock selection changes downstream), so this re-pin moves
    // `contentHash`, `items`, `populations`, and `rng['merchant-stock']` -- confirmed by diffing the
    // decoded run objects field-by-field against the prior pin; no other key differs, and no other
    // RNG stream moves. This is expected content-authoring drift from adding a merchant service (the
    // same category the curse-roster note above and `curse-generation.ts`'s "a pack edit ... is
    // expected to move every downstream roll" comment already describe), not an engine regression.
    // Re-pinned again for the scroll of sundering (content/items/sundering-scroll.yaml, a new
    // `known`-identification item so it never touches the identification-pool sweep) plus its
    // low-weight `loot-table.floor-scatter-deep` and `loot-table.chest-deep` choices: verified by
    // diffing the decoded run objects field-by-field against the prior pin -- only `contentHash`
    // differs, nothing else. This is expected content-authoring drift, not an engine regression.
    // Re-pinned again for save schema v15 (`ActiveRun.mode`, run-modes feature): `schemaVersion`
    // moves 14 -> 15 and every encoded run now carries `mode: 'classic'`; no other key differs.
    // This is the expected save-schema bump, not an engine regression.
    // Re-pinned again for save schema v16 (haunts): `schemaVersion` moves 15 -> 16. This run's
    // `fallenHeroStandings`/`fallenHeroDecisions` are both empty (no records input), so no
    // standing/decision content is affected -- the digest moves purely from the schema literal.
    // This is the expected save-schema bump, not an engine regression.
    // Re-pinned again for content schema v13 (the haunt `appeasement` block on
    // `fallen-champion-template`): the block is inert schema -- no generation, RNG stream, or
    // loot/merchant logic reads it yet -- so the digest moves purely because `contentHash` covers
    // the whole compiled pack and the template entry grew a field. This is expected
    // content-authoring drift, not an engine regression.
    // Re-pinned again for save schema v17 (hero tempering + the `enchanting` stream,
    // hero-power-curve feature): `schemaVersion` moves 16 -> 17, every encoded hero now carries a
    // zeroed `tempering`, and `rng` gains the seed-derived `enchanting` stream (the FIRST new RNG
    // stream since the eleven-stream list froze) -- no other key differs. This is the expected
    // save-schema bump, not an engine regression.
    // Re-pinned again for content schema v14 (the `enchantment` kind, `tempering`/
    // `spellPowerDivisor`/`enchanting` balance knobs, and the required `formulas.spellPower`
    // entry): `contentHash` moves because the compiled pack grew a kind and the balance entry grew
    // fields, and every hero's derived stats now include `spellPower` alongside the existing
    // derived-stat set -- no RNG stream moves (enchanting is drawn only by the enchant service and
    // the tempering-steel scroll, neither reachable from run creation). This is expected
    // content-authoring drift, not an engine regression.
    // Re-pinned again for the new `enchantment.guard` ring entry (content/enchantments/
    // core-enchantments.yaml, added so `gameplay-fixture.ts`'s pre-existing test ring enchantment
    // resolves against the registry now that `content-bound-validation.ts` requires every
    // `enchantment.enchantmentId` to exist): `contentHash` moves because the compiled pack grew an
    // entry; verified by diffing the decoded run object field-by-field against the prior pin --
    // `items`, `populations`, and every RNG stream (including `enchanting`) are byte-identical, only
    // `contentHash` differs. This is expected content-authoring drift, not an engine regression.
    expect(createHash('sha256').update(encodeActiveRun(omitted)).digest('hex')).toBe(
      'b967c420465be05b7338024455f3c33abda30d906207112783b2c786e7c1fed9',
    );
  });

  it('seeds standings, conquered ids, and fallen-hero decisions from the records input', () => {
    const standings = [standing(1), standing(2), standing(3)];
    const conquered = ['hall.new-run-1'];
    const run = createNewRun({
      pack,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      records: { standings, undiscoveredArtifactIds: [], conqueredChampionRecordIds: conquered },
    });
    const base = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const expected = createFallenHeroRunDecisions({
      standings,
      conqueredChampionRecordIds: conquered,
      template: championTemplate(pack),
      state: base.rng['population-gates'],
    });
    expect(run.fallenHeroStandings).toEqual(standings);
    expect(run.conqueredChampionRecordIds).toEqual(conquered);
    expect(run.fallenHeroDecisions).toEqual(expected.decisions);
    expect(run.rng['population-gates']).toEqual(expected.state);
    // The conquered champion is not retained; the Echoes carry their gate rolls.
    expect(run.fallenHeroDecisions[0]?.retained).toBe(false);
    expect(run.fallenHeroDecisions[1]?.gateRoll).not.toBeNull();
    expect(() => validateActiveRun(run)).not.toThrow();
    expect(() => validateContentBoundRun(run, pack)).not.toThrow();
  });

  it('sorts undiscovered artifact ids and drops ids the pack does not define as artifacts', () => {
    const pool = vaultPool(pack);
    expect(pool.length).toBeGreaterThan(1);
    const unsorted = [pool[1]!, pool[0]!, 'item.iron-sword', 'item.not-in-this-pack'];
    const run = createNewRun({
      pack: packWithOfferPercent(0),
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      records: {
        standings: [],
        undiscoveredArtifactIds: unsorted,
        conqueredChampionRecordIds: [],
      },
    });
    expect(run.artifactsUndiscovered).toEqual([pool[0]!, pool[1]!]);
  });

  it('rolls the artifact offer deterministically off the run-records stream', () => {
    const records = {
      standings: [],
      undiscoveredArtifactIds: vaultPool(pack),
      conqueredChampionRecordIds: [],
    } as const;
    const first = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, records });
    const second = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, records });
    expect(encodeActiveRun(second)).toBe(encodeActiveRun(first));
    expect(first.offeredArtifact).toBe(second.offeredArtifact);
    // The offer roll is the only creation-time consumer of `run-records`.
    const base = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    expect(first.rng['run-records']).not.toEqual(base.rng['run-records']);
  });

  it('consumes no run-records randomness when the vault pool is empty', () => {
    const base = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const bossUniquesOnly = [...guaranteedUniqueItemIds(pack)].filter((id) =>
      artifactItemIds(pack).has(id),
    );
    expect(bossUniquesOnly.length).toBeGreaterThan(0);
    const run = createNewRun({
      pack,
      seed: SEED,
      hero: DEFAULT_GUEST_HERO,
      records: {
        standings: [],
        undiscoveredArtifactIds: bossUniquesOnly,
        conqueredChampionRecordIds: [],
      },
    });
    expect(run.offeredArtifact).toBeNull();
    expect(run.rng['run-records']).toEqual(base.rng['run-records']);
  });

  it('never offers at artifactOfferPercent 0 and always offers a pool member at 100', () => {
    const pool = vaultPool(pack);
    const records = {
      standings: [],
      undiscoveredArtifactIds: pool,
      conqueredChampionRecordIds: [],
    } as const;
    const seeds = [SEED, [5, 6, 7, 8], [101, 202, 303, 404], [7, 7, 7, 7]] as const;
    for (const seed of seeds) {
      const never = createNewRun({
        pack: packWithOfferPercent(0),
        seed,
        hero: DEFAULT_GUEST_HERO,
        records,
      });
      expect(never.offeredArtifact).toBeNull();
      const always = createNewRun({
        pack: packWithOfferPercent(100),
        seed,
        hero: DEFAULT_GUEST_HERO,
        records,
      });
      expect(always.offeredArtifact).not.toBeNull();
      expect(pool).toContain(always.offeredArtifact);
      expect(always.artifactsUndiscovered).toContain(always.offeredArtifact);
      expect(() => validateActiveRun(always)).not.toThrow();
    }
  });
});

// Regression: a guest hero always starts with a lit, equipped torch. If the hero dies from
// starvation mid-worldstep (in the advance-world-time branch, before another actor's pending
// turn is prepared), `itemLightSources` used to keep emitting a light for the now-dead hero
// (it only checked fuel/enabled, not wielder health) while the turn-preparation position map
// filters actors to `health > 0`. The lighting resolver then failed to resolve the dead
// hero's actor id and threw a RangeError, crashing the whole command.
describe('dead wielders and illumination', () => {
  it('does not crash illumination when a starving hero with a lit torch dies mid-command', () => {
    // Real depth-1 generation for this seed places a live individual-model population
    // (two hostile cave rats, already energy-ready) alongside the guest hero -- exactly the
    // "another actor's turn pending" condition that exposes the bug: one of those rats gets
    // its turn prepared in the same resolveWorldStep call that kills the hero from starvation.
    // The run now starts in the (population-free) town, so descend to depth 1 first to reach
    // that real generated population.
    const started = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const townStairDown = started.floors[0]!.stairDown!;
    const startedHero = heroActor(started);
    const onStairs: ActiveRun = validateActiveRun({
      ...started,
      actors: started.actors.map((actor) =>
        actor.actorId === startedHero.actorId
          ? { ...actor, x: townStairDown.x, y: townStairDown.y }
          : actor,
      ),
    });
    const run = descendToNextFloor(onStairs, { content: pack }).state;
    const hero = heroActor(run);
    // Scoped to the hero's own carried torch (not `find`'s first match): depth-1 floor
    // scatter can also seed an unlit pitch-torch on the ground, and content-only loot-table
    // edits shift which item the RNG draws first without changing this scenario's shape.
    const heroTorch = run.items.find(
      (item) =>
        item.contentId === 'item.pitch-torch' &&
        (item.location.type === 'equipped' || item.location.type === 'backpack') &&
        item.location.actorId === hero.actorId,
    );
    expect(heroTorch?.enabled).toBe(true);
    expect(
      run.actors.filter((actor) => actor.actorId !== hero.actorId && actor.health > 0).length,
    ).toBeGreaterThan(0);

    const dyingHero = { ...hero, health: 1 };
    const state = {
      ...run,
      actors: run.actors.map((actor) => (actor.actorId === hero.actorId ? dyingHero : actor)),
      survival: {
        ...run.survival,
        hungerReserve: 0,
        hungerStage: 'starving' as const,
        nextStarvationAt: 1,
      },
    };

    const context: ResolutionContext = { content: pack };
    let result: ReturnType<typeof resolveCommand>;
    expect(() => {
      result = resolveCommand(
        state,
        { type: 'wait', commandId: 'command.starve-with-torch', expectedRevision: state.revision },
        context,
      );
    }).not.toThrow();
    result = result!;
    expect(result.result.status).toBe('applied');
    expect(result.events.map((event) => event.type)).toContain('run.concluded');
    const heroAfter = result.state.actors.find((actor) => actor.actorId === hero.actorId);
    expect(heroAfter?.health).toBe(0);
    expect(result.state.conclusion).not.toBeNull();
    expect(() => encodeActiveRun(result.state)).not.toThrow();

    // The dead hero's torch must no longer illuminate: it must not appear as a light source
    // referencing an actor absent from the floor's living-actor position map.
    const torch = result.state.items.find((item) => item.itemId === heroTorch!.itemId)!;
    const lights = itemLightSources({ run: result.state, content: pack, floorId: hero.floorId });
    expect(lights.some((light) => light.lightId === torch.itemId)).toBe(false);
  });
});
