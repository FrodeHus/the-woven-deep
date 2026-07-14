import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack, FallenChampionTemplateContentEntry, ItemContentEntry, LootTableContentEntry,
  MonsterContentEntry, SpellContentEntry,
} from '@woven-deep/content';
import {
  advanceFallenHeroEncounters, createDemoContentPack, createDemoRun, createFallenHeroRunDecisions,
  decodeActiveRun, dropItem, encodeActiveRun, normalizeFallenHero, placeFallenHeroEncounters,
  fallenHeroCombatModifiers, mergeStacks, pickupItem, projectGameplayState, retainEchoCandidates, validateContentBoundRun,
  type ActiveRun, type FallenHeroStandingSnapshot,
} from '../src/index.js';

const monster: MonsterContentEntry = {
  kind: 'monster', id: 'monster.champion-fallback', name: 'Ashen Warden', tags: ['boss'], glyph: 'W', color: '#aa7755',
  attributes: { might: 18, agility: 12, vitality: 20, wits: 10, resolve: 16 }, health: 120,
  speed: 100, accuracy: 18, defense: 16, perception: 10, damage: { count: 2, sides: 6, bonus: 2 }, armor: 8,
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
  return { ...base, entries: [...base.entries, monster, item('item.heirloom', { combat: { accuracy: 3, defense: 2,
    armor: 1, damage: { count: 1, sides: 2, bonus: 3 }, range: 1, ammunitionTag: null }, light: { color: [255, 220, 180],
    radius: 3, strength: 100, fuelCapacity: 20, fuelPerTime: 1, warningThresholds: [5], fuelTags: ['oil'] } }), item('item.fallback'),
    item('item.echo-loot', { heirloomEligible: false, rarity: 'common', equipment: null }), spell, echoLoot, template] };
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
    expect(echo.accuracyMaximum).toBeLessThan(champion.accuracyMaximum);
    expect(echo.abilityIds.length).toBeLessThan(champion.abilityIds.length);
    expect(echo.abilityIds.length).toBeLessThanOrEqual(template.echoAbilityLimit);
  });

  it('omits current-valid negative equipment that would erase strict Echo combat boundaries', () => {
    const cursed = item('item.cursed', { combat: { accuracy: -99, defense: -99, armor: 0,
      damage: { count: 1, sides: 1, bonus: -99 }, range: 1, ammunitionTag: null } });
    const current = { ...pack(), entries: [...pack().entries, cursed] };
    const historical = standing(1, { equippedItemContentIds: ['item.cursed', 'item.heirloom'] });
    const champion = normalizeFallenHero({ standing: historical, template, content: current, role: 'champion' });
    const echo = normalizeFallenHero({ standing: { ...historical, rank: 2 }, template, content: current, role: 'echo' });
    expect(champion.equipmentContentIds).toEqual(['item.heirloom']);
    expect(echo.equipmentContentIds).toEqual(['item.heirloom']);
    expect(echo.damageMaximum).toBeLessThan(champion.damageMaximum);
    expect(echo.defenseMaximum).toBeLessThan(champion.defenseMaximum);
    expect(echo.accuracyMaximum).toBeLessThan(champion.accuracyMaximum);
    const echoActor = { ...createDemoRun().actors[0]!, actorId: 'actor.echo', contentId: monster.id,
      playerControlled: false, populationId: 'population.echo', health: echo.health, maxHealth: echo.health };
    expect(fallenHeroCombatModifiers({ state: { actors: [echoActor], fallenHeroStandings: [{ ...historical, rank: 2 }],
      populations: [{ populationId: 'population.echo', encounterId: template.id, floorId: 'floor.demo', model: 'echo',
        createdAt: 0, livingMemberIds: ['actor.echo'], formerMemberIds: [], actorId: 'actor.echo',
        hallRecordId: historical.hallRecordId, rank: 2, defeated: false, lootCreated: false,
        equipmentContentIds: echo.equipmentContentIds, abilityIds: echo.abilityIds }] }, content: current,
      actorId: 'actor.echo' })).toMatchObject({ accuracy: echo.accuracyMaximum - monster.accuracy,
        defense: echo.defenseMaximum - monster.defense });
  });

  it('omits an Echo whose current build has no ability that can be made strictly weaker', () => {
    const standings = [standing(1), standing(2, { signatureAbilityIds: [] })];
    const selected = initialized(standings);
    const forced = { ...selected, fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) => decision.rank === 2
      ? { ...decision, retained: true, gateRoll: 1 } : { ...decision, retained: false }) };
    const run = withArena(forced, 4);
    expect(() => normalizeFallenHero({ standing: standings[1]!, template, content: pack(), role: 'echo' }))
      .toThrow(/ability.*strictly weaker/i);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations).toHaveLength(0);
    expect(placed.decisions.find((decision) => decision.rank === 2)).toMatchObject({ retained: true, encountered: false });
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

  it('applies cumulative route safety when multiple fallen heroes share a depth', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = { ...selected, fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) =>
      ({ ...decision, retained: true, ...(decision.role === 'echo' ? { gateRoll: 1 } : {}) })) };
    const baseFloor = forced.floors[0]!;
    const floor = { ...baseFloor, width: 5, height: 3, depth: 4,
      tiles: [1, 1, 1, 1, 1, 4, 1, 0, 1, 5, 1, 1, 1, 1, 1] as const,
      stairUp: { x: 0, y: 1 }, stairDown: { x: 4, y: 1 }, entities: [],
      vaults: [{ placementId: 'vault.side', vaultId: 'vault.side-arena', x: 0, y: 0, width: 5, height: 3,
        rotation: 0 as const, reflected: false, entrances: [{ x: 0, y: 1 }] }],
      placementSlots: [{ slotId: 'slot.a', vaultPlacementId: 'vault.side', kind: 'monster' as const,
        required: false, tags: ['side-arena'], x: 2, y: 0 },
      { slotId: 'slot.b', vaultPlacementId: 'vault.side', kind: 'monster' as const,
        required: false, tags: ['side-arena'], x: 2, y: 2 }] };
    const result = placeFallenHeroEncounters({ run: { ...forced, floors: [floor] }, floor, content: pack() });
    expect(result.populations).toHaveLength(1);
    expect(result.decisions.filter((decision) => decision.retained && !decision.encountered)).toHaveLength(2);
    const published = { ...forced, actors: [...forced.actors, ...result.actors], populations: result.populations,
      fallenHeroDecisions: result.decisions, floors: [result.floor] };
    expect(placeFallenHeroEncounters({ run: published, floor: result.floor, content: pack() }).populations).toHaveLength(1);
  });

  it('persists normalized loadout choices and uses current-valid equipment in combat and projection', () => {
    const run = withArena(initialized([standing(1, { equippedItemContentIds: ['item.echo-loot', 'item.heirloom', 'item.missing'],
      signatureAbilityIds: ['spell.ember', 'spell.missing'] })]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    expect(placed.populations[0]).toMatchObject({ equipmentContentIds: ['item.heirloom'], abilityIds: ['spell.ember'] });
    const state = { ...run, actors: [...run.actors, ...placed.actors].sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations, fallenHeroDecisions: placed.decisions, floors: [placed.floor] };
    expect(fallenHeroCombatModifiers({ state, content: pack(), actorId: placed.actors[0]!.actorId }))
      .toMatchObject({ accuracy: 2, defense: 2, damage: 3 });
    expect(projectGameplayState({ state, content: pack() }).actors[0]).toMatchObject({
      equipmentContentIds: ['item.heirloom'], abilityIds: ['spell.ember'],
    });
  });

  it('rejects bypassed templates whose Echo combat boundaries cannot be strictly weaker', () => {
    const unsafeTemplate = { ...template, minimumHealth: 1, maximumHealth: 1, attributeMaximum: 1,
      damageMaximum: 1, abilityLimit: 0, echoAbilityLimit: 0 };
    const unsafePack = { ...pack(), entries: pack().entries.map((entry) => entry.kind === 'fallen-champion-template'
      ? unsafeTemplate : entry) };
    const run = initialized([standing(1), standing(2)]);
    expect(() => validateContentBoundRun(run, unsafePack)).toThrow(/strictly weaker|strictly below|Echo.*boundar/i);
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
    expect(reward).toMatchObject({ heirloom: { displayName: "Hero 1's Blade", glyph: ')', color: '#ddeeff',
      originatingHallRecordId: 'hall.hero-1', originatingRank: 1, sourceItemId: 'item.original-1' } });
    const carriedState = { ...first.state, items: first.state.items.map((item) => item.itemId === reward.itemId
      ? { ...item, location: { type: 'backpack' as const, actorId: first.state.hero.actorId } } : item) };
    const dropped = dropItem({ run: carriedState, actorId: first.state.hero.actorId,
      itemId: reward.itemId, quantity: 1 });
    if (!dropped.ok) throw new Error(`test setup failed to drop heirloom: ${dropped.reason}`);
    const loadedState = decodeActiveRun(encodeActiveRun(dropped.run));
    expect(loadedState.items.find((item) => item.itemId === reward.itemId)).toMatchObject({
      contentId: reward.contentId, heirloom: reward.heirloom,
      location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
    });
    const projected = projectGameplayState({ state: loadedState, content: pack() });
    expect(projected.groundItems.find((item) => item.itemId === reward.itemId)).toMatchObject({
      name: "Hero 1's Blade", glyph: ')', color: '#ddeeff',
      provenance: { originatingHallRecordId: 'hall.hero-1' },
    });
    expect(JSON.stringify(projected.groundItems.find((item) => item.itemId === reward.itemId)))
      .not.toMatch(/sourceItemId|qualityRank|sourceContentHash|equippedItemContentIds/);
    expect(() => validateContentBoundRun(loadedState, pack())).not.toThrow();
    const corrupted = { ...loadedState, items: loadedState.items.map((item) => item.itemId === reward.itemId
      ? { ...item, heirloom: { ...item.heirloom!, displayName: 'Tampered history' } } : item) };
    expect(() => validateContentBoundRun(corrupted, pack())).toThrow(/Champion reward/i);
    const ordinary = { ...reward, itemId: 'item.ordinary-copy', heirloom: undefined,
      location: { type: 'backpack' as const, actorId: first.state.hero.actorId } };
    const pickupRun = { ...first.state, items: [...first.state.items.map((item) => item.itemId === reward.itemId
      ? { ...item, location: { type: 'floor' as const, floorId: 'floor.demo', x: 1, y: 1 } } : item), ordinary] };
    const picked = pickupItem({ run: pickupRun, content: pack(), actorId: first.state.hero.actorId,
      itemId: reward.itemId, quantity: 1 });
    expect(picked.ok).toBe(true);
    if (!picked.ok) throw new Error(picked.reason);
    expect(picked.items.filter((item) => item.contentId === reward.contentId)).toHaveLength(2);
    expect(mergeStacks({ run: picked.run, content: pack(), actorId: first.state.hero.actorId,
      leftItemId: reward.itemId, rightItemId: ordinary.itemId })).toEqual({ ok: false, reason: 'item.incompatible' });
    const forged = { ...loadedState, items: [...loadedState.items,
      { ...ordinary, itemId: 'item.forged', heirloom: reward.heirloom }].sort((a, b) => a.itemId.localeCompare(b.itemId)) };
    expect(() => validateContentBoundRun(forged, pack())).toThrow(/provenance|heirloom/i);
    expect(() => encodeActiveRun(forged)).toThrow(/provenance|heirloom/i);
    for (const heirloom of [
      { ...reward.heirloom!, originatingHallRecordId: 'hall.wrong' },
      { ...reward.heirloom!, originatingRank: 2 },
      { ...reward.heirloom!, sourceItemId: 'item.wrong' },
    ]) {
      const tampered = { ...loadedState, items: loadedState.items.map((item) => item.itemId === reward.itemId
        ? { ...item, heirloom } : item) };
      expect(() => validateContentBoundRun(tampered, pack())).toThrow(/Champion reward|provenance|heirloom/i);
      expect(() => encodeActiveRun(tampered)).toThrow(/provenance|heirloom/i);
    }
    const again = advanceFallenHeroEncounters({ state: loadedState, content: pack(),
      eventId: 'event.champion-duplicate' });
    expect(again.state.items).toEqual(loadedState.items);
    expect(again.events).toEqual([]);
  });

  it('keeps derived Unicode Champion, Echo, and fallback heirloom display strings save-schema safe', () => {
    const longName = '🛡'.repeat(40);
    const longFallback = item('item.fallback', { name: 'Relic '.repeat(12) });
    const current = { ...pack(), entries: pack().entries.map((entry) => entry.id === 'item.fallback' ? longFallback : entry) };
    const historical = standing(1, { heroName: longName });
    const champion = normalizeFallenHero({ standing: historical, template, content: current, role: 'champion' });
    const echo = normalizeFallenHero({ standing: { ...historical, rank: 2 }, template, content: current, role: 'echo' });
    expect([...champion.displayName]).toHaveLength(40);
    expect(champion.displayName).toMatch(/, the Deep's Champion$/);
    expect([...echo.displayName]).toHaveLength(40);
    expect(echo.displayName).toMatch(/^Echo of /);
    const changed = standing(1, { heroName: longName, heirloom: { ...historical.heirloom, contentId: 'item.removed' } });
    const base = initialized([changed]);
    const run = withArena({ ...base, contentHash: current.hash }, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: current });
    const dead = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }).sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations, fallenHeroDecisions: placed.decisions,
      floors: [placed.floor] };
    const result = advanceFallenHeroEncounters({ state: dead, content: current, eventId: 'event.long-name' });
    const reward = result.state.items.find((entry) => entry.heirloom)!;
    expect([...reward.heirloom!.displayName]).toHaveLength(40);
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });

  it('normalizes NFC, removes controls and formats, and supplies a non-empty derived display label', () => {
    const unsafeName = `Cafe\u0000\u200b\u0301`;
    const champion = normalizeFallenHero({ standing: standing(1, { heroName: unsafeName }),
      template, content: pack(), role: 'champion' });
    const echo = normalizeFallenHero({ standing: standing(2, { heroName: unsafeName }),
      template, content: pack(), role: 'echo' });
    expect(champion.displayName).toBe("Café, the Deep's Champion");
    expect(echo.displayName).toBe('Echo of Café');
    expect(champion.displayName.normalize('NFC')).toBe(champion.displayName);
    expect(champion.displayName).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(normalizeFallenHero({ standing: standing(1, { heroName: '\u0000\u200b' }),
      template, content: pack(), role: 'champion' }).displayName).toBe("Unknown, the Deep's Champion");
  });

  it('sanitizes a bypassed fallback item name before reward metadata, event emission, and save round-trip', () => {
    const unsafeFallback = item('item.fallback', { name: `${'e\u0301'.repeat(50)}\u0000\u200b` });
    const current = { ...pack(), entries: pack().entries.map((entry) => entry.id === 'item.fallback'
      ? unsafeFallback : entry) };
    const original = standing(1);
    const changed = standing(1, { heirloom: { ...original.heirloom, contentId: 'item.removed' } });
    const base = initialized([changed]);
    const run = withArena({ ...base, contentHash: current.hash }, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: current });
    const dead = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }).sort((a, b) => a.actorId.localeCompare(b.actorId)),
      populations: placed.populations, fallenHeroDecisions: placed.decisions, floors: [placed.floor] };
    const result = advanceFallenHeroEncounters({ state: dead, content: current, eventId: 'event.sanitized-fallback' });
    const expected = 'é'.repeat(40);
    expect(result.state.items.find((entry) => entry.heirloom)?.heirloom?.displayName).toBe(expected);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'champion.heirloom-created', displayName: expected }));
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
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

  it('preflights the complete Echo loot graph before consuming RNG or creating a forbidden reward', () => {
    const standings = [standing(1), standing(2)];
    const selected = initialized(standings);
    const forced = { ...selected, fallenHeroDecisions: selected.fallenHeroDecisions.map((decision) => decision.rank === 2
      ? { ...decision, retained: true, gateRoll: 1 } : { ...decision, retained: false }) };
    const run = withArena(forced, 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const dead = { ...run, actors: [...run.actors, ...placed.actors].map((actor) => actor.populationId === null
      ? actor : { ...actor, health: 0 }), populations: placed.populations, fallenHeroDecisions: placed.decisions,
      floors: [placed.floor] };
    const unsafe = pack();
    const entries = unsafe.entries.map((entry) => entry.id === echoLoot.id && entry.kind === 'loot-table'
      ? { ...entry, choices: [{ contentId: 'item.heirloom', lootTableId: null, weight: 1,
        minimumQuantity: 1, maximumQuantity: 1 }] } : entry);
    const before = structuredClone(dead);
    expect(() => advanceFallenHeroEncounters({ state: dead, content: { ...unsafe, entries }, eventId: 'event.unsafe-echo' }))
      .toThrow(/Echo loot.*heirloom|ordinary/i);
    expect(dead).toEqual(before);
  });

  it('validates the complete current-content state after materialization', () => {
    const run = withArena(initialized([standing(1)]), 4);
    const placed = placeFallenHeroEncounters({ run, floor: run.floors[0]!, content: pack() });
    const state = { ...run, actors: [...run.actors, ...placed.actors], populations: placed.populations,
      fallenHeroDecisions: placed.decisions, floors: [placed.floor] };
    expect(() => validateContentBoundRun(state, pack())).not.toThrow();
  });
});
