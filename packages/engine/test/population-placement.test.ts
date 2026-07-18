import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  ContentEntry,
  EncounterContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
  MerchantEncounterContentEntry,
  MonsterContentEntry,
  NpcContentEntry,
  VaultContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  createUnknownKnowledge,
  placeFloorPopulations,
  placePopulation,
  rollDie,
  stableJson,
  type ActiveRun,
  type FloorSnapshot,
} from '../src/index.js';

function monster(id: string): MonsterContentEntry {
  return {
    kind: 'monster', id, name: id, tags: ['test'], glyph: 'm', color: '#808080',
    attributes: { might: 3, agility: 4, vitality: 5, wits: 2, resolve: 1 },
    health: 7, speed: 90, accuracy: 1, defense: 2, perception: 4,
    damage: { count: 1, sides: 4, bonus: 0 }, armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile', behaviorId: 'behavior.approach-and-attack', behaviorParameters: {},
    minDepth: 1, maxDepth: 20, rarity: 'common',
  };
}

const placement = {
  minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 3,
  allowedTerrainTags: ['floor'], requiresVaultSlot: false, failureMode: 'optional' as const,
};

function individual(id: string, overrides: Partial<EncounterContentEntry> = {}): EncounterContentEntry {
  return {
    kind: 'encounter', id, name: id, tags: ['test'], model: 'individual', adminDescription: null,
    minDepth: 1, maxDepth: 10, environmentTags: [], requiredVaultTags: [], weight: 1,
    rarity: 'common', runAppearanceChance: 1, discoveryProtectionIncrement: 0,
    discoveryProtectionCap: 1, maximumInstancesPerRun: 2, placement,
    intentPresentation: { visible: true },
    definition: { monsterId: 'monster.test-a', minimumQuantity: 1, maximumQuantity: 1 },
    ...overrides,
  } as EncounterContentEntry;
}

function swarm(id: string): EncounterContentEntry {
  return individual(id, { model: 'swarm', definition: { sourceMonsterId: 'monster.test-a',
    spawnRoles: [{ roleId: 'child', monsterId: 'monster.test-b', weight: 1 }], spawnInterval: 10,
    minimumSpawnQuantity: 1, maximumSpawnQuantity: 1, placementRadius: 2, allowedTerrainTags: ['floor'],
    maximumLivingChildren: 2, maximumLivingMembers: 3, maximumFloorActors: 4,
    sourceDestructionResponse: 'stop', responseParameters: {} } });
}

function pack(encounters: readonly EncounterContentEntry[], extras: readonly ContentEntry[] = []): CompiledContentPack {
  const base = createDemoContentPack();
  return {
    ...base,
    entries: [...base.entries, monster('monster.test-a'), monster('monster.test-b'), ...extras, ...encounters],
  };
}

function floor(overrides: Partial<FloorSnapshot> = {}): FloorSnapshot {
  const width = 9; const height = 7;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width; const y = Math.floor(index / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return 0 as const;
    return 1 as const;
  });
  tiles[1 * width + 1] = 4;
  tiles[5 * width + 7] = 5;
  return {
    floorId: 'floor.population', seed: [11, 12, 13, 14], generatorVersion: 2,
    width, height, depth: 3, tiles, entities: [], themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 }, knowledge: createUnknownKnowledge(tiles.length),
    lights: [], stairUp: { x: 1, y: 1 }, stairDown: { x: 7, y: 5 }, vaults: [], placementSlots: [],
    ...overrides,
  };
}

function runFor(encounters: readonly EncounterContentEntry[]): ActiveRun {
  const base = createDemoRun();
  return {
    ...base,
    rng: { ...base.rng, encounters: [1, 2, 3, 4] },
    encounterDecisions: encounters.map((entry) => ({
      encounterId: entry.id, baseProbability: entry.runAppearanceChance, protectionBonus: 0,
      effectiveProbability: entry.runAppearanceChance, eligible: true,
      reachedEligibleDepth: false, encountered: false, instancesCreated: 0,
    })).sort((left, right) => left.encounterId < right.encounterId ? -1 : 1),
  };
}

function merchantFixture(overrides: Partial<MerchantEncounterContentEntry> = {}): Readonly<{
  npc: NpcContentEntry; stockItem: ItemContentEntry; stock: LootTableContentEntry;
  encounter: MerchantEncounterContentEntry;
}> {
  const npc: NpcContentEntry = {
    kind: 'npc', id: 'npc.test-merchant', name: 'Test Merchant', tags: ['merchant'], glyph: '$', color: '#ffaa00',
    factionId: 'npc-faction.test', attributes: { might: 1, agility: 2, vitality: 3, wits: 4, resolve: 5 },
    health: 9, speed: 80, perception: 6, accuracy: 2, defense: 3, damage: { count: 1, sides: 2, bonus: 0 },
    armor: 0, resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'neutral', behaviorId: 'npc-behavior.travelling-merchant', behaviorParameters: {},
    selfPreservationThresholdBps: 3000,
  };
  const stockItem: ItemContentEntry = {
    kind: 'item', id: 'item.test-stock', name: 'Test Stock', tags: [], glyph: '!', color: '#ffffff',
    category: 'potion', stackLimit: 9, price: 1, rarity: 'common', heirloomEligible: false,
    minDepth: 1, maxDepth: 10, actionCost: 100, equipment: null, combat: null, light: null,
    identification: { mode: 'known', poolId: null }, effects: [],
  };
  const stock: LootTableContentEntry = {
    kind: 'loot-table', id: 'loot-table.test-stock', name: 'Test Stock', tags: [], rolls: 1,
    choices: [{ contentId: stockItem.id, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }],
  };
  const encounter = {
    ...individual('encounter.test-merchant', {
      model: 'merchant', maximumInstancesPerRun: 1,
      definition: {
        npcId: npc.id, stockLootTableId: stock.id, minimumStockRolls: 1, maximumStockRolls: 1,
        merchantSaleBps: 12000, merchantPurchaseBps: 6000, acceptedCategories: [stockItem.category], services: [],
        minimumLifetime: 10, maximumLifetime: 10, departureWarningThresholds: [5], aggressionResponse: 'flee',
        commerceReputationDelta: 1, aggressionReputationDelta: -1, deathReputationDelta: -1, stockDropFraction: 0.5,
      },
    }) as MerchantEncounterContentEntry,
    ...overrides,
  };
  return { npc, stockItem, stock, encounter };
}

describe('population placement selection and composition', () => {
  it('composes a merchant as one neutral NPC with finite stock while preserving encounter stream behavior', () => {
    const { npc, stockItem, stock, encounter } = merchantFixture();
    const run = runFor([encounter]);

    const result = placePopulation({ run, floor: floor(), content: pack([encounter], [npc, stockItem, stock]),
      forcedEncounterId: encounter.id });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed' || result.population.model !== 'merchant') return;
    expect(result.createdActors).toHaveLength(1);
    expect(result.createdActors[0]).toMatchObject({ contentId: npc.id, disposition: 'neutral',
      behaviorId: npc.behaviorId, populationId: result.population.populationId });
    expect(result.createdItems.length).toBeGreaterThan(0);
    expect(result.nextEncounterState).toEqual(run.rng.encounters);
    expect(result.nextMerchantStockState).not.toEqual(run.rng['merchant-stock']);
  });
  it('gates merchants by depth, instance cap, and stair distance without touching the merchant stream', () => {
    const shallow = merchantFixture({ minDepth: 5, maxDepth: 10 });
    const shallowResult = placePopulation({ run: runFor([shallow.encounter]), floor: floor(),
      content: pack([shallow.encounter], [shallow.npc, shallow.stockItem, shallow.stock]),
      forcedEncounterId: shallow.encounter.id });
    expect(shallowResult).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });

    const capped = merchantFixture();
    const cappedRun = runFor([capped.encounter]);
    const cappedResult = placePopulation({
      run: { ...cappedRun, encounterDecisions: cappedRun.encounterDecisions.map((decision) =>
        ({ ...decision, instancesCreated: capped.encounter.maximumInstancesPerRun })) },
      floor: floor(), content: pack([capped.encounter], [capped.npc, capped.stockItem, capped.stock]),
      forcedEncounterId: capped.encounter.id,
    });
    expect(cappedResult).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });

    const distant = merchantFixture({ placement: { ...placement, minimumStairDistance: 10_000 } });
    const distantRun = runFor([distant.encounter]);
    const distantResult = placePopulation({ run: distantRun, floor: floor(),
      content: pack([distant.encounter], [distant.npc, distant.stockItem, distant.stock]),
      forcedEncounterId: distant.encounter.id });
    expect(distantResult).toMatchObject({ status: 'skipped', reason: 'no-valid-placement' });
    expect('createdItems' in distantResult).toBe(false);
    expect(distantRun.rng['merchant-stock']).toEqual(createDemoRun().rng['merchant-stock']);
  });
  it('gates merchants by authored environment tags through the shared candidate filter', () => {
    const { npc, stockItem, stock, encounter } = merchantFixture({ environmentTags: ['cavern'] });
    const run = runFor([encounter]);
    const content = pack([encounter], [npc, stockItem, stock]);

    const absent = placePopulation({ run, floor: floor(), content, forcedEncounterId: encounter.id });
    const present = placePopulation({
      run, floor: floor(), content, environmentTags: ['cavern'], forcedEncounterId: encounter.id,
    });

    expect(absent).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });
    expect(present.status).toBe('placed');
    expect(run.rng['merchant-stock']).toEqual(createDemoRun().rng['merchant-stock']);
  });

  it('anchors a merchant to a matching mandatory vault slot without overwriting an occupied slot', () => {
    const { npc, stockItem, stock, encounter } = merchantFixture({
      requiredVaultTags: ['arena'],
      placement: { ...placement, requiresVaultSlot: true },
    });
    const generated = floor({
      entities: [{ entityId: 'fixture.occupied-slot', x: 3, y: 2 }],
      vaults: [{
        placementId: 'vault-placement.arena', vaultId: 'vault.arena', x: 2, y: 1,
        width: 5, height: 3, rotation: 0, reflected: false, entrances: [{ x: 2, y: 2 }],
      }],
      placementSlots: [
        { slotId: 'slot.arena-a', vaultPlacementId: 'vault-placement.arena', kind: 'monster',
          required: false, tags: ['arena'], x: 3, y: 2 },
        { slotId: 'slot.arena-b', vaultPlacementId: 'vault-placement.arena', kind: 'monster',
          required: false, tags: ['arena'], x: 5, y: 2 },
      ],
    });
    const slotless = placePopulation({
      run: runFor([encounter]), floor: floor(), content: pack([encounter], [npc, stockItem, stock]),
      forcedEncounterId: encounter.id,
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter], [npc, stockItem, stock]),
      forcedEncounterId: encounter.id,
    });

    expect(slotless).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });
    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.population.model).toBe('merchant');
    expect(result.createdActors.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 5, y: 2 }]);
  });

  it('skips a merchant that cannot honor the objective distance without touching the merchant stream', () => {
    const { npc, stockItem, stock, encounter } = merchantFixture({
      placement: { ...placement, minimumObjectiveDistance: 10_000 },
    });
    const generated = floor({
      vaults: [{
        placementId: 'vault-placement.goal', vaultId: 'vault.goal', x: 5, y: 1,
        width: 1, height: 1, rotation: 0, reflected: false, entrances: [{ x: 5, y: 1 }],
      }],
      placementSlots: [{ slotId: 'slot.objective', vaultPlacementId: 'vault-placement.goal',
        kind: 'objective', required: true, tags: ['goal'], x: 5, y: 1 }],
    });
    const run = runFor([encounter]);

    const result = placePopulation({ run, floor: generated,
      content: pack([encounter], [npc, stockItem, stock]), forcedEncounterId: encounter.id });

    expect(result).toMatchObject({ status: 'skipped', encounterId: encounter.id, reason: 'no-valid-placement' });
    expect(result).not.toHaveProperty('createdItems');
    expect(run.rng['merchant-stock']).toEqual(createDemoRun().rng['merchant-stock']);
  });

  it('does not place a merchant where it would sever the required stair route', () => {
    const { npc, stockItem, stock, encounter } = merchantFixture();
    const width = 7; const height = 3;
    const tiles = [
      0, 0, 0, 0, 0, 0, 0,
      0, 4, 1, 1, 1, 5, 0,
      0, 0, 0, 0, 0, 0, 0,
    ] as const;
    const generated = floor({
      width, height, tiles, stairUp: { x: 1, y: 1 }, stairDown: { x: 5, y: 1 },
      knowledge: createUnknownKnowledge(width * height),
    });
    const run = runFor([encounter]);

    const result = placePopulation({ run, floor: generated,
      content: pack([encounter], [npc, stockItem, stock]), forcedEncounterId: encounter.id });

    expect(result).toMatchObject({ status: 'skipped', encounterId: encounter.id, reason: 'required-route-blocked' });
    expect(result).not.toHaveProperty('createdActors');
    expect(result).not.toHaveProperty('createdItems');
    expect(run.rng['merchant-stock']).toEqual(createDemoRun().rng['merchant-stock']);
  });

  it('rejects bypassed unsafe weights and quantities before consuming RNG or allocating members', () => {
    const oversized = individual('encounter.oversized', { definition: {
      monsterId: 'monster.test-a', minimumQuantity: 1, maximumQuantity: 1025,
    } });
    const oversizedRun = runFor([oversized]);
    const before = stableJson(oversizedRun);
    expect(() => placePopulation({ run: oversizedRun, floor: floor(), content: pack([oversized]),
      forcedEncounterId: oversized.id })).toThrow(/population preflight.*quantity.*1024/i);
    expect(stableJson(oversizedRun)).toBe(before);

    const weighted = [
      individual('encounter.weight-a', { weight: 0x8000_0000 }),
      individual('encounter.weight-b', { weight: 0x8000_0001 }),
    ];
    const weightedRun = runFor(weighted);
    const weightedBefore = stableJson(weightedRun);
    expect(() => placePopulation({ run: weightedRun, floor: floor(), content: pack(weighted) }))
      .toThrow(/population preflight.*weight.*2\^32/i);
    expect(stableJson(weightedRun)).toBe(weightedBefore);
  });

  it('rejects a swarm placement whose initial saved timer would overflow', () => {
    const entry = swarm('encounter.timer-overflow');
    const result = placePopulation({ run: { ...runFor([entry]), worldTime: Number.MAX_SAFE_INTEGER - 5 },
      floor: floor(), content: pack([entry]), forcedEncounterId: entry.id });
    expect(result).toMatchObject({ status: 'skipped', reason: 'no-valid-placement' });
  });
  it('filters by depth, environment, vault tags, eligibility, and the per-run limit', () => {
    const entries = [
      individual('encounter.depth', { minDepth: 4 }),
      individual('encounter.environment', { environmentTags: ['forest'] }),
      individual('encounter.vault', { requiredVaultTags: ['arena'] }),
      individual('encounter.limit', { maximumInstancesPerRun: 1 }),
      individual('encounter.ineligible'),
    ];
    const run = runFor(entries);
    const decisions = run.encounterDecisions.map((decision) => decision.encounterId === 'encounter.limit'
      ? { ...decision, instancesCreated: 1 }
      : decision.encounterId === 'encounter.ineligible' ? { ...decision, eligible: false } : decision);

    const result = placePopulation({ run: { ...run, encounterDecisions: decisions }, floor: floor(), content: pack(entries) });

    expect(result).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });
  });

  it('matches authored environment tags supplied by floor generation', () => {
    const encounter = individual('encounter.environment-match', { environmentTags: ['cavern'] });
    const run = runFor([encounter]);

    const absent = placePopulation({ run, floor: floor(), content: pack([encounter]) });
    const present = placePopulation({
      run, floor: floor(), content: pack([encounter]), environmentTags: ['cavern'],
      forcedEncounterId: encounter.id,
    });

    expect(absent.status).toBe('skipped');
    expect(present.status).toBe('placed');
  });

  it('does not mark an encounter reached outside its inclusive depth range', () => {
    const encounter = individual('encounter.expired', { minDepth: 2, maxDepth: 4 });
    const run = runFor([encounter]);

    const result = placePopulation({ run, floor: floor({ depth: 5 }), content: pack([encounter]) });

    expect(result.status).toBe('skipped');
    expect(result.encounterDecisions[0]!.reachedEligibleDepth).toBe(false);
  });

  it('uses code-unit encounter ordering before stable weighted selection', () => {
    const a = individual('encounter.a', { weight: 1 });
    const b = individual('encounter.b', { weight: 3, definition: {
      monsterId: 'monster.test-b', minimumQuantity: 1, maximumQuantity: 1,
    } });
    const run = runFor([b, a]);
    const selection = rollDie(run.rng.encounters, 4);
    const expected = selection.value <= 1 ? a.id : b.id;

    const first = placePopulation({ run, floor: floor(), content: pack([b, a]) });
    const second = placePopulation({ run, floor: floor(), content: pack([a, b]) });

    expect(first.status).toBe('placed');
    expect(first.encounterId).toBe(expected);
    expect(stableJson(first)).toBe(stableJson(second));
  });

  it('rolls inclusive role quantities and optional leadership in authored role order', () => {
    const encounter: EncounterContentEntry = {
      ...individual('encounter.group'), model: 'group',
      definition: {
        roles: [
          { roleId: 'front', monsterId: 'monster.test-a', minimumQuantity: 2, maximumQuantity: 3,
            formationPreference: 'front', behaviorParameters: {} },
          { roleId: 'rear', monsterId: 'monster.test-b', minimumQuantity: 1, maximumQuantity: 2,
            formationPreference: 'rear', behaviorParameters: {} },
        ],
        formation: 'line', communicationRadius: 4, leaderChance: 1, leaderRoleId: 'front',
        leaderAccentColor: '#ffcc00', leaderAlternateGlyph: 'L',
        coordinationModifiers: { accuracy: 1, defense: 1, damage: 0 },
        leaderDeathResponse: 'weaken', responseParameters: {}, supernaturalBond: false,
        collapseRewards: 'none',
      },
    };
    const run = runFor([encounter]);
    const frontRoll = rollDie(run.rng.encounters, 2);
    const rearRoll = rollDie(frontRoll.state, 2);
    const expectedRoles = [
      ...Array.from({ length: frontRoll.value + 1 }, () => 'front'),
      ...Array.from({ length: rearRoll.value }, () => 'rear'),
    ];

    const result = placePopulation({ run, floor: floor(), content: pack([encounter]), forcedEncounterId: encounter.id });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed' || result.population.model !== 'group') return;
    expect(result.createdActors.map((actor) => actor.populationRoleId)).toEqual(expectedRoles);
    expect(result.population.populationId).toBe('population.000001');
    expect(result.createdActors.map((actor) => actor.actorId)).toEqual(
      expectedRoles.map((_, index) => `actor.population.000001.${String(index + 1).padStart(3, '0')}`),
    );
    expect(result.population.leaderActorId).toBe(result.createdActors[0]!.actorId);
    expect(result.createdActors[0]!.populationPresentation).toEqual({
      name: 'monster.test-a', glyph: 'L', color: '#ffcc00', leader: true,
    });
  });

  it('places up to and including a raised per-run cap (matching the raised early-game encounter caps)', () => {
    const encounter = individual('encounter.raised-cap', { maximumInstancesPerRun: 24 });
    const belowCapRun = runFor([encounter]);
    const belowCapResult = placePopulation({
      run: { ...belowCapRun, encounterDecisions: belowCapRun.encounterDecisions.map((decision) =>
        ({ ...decision, instancesCreated: 23 })) },
      floor: floor(), content: pack([encounter]), forcedEncounterId: encounter.id,
    });
    expect(belowCapResult.status).toBe('placed');
    if (belowCapResult.status === 'placed') {
      expect(belowCapResult.encounterDecisions.find((decision) => decision.encounterId === encounter.id)
        ?.instancesCreated).toBe(24);
    }

    const atCapRun = runFor([encounter]);
    const atCapResult = placePopulation({
      run: { ...atCapRun, encounterDecisions: atCapRun.encounterDecisions.map((decision) =>
        ({ ...decision, instancesCreated: 24 })) },
      floor: floor(), content: pack([encounter]), forcedEncounterId: encounter.id,
    });
    expect(atCapResult).toMatchObject({ status: 'skipped', reason: 'no-eligible-encounter' });
  });

  it('advances fixed population allocation past existing actor identifiers', () => {
    const encounter = individual('encounter.id-collision');
    const base = runFor([encounter]);
    const collidingActor = {
      ...base.actors[0]!, actorId: 'actor.population.000001.001', playerControlled: false,
      contentId: 'monster.test-a', behaviorId: 'behavior.approach-and-attack',
    };
    const run = {
      ...base,
      actors: [...base.actors, collidingActor].sort((left, right) => left.actorId < right.actorId ? -1 : 1),
    };

    const result = placePopulation({
      run, floor: floor(), content: pack([encounter]), forcedEncounterId: encounter.id,
    });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.population.populationId).toBe('population.000002');
    expect(result.createdActors[0]!.actorId).toBe('actor.population.000002.001');
  });
});

describe('atomic population placement', () => {
  it('finds a complete distance-bounded set when an earlier compatible point is a dead end', () => {
    const encounter = individual('encounter.distance-window', {
      placement: { ...placement, maximumMemberDistance: 2 },
      definition: { monsterId: 'monster.test-a', minimumQuantity: 4, maximumQuantity: 4 },
    });
    const width = 6; const height = 3;
    const candidateIndexes = new Set([[0, 0], [3, 0], [4, 0], [1, 1], [3, 1], [1, 2]]
      .map(([x, y]) => y! * width + x!));
    const generated = floor({
      width, height, tiles: Array.from({ length: width * height }, (_, index) =>
        candidateIndexes.has(index) ? 1 as const : 0 as const),
      stairUp: null, stairDown: null, knowledge: createUnknownKnowledge(width * height),
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id,
    });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.createdActors.map(({ x, y }) => [x, y])).toEqual([[3, 0], [1, 1], [3, 1], [1, 2]]);
  });

  it('inherits mandatory anchor tags from the parent vault', () => {
    const encounter = individual('encounter.parent-vault-anchor', {
      requiredVaultTags: ['parent-arena'],
      placement: { ...placement, requiresVaultSlot: true },
    });
    const vault: VaultContentEntry = {
      kind: 'vault', id: 'vault.parent-arena', name: 'Parent arena', tags: ['parent-arena'],
      minDepth: 1, maxDepth: 10, rarity: 'common', weight: 1, maxPerFloor: 1, margin: 0,
      transforms: { rotations: [0], reflectHorizontal: false }, layout: ['.'],
      legend: { '.': { terrain: 'floor', entrance: false, light: null, slot: null } },
      entranceCount: 0, requiredSlotIds: [],
    };
    const generated = floor({
      vaults: [{
        placementId: 'vault-placement.parent', vaultId: vault.id, x: 3, y: 2,
        width: 1, height: 1, rotation: 0, reflected: false, entrances: [],
      }],
      placementSlots: [{
        slotId: 'slot.parent-monster', vaultPlacementId: 'vault-placement.parent', kind: 'monster',
        required: false, tags: [], x: 3, y: 2,
      }],
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter], [vault]),
      forcedEncounterId: encounter.id,
    });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.createdActors.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 3, y: 2 }]);
  });

  it('uses a matching mandatory vault slot without overwriting an occupied slot', () => {
    const encounter = individual('encounter.vault-anchor', {
      requiredVaultTags: ['arena'],
      placement: { ...placement, requiresVaultSlot: true },
    });
    const generated = floor({
      entities: [{ entityId: 'fixture.occupied-slot', x: 3, y: 2 }],
      vaults: [{
        placementId: 'vault-placement.arena', vaultId: 'vault.arena', x: 2, y: 1,
        width: 5, height: 3, rotation: 0, reflected: false, entrances: [{ x: 2, y: 2 }],
      }],
      placementSlots: [
        { slotId: 'slot.arena-a', vaultPlacementId: 'vault-placement.arena', kind: 'monster',
          required: false, tags: ['arena'], x: 3, y: 2 },
        { slotId: 'slot.arena-b', vaultPlacementId: 'vault-placement.arena', kind: 'monster',
          required: false, tags: ['arena'], x: 5, y: 2 },
      ],
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id,
    });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.createdActors.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 5, y: 2 }]);
  });

  it('enumerates row-major cells while excluding actors, features, stairs, objectives, and vault slots', () => {
    const encounter = individual('encounter.reservations');
    const baseRun = runFor([encounter]);
    const generated = floor({
      entities: [{ entityId: 'fixture.blocker', x: 2, y: 1 }],
      vaults: [{
        placementId: 'vault-placement.test', vaultId: 'vault.test', x: 5, y: 1,
        width: 2, height: 1, rotation: 0, reflected: false, entrances: [{ x: 5, y: 1 }],
      }],
      placementSlots: [
        { slotId: 'slot.objective', vaultPlacementId: 'vault-placement.test', kind: 'objective',
          required: true, tags: ['goal'], x: 5, y: 1 },
        { slotId: 'slot.monster', vaultPlacementId: 'vault-placement.test', kind: 'monster',
          required: false, tags: ['arena'], x: 6, y: 1 },
      ],
    });
    const occupyingActor = { ...baseRun.actors[0]!, actorId: 'monster.existing', contentId: 'monster.test-a',
      playerControlled: false, floorId: generated.floorId, x: 3, y: 1 };
    const run = {
      ...baseRun,
      actors: [...baseRun.actors, occupyingActor].sort((left, right) => left.actorId < right.actorId ? -1 : 1),
      features: [...baseRun.features, {
        featureId: 'feature.blocker', type: 'trap' as const, floorId: generated.floorId,
        x: 4, y: 1, contentId: null, coverTileId: 1 as const, state: 'armed' as const,
        discoveryDifficulty: 1,
        discovery: { discoveredByActorIds: [], progressByActorId: {}, attemptedContextKeys: [] },
      }],
    };

    const result = placePopulation({ run, floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id });

    expect(result.status).toBe('placed');
    if (result.status !== 'placed') return;
    expect(result.createdActors.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 1, y: 2 }]);
    expect(result.floor.entities.find((entity) => entity.entityId === result.createdActors[0]!.actorId))
      .toBeUndefined();
  });

  it('skips the complete optional encounter when member separation or terrain prevents composition', () => {
    const encounter = individual('encounter.too-wide', {
      placement: { ...placement, maximumMemberDistance: 1, allowedTerrainTags: ['floor'] },
      definition: { monsterId: 'monster.test-a', minimumQuantity: 2, maximumQuantity: 2 },
    });
    const generated = floor({
      stairUp: null,
      stairDown: null,
      tiles: floor().tiles.map((tile, index) => {
        const x = index % floor().width; const y = Math.floor(index / floor().width);
        if ((x === 2 && y === 1) || (x === 6 && y === 5)) return 1 as const;
        if (tile === 4 || tile === 5) return tile;
        return 0 as const;
      }),
    });
    const run = runFor([encounter]);
    const before = [stableJson(run), stableJson(generated)];

    const result = placePopulation({ run, floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id });

    expect(result).toMatchObject({ status: 'skipped', encounterId: encounter.id, reason: 'no-valid-placement' });
    expect(result).not.toHaveProperty('createdActors');
    expect([stableJson(run), stableJson(generated)]).toEqual(before);
  });

  it('does not place an optional actor where it would sever the required stair route', () => {
    const encounter = individual('encounter.route-optional');
    const width = 7; const height = 3;
    const tiles = [
      0, 0, 0, 0, 0, 0, 0,
      0, 4, 1, 1, 1, 5, 0,
      0, 0, 0, 0, 0, 0, 0,
    ] as const;
    const generated = floor({
      width, height, tiles, stairUp: { x: 1, y: 1 }, stairDown: { x: 5, y: 1 },
      knowledge: createUnknownKnowledge(width * height),
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id,
    });

    expect(result).toMatchObject({ status: 'skipped', reason: 'required-route-blocked' });
    expect(result).not.toHaveProperty('createdActors');
  });

  it('rejects the bounded generation attempt atomically for required placement failure', () => {
    const encounter = individual('encounter.route-required', {
      placement: { ...placement, failureMode: 'required' },
    });
    const width = 7; const height = 3;
    const generated = floor({
      width, height,
      tiles: [0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 1, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0],
      stairUp: { x: 1, y: 1 }, stairDown: { x: 5, y: 1 },
      knowledge: createUnknownKnowledge(width * height),
    });

    const result = placePopulation({
      run: runFor([encounter]), floor: generated, content: pack([encounter]), forcedEncounterId: encounter.id,
    });

    expect(result).toMatchObject({ status: 'rejected', encounterId: encounter.id, reason: 'required-route-blocked' });
    expect(result).not.toHaveProperty('createdActors');
  });
});

// `placeFloorPopulations` fills a floor up to its density budget: attempts =
// clamp(floor((width * height) / cellsPerEncounter), 1, 8). `createDemoContentPack`'s balance
// (via `pack`) carries the bundled `cellsPerEncounter: 2000`.
function openFloor(width: number, height: number, floorId = `floor.density-${width}x${height}`): FloorSnapshot {
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width; const y = Math.floor(index / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return 0 as const;
    return 1 as const;
  });
  tiles[1 * width + 1] = 4;
  tiles[(height - 2) * width + (width - 2)] = 5;
  return floor({
    floorId, width, height, tiles,
    stairUp: { x: 1, y: 1 }, stairDown: { x: width - 2, y: height - 2 },
    knowledge: createUnknownKnowledge(tiles.length),
  });
}

// A floor that is entirely wall except an L-shaped 1-wide corridor connecting its stairs and
// exactly one dead-end branch cell off that corridor: the corridor itself is the sole route
// between the stairs, so `placePopulation`'s route protection excludes every corridor cell from
// candidates, leaving the branch as the only legal placement -- whichever attempt claims it leaves
// every later attempt with zero legal cells.
function corridorWithOneBranchFloor(width: number, height: number, branch: Readonly<{ x: number; y: number }>): FloorSnapshot {
  const tiles = new Array(width * height).fill(0) as number[];
  const index = (x: number, y: number): number => y * width + x;
  for (let x = 1; x <= width - 2; x += 1) tiles[index(x, 1)] = 1;
  for (let y = 1; y <= height - 2; y += 1) tiles[index(width - 2, y)] = 1;
  tiles[index(1, 1)] = 4;
  tiles[index(width - 2, height - 2)] = 5;
  tiles[index(branch.x, branch.y)] = 1;
  return floor({
    floorId: 'floor.density-branch', width, height, tiles: tiles as FloorSnapshot['tiles'],
    stairUp: { x: 1, y: 1 }, stairDown: { x: width - 2, y: height - 2 },
    knowledge: createUnknownKnowledge(tiles.length),
  });
}

describe('placeFloorPopulations (encounter density)', () => {
  it('gives an 80x25 floor exactly 1 attempt (2000 cells / 2000 cellsPerEncounter)', () => {
    const encounter = individual('encounter.density-80x25', { maximumInstancesPerRun: 8 });
    const run = runFor([encounter]);

    const result = placeFloorPopulations({ run, floor: openFloor(80, 25), content: pack([encounter]) });

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]).toMatchObject({ status: 'placed' });
  });

  it('gives a 160x50 floor exactly 4 attempts (8000 cells / 2000 cellsPerEncounter)', () => {
    const encounter = individual('encounter.density-160x50', { maximumInstancesPerRun: 8 });
    const run = runFor([encounter]);

    const result = placeFloorPopulations({ run, floor: openFloor(160, 50), content: pack([encounter]) });

    expect(result.placements).toHaveLength(4);
    expect(result.placements.every((entry) => entry.status === 'placed')).toBe(true);
    // Distinct populationIds, all threaded onto the same run.
    const populationIds = new Set(result.state.populations.map((population) => population.populationId));
    expect(populationIds.size).toBe(4);
    expect(result.state.actors.filter((actor) => actor.populationId !== null)).toHaveLength(4);
  });

  it('clamps attempts at 8 for an arbitrarily large floor', () => {
    const encounter = individual('encounter.density-clamp', { maximumInstancesPerRun: 1 });
    const run: ActiveRun = {
      ...runFor([encounter]),
      // Already at its instance cap: every attempt is a cheap, tiles-untouched "no-eligible-encounter"
      // skip, so the huge nominal floor area below never needs a real tile array.
      encounterDecisions: [{
        encounterId: encounter.id, baseProbability: 1, protectionBonus: 0, effectiveProbability: 1,
        eligible: true, reachedEligibleDepth: false, encountered: false, instancesCreated: 1,
      }],
    };
    const massiveFloor = floor({ width: 4000, height: 4000, tiles: [0] });

    const result = placeFloorPopulations({ run, floor: massiveFloor, content: pack([encounter]) });

    expect(result.placements).toHaveLength(8);
    expect(result.placements.every((entry) => entry.status === 'skipped' && entry.reason === 'no-eligible-encounter')).toBe(true);
  });

  it('stops the loop as soon as a required encounter is rejected, short of the attempt budget', () => {
    const encounter = individual('encounter.density-rejected', {
      maximumInstancesPerRun: 8, placement: { ...placement, failureMode: 'required' },
    });
    const run = runFor([encounter]);
    // 160x50 gives a budget of 4 attempts, but only one legal (non-route) cell exists on the
    // whole floor -- the corridor connecting the stairs is protected and excluded from candidates.
    const floorWithOneCell = corridorWithOneBranchFloor(160, 50, { x: 80, y: 2 });

    const result = placeFloorPopulations({ run, floor: floorWithOneCell, content: pack([encounter]) });

    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]).toMatchObject({ status: 'placed' });
    expect(result.placements[1]).toMatchObject({ status: 'rejected', reason: 'required-route-blocked' });
  });
});
