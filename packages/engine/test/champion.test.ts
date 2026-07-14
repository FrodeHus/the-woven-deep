import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack, FallenChampionTemplateContentEntry, ItemContentEntry, LootTableContentEntry,
  MonsterContentEntry, SpellContentEntry,
} from '@woven-deep/content';
import {
  advanceFallenHeroEncounters, createDemoContentPack, createDemoRun, createFallenHeroRunDecisions,
  decodeActiveRun, encodeActiveRun, normalizeFallenHero, placeFallenHeroEncounters,
  retainEchoCandidates, validateContentBoundRun, type ActiveRun, type FallenHeroStandingSnapshot,
} from '../src/index.js';

const monster: MonsterContentEntry = {
  kind: 'monster', id: 'monster.champion-fallback', name: 'Ashen Warden', tags: ['boss'], glyph: 'W', color: '#aa7755',
  attributes: { might: 18, agility: 12, vitality: 20, wits: 10, resolve: 16 }, health: 120,
  speed: 100, accuracy: 18, defense: 16, perception: 10, damage: { count: 3, sides: 10, bonus: 8 }, armor: 8,
  resistances: { physical: 10, fire: 20, cold: 0, lightning: 0, poison: 30, arcane: 0 },
  disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
  minDepth: 1, maxDepth: 20, rarity: 'legendary',
};

function item(id: string, overrides: Partial<ItemContentEntry> = {}): ItemContentEntry {
  return { kind: 'item', id, name: id, description: '', tags: [], glyph: ')', color: '#c0c0c0', category: 'weapon',
    stackLimit: 1, price: 10, rarity: 'rare', heirloomEligible: true, minDepth: 1, maxDepth: 20, actionCost: 100,
    equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] }, combat: null, light: null,
    identification: { mode: 'known', poolId: null }, effects: [], ...overrides };
}

const spell: SpellContentEntry = { kind: 'spell', id: 'spell.ember', name: 'Ember', description: '', tags: [],
  targetingId: 'target.actor', range: 5, actionCost: 100, effects: [] };
const echoLoot: LootTableContentEntry = { kind: 'loot-table', id: 'loot-table.echo', name: 'Echo loot', description: '',
  tags: [], rolls: 1, choices: [{ contentId: 'item.echo-loot', lootTableId: null, weight: 1,
    minimumQuantity: 1, maximumQuantity: 1 }] };
const template: FallenChampionTemplateContentEntry = { kind: 'fallen-champion-template', id: 'fallen-champion-template.core',
  name: "The Deep's Champion", tags: ['champion'], fallbackMonsterId: monster.id, fallbackItemId: 'item.fallback',
  minimumHealth: 30, maximumHealth: 100, attributeMaximum: 20, damageMaximum: 24, abilityLimit: 2,
  echoAppearanceChance: 0.5, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70,
  echoDefensePercent: 80, echoAbilityLimit: 1, echoLootTableId: echoLoot.id,
  heirloomSelection: { rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 }, qualityRankBonus: 2 } };

function pack(): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, monster, item('item.heirloom', { light: { color: [255, 220, 180],
    radius: 3, strength: 100, fuelCapacity: 20, fuelPerTime: 1, warningThresholds: [5], fuelTags: ['oil'] } }), item('item.fallback'),
    item('item.echo-loot', { heirloomEligible: false, rarity: 'common' }), spell, echoLoot, template] };
}

function standing(rank: number, overrides: Partial<FallenHeroStandingSnapshot> = {}): FallenHeroStandingSnapshot {
  const hallRecordId = `hall.hero-${rank}`;
  return { rank, hallRecordId, heroName: `Hero ${rank}`, portraitGlyph: '@', classTags: ['fighter'],
    attributes: { might: 99, agility: 12, vitality: 18, wits: 11, resolve: 13 },
    equippedItemContentIds: ['item.heirloom'], signatureAbilityIds: ['spell.ember'], deathDepth: 4,
    sourceContentHash: 'b'.repeat(64), heirloom: { contentId: 'item.heirloom', sourceItemId: `item.original-${rank}`,
      enchantment: { enchantmentId: 'enchantment.honed', modifiers: { meleeDamageBonus: 2 } }, condition: 73,
      charges: 4, fuel: 9, qualityRank: 2, displayName: `Hero ${rank}'s Blade`, glyph: ')', color: '#ddeeff',
      originatingHallRecordId: hallRecordId }, ...overrides };
}

function initialized(standings: readonly FallenHeroStandingSnapshot[], conquered: readonly string[] = []): ActiveRun {
  const base = createDemoRun();
  const selected = createFallenHeroRunDecisions({ standings, conqueredChampionRecordIds: conquered,
    template, state: base.rng['population-gates'] });
  return { ...base, contentHash: pack().hash, fallenHeroStandings: standings,
    conqueredChampionRecordIds: conquered, fallenHeroDecisions: selected.decisions,
    rng: { ...base.rng, 'population-gates': selected.state } };
}

function withArena(run: ActiveRun, depth = 4, slots = 3): ActiveRun {
  const floor = run.floors[0]!;
  const cells = [{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }].slice(0, slots);
  return { ...run, floors: [{ ...floor, depth,
    vaults: [{ placementId: 'vault.side', vaultId: 'vault.side-arena', x: 4, y: 0, width: 3, height: 5,
      rotation: 0, reflected: false, entrances: [{ x: 4, y: 2 }] }],
    placementSlots: cells.map((cell, index) => ({ slotId: `slot.side-${index}`, vaultPlacementId: 'vault.side',
      kind: 'monster' as const, required: false, tags: ['side-arena', 'fallen-hero'], ...cell })) }] };
}

describe('fallen hero selection', () => {
  it('creates no decisions without host standings and consumes no rolls', () => {
    const state = createDemoRun().rng['population-gates'];
    expect(createFallenHeroRunDecisions({ standings: [], conqueredChampionRecordIds: [], template, state }))
      .toEqual({ decisions: [], state });
  });

  it('suppresses a conquered rank one without promoting lower standings', () => {
    const standings = [standing(1), standing(2)];
    const result = createFallenHeroRunDecisions({ standings, conqueredChampionRecordIds: ['hall.hero-1'], template,
      state: createDemoRun().rng['population-gates'] });
    expect(result.decisions[0]).toMatchObject({ rank: 1, role: 'champion', retained: false });
    expect(result.decisions[1]).toMatchObject({ rank: 2, role: 'echo' });
    expect(result.decisions.filter((decision) => decision.role === 'champion' && decision.retained)).toHaveLength(0);
  });

  it('retains lowest passing independent rolls and resolves ties by rank then record ID', () => {
    const candidates = [standing(4, { hallRecordId: 'hall.z' }), standing(2, { hallRecordId: 'hall.b' }),
      standing(3, { hallRecordId: 'hall.c' }), standing(3, { hallRecordId: 'hall.a' }),
      standing(5, { hallRecordId: 'hall.never' })];
    expect(retainEchoCandidates({ candidates, rolls: [20, 10, 10, 10, 0xffff_ffff], chance: 0.5, maximum: 3 }))
      .toEqual(['hall.b', 'hall.a', 'hall.c']);
  });

  it('persists rolls and decisions byte-identically instead of rerolling on reload', () => {
    const standings = [standing(1), standing(2), standing(3)];
    const run = initialized(standings);
    const loaded = decodeActiveRun(encodeActiveRun(run));
    expect(loaded.fallenHeroDecisions).toEqual(run.fallenHeroDecisions);
    expect(loaded.rng['population-gates']).toEqual(run.rng['population-gates']);
  });
});

describe('normalization and optional placement', () => {
  it('clamps current combat boundaries, filters missing content, and makes Echo limits strictly weaker', () => {
    const historical = standing(1, { equippedItemContentIds: ['item.heirloom', 'item.missing'],
      signatureAbilityIds: ['spell.ember', 'spell.missing'] });
    const champion = normalizeFallenHero({ standing: historical, template, content: pack(), role: 'champion' });
    const echo = normalizeFallenHero({ standing: { ...historical, rank: 2 }, template, content: pack(), role: 'echo' });
    expect(champion).toMatchObject({ displayName: "Hero 1, the Deep's Champion", monsterId: monster.id,
      attributes: { might: 20 }, health: 100, equipmentContentIds: ['item.heirloom'], abilityIds: ['spell.ember'] });
    expect(champion.damageMaximum).toBeLessThanOrEqual(template.damageMaximum);
    expect(echo.displayName).toBe('Echo of Hero 1');
    expect(echo.health).toBeLessThan(champion.health);
    expect(echo.damageMaximum).toBeLessThan(champion.damageMaximum);
    expect(echo.defenseMaximum).toBeLessThan(champion.defenseMaximum);
    expect(echo.abilityIds.length).toBeLessThanOrEqual(template.echoAbilityLimit);
  });

  it('honors recorded death depth and only uses bypassable optional side-arena slots', () => {
    let run = withArena(initialized([standing(1)]), 3);
    expect(placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() }).populations).toHaveLength(0);
    run = withArena(run, 4);
    const result = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(result.populations).toHaveLength(1);
    expect(result.actors[0]!.populationPresentation?.name).toBe("Hero 1, the Deep's Champion");
    expect(result.floor.stairUp).toEqual(run.floors[0]!.stairUp);
    const requiredSlotRun = { ...run, floors: [{ ...run.floors[0]!, placementSlots: run.floors[0]!.placementSlots
      .map((slot) => ({ ...slot, required: true })) }] };
    expect(placeFallenHeroEncounters({ run: requiredSlotRun, floor: requiredSlotRun.floors[0]!, content: pack() }).populations)
      .toHaveLength(0);
  });

  it('places the Champion independently of normal encounter decisions and suppresses repeat placement', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const first = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const published = { ...run, actors: [...run.actors, ...first.actors], populations: first.populations,
      fallenHeroDecisions: first.decisions, floors: [first.floor] };
    const second = placeFallenHeroEncounters({ run: published, floor: published.floors[0]!, content: pack() });
    expect(run.encounterDecisions).toEqual([]);
    expect(first.populations).toHaveLength(1);
    expect(second.populations).toEqual(first.populations);
  });
});

describe('fallen hero rewards and run-local lifecycle', () => {
  it('creates the recorded eligible equipped heirloom exactly once with provenance fields intact', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const state = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }).sort((left, right) => left.actorId.localeCompare(right.actorId)),
      populations: placed.populations, fallenHeroDecisions: placed.decisions,
      floors: [placed.floor] };
    const first = advanceFallenHeroEncounters({ state, content: pack(), eventId: 'event.champion-defeat' });
    const reward = first.state.items.find((entry) => entry.itemId.includes('heirloom'))!;
    expect(reward).toMatchObject({ contentId: 'item.heirloom', quantity: 1, condition: 73,
      enchantment: { enchantmentId: 'enchantment.honed', modifiers: { meleeDamageBonus: 2 } }, charges: 4, fuel: 9 });
    expect(first.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'champion.defeated',
      hallRecordId: 'hall.hero-1', rank: 1 }), expect.objectContaining({ type: 'champion.heirloom-created',
      originatingHallRecordId: 'hall.hero-1', displayName: "Hero 1's Blade" })]));
    const again = advanceFallenHeroEncounters({ state: decodeActiveRun(encodeActiveRun(first.state)), content: pack(),
      eventId: 'event.champion-duplicate' });
    expect(again.state.items).toEqual(first.state.items);
    expect(again.events).toEqual([]);
  });

  it.each([
    ['missing definition', { contentId: 'item.removed' }],
    ['invalid backpack-like record', { sourceItemId: null }],
    ['not recorded as equipped', { contentId: 'item.echo-loot' }],
  ])('uses the fallback relic for %s while retaining Hall provenance', (_label, heirloomOverrides) => {
    const original = standing(1);
    const changed = standing(1, { heirloom: { ...original.heirloom, ...heirloomOverrides } });
    const run = withArena(initialized([changed]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }), populations: placed.populations, fallenHeroDecisions: placed.decisions,
      floors: [placed.floor] };
    const result = advanceFallenHeroEncounters({ state: dead, content: pack(), eventId: 'event.fallback' });
    expect(result.state.items).toEqual([expect.objectContaining({ contentId: 'item.fallback' })]);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'champion.heirloom-created',
      originatingHallRecordId: 'hall.hero-1', fallback: true }));
  });

  it('gives an Echo ordinary table loot, never an heirloom, and suppresses only that run', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = { ...selected, fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) => decision.rank === 2
      ? { ...decision, retained: true, gateRoll: 1 } : { ...decision, retained: false }) };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }), populations: placed.populations, fallenHeroDecisions: placed.decisions,
      floors: [placed.floor] };
    const result = advanceFallenHeroEncounters({ state: dead, content: pack(), eventId: 'event.echo-defeat' });
    expect(result.state.items.map((entry) => entry.contentId)).toEqual(['item.echo-loot']);
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'echo.defeated',
      hallRecordId: 'hall.hero-2', rank: 2 }), expect.objectContaining({ type: 'echo.loot-created' })]));
    const retry = placeFallenHeroEncounters({ run: result.state, floor: result.state.floors[0]!, content: pack() });
    expect(retry.populations).toHaveLength(1);
    const laterRun = initialized(standings);
    expect(laterRun.fallenHeroDecisions.find((decision) => decision.rank === 2)?.defeated).toBe(false);
  });

  it('validates the complete current-content state after materialization', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const state = { ...run, actors: [...run.actors, ...placed.actors], populations: placed.populations,
      fallenHeroDecisions: placed.decisions, floors: [placed.floor] };
    expect(() => validateContentBoundRun(state, pack())).not.toThrow();
  });
});
