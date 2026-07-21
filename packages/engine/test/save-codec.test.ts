import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory, type CompiledContentPack } from '@woven-deep/content/compiler';
import {
  createDemoContentPack,
  createDemoRun,
  createGameplayDemoRun,
  createUnknownKnowledge,
  decodeActiveRun,
  emptyEquipment,
  emptyRunMetrics,
  encodeActiveRun,
  deriveRngStreams,
  heroPerception,
  refreshKnowledge,
  resolveCommand as resolveCommandWithContext,
  SaveLoadError,
  validateActiveRun,
  validateContentBoundRun,
  type ChestFeature,
  type DoorFeature,
  type GameCommand,
} from '../src/index.js';

const context = { content: createDemoContentPack() };
let compiledContent: CompiledContentPack;

beforeAll(async () => {
  compiledContent = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});
const resolveCommand = (
  state: Parameters<typeof resolveCommandWithContext>[0],
  command: Parameters<typeof resolveCommandWithContext>[1],
) => resolveCommandWithContext(state, command, context);

describe('active-run save codec', () => {
  // Pre-Weave saves carry no per-actor weave/maxWeave; drop them so a legacy fixture and the
  // reciprocal strip both round-trip against the frozen legacy actor shape.
  const stripActorWeave = (run: Record<string, unknown>): Record<string, unknown> => ({
    ...run,
    actors: (run.actors as { weave?: number; maxWeave?: number }[]).map(
      ({ weave: _weave, maxWeave: _maxWeave, ...actor }) => actor,
    ),
  });

  function v4Fixture(): Record<string, unknown> {
    const current = structuredClone(createDemoRun()) as any;
    const {
      reputations: _reputations,
      activeTrade: _activeTrade,
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutRunFields
    } = current;
    const {
      currency: _currency,
      classTags: _classTags,
      statModifiers: _statModifiers,
      ...hero
    } = withoutRunFields.hero;
    const {
      'merchant-stock': _merchantStock,
      'merchant-runtime': _merchantRuntime,
      'run-records': _runRecords,
      ...rng
    } = withoutRunFields.rng;
    return stripActorWeave({ ...withoutRunFields, schemaVersion: 4, hero, rng });
  }

  function stripToV4Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = structuredClone(run) as any;
    const {
      reputations: _reputations,
      activeTrade: _activeTrade,
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutRunFields
    } = current;
    const {
      currency: _currency,
      classTags: _classTags,
      statModifiers: _statModifiers,
      ...hero
    } = withoutRunFields.hero;
    const {
      'merchant-stock': _merchantStock,
      'merchant-runtime': _merchantRuntime,
      'run-records': _runRecords,
      ...rng
    } = withoutRunFields.rng;
    return stripActorWeave({ ...withoutRunFields, schemaVersion: 4, hero, rng });
  }

  function v5Fixture(): Record<string, unknown> {
    const current = structuredClone(createDemoRun()) as any;
    const {
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV6Fields
    } = current;
    const { 'run-records': _runRecords, ...rng } = withoutV6Fields.rng;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = withoutV6Fields.hero;
    return stripActorWeave({ ...withoutV6Fields, schemaVersion: 5, hero, rng });
  }

  function stripV6Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = structuredClone(run) as any;
    const {
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV6Fields
    } = current;
    const { 'run-records': _runRecords, ...rng } = withoutV6Fields.rng;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = withoutV6Fields.hero;
    return stripActorWeave({ ...withoutV6Fields, schemaVersion: 5, hero, rng });
  }

  function v6Fixture(): Record<string, unknown> {
    const current = structuredClone(createDemoRun()) as any;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = current.hero;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripActorWeave({ ...withoutV8Fields, schemaVersion: 6, hero });
  }

  function stripV7Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = structuredClone(run) as any;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = current.hero;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripActorWeave({ ...withoutV8Fields, schemaVersion: 6, hero });
  }

  function v7Fixture(): Record<string, unknown> {
    const current = structuredClone(createDemoRun()) as any;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripActorWeave({ ...withoutV8Fields, schemaVersion: 7 });
  }

  function stripV8Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = structuredClone(run) as any;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripActorWeave({ ...withoutV8Fields, schemaVersion: 7 });
  }

  function concludedRun(): ReturnType<typeof createDemoRun> {
    const base = createDemoRun();
    const heroActor = { ...base.actors[0]!, health: 0 };
    return {
      ...base,
      actors: [heroActor],
      metrics: {
        ...emptyRunMetrics(),
        kills: 1,
        killsByModel: { ...emptyRunMetrics().killsByModel, individual: 1 },
      },
      conclusion: {
        completionType: 'died' as const,
        cause: {
          killerContentId: 'monster.cave-rat',
          depth: base.floors[0]!.depth,
          turn: base.turn,
          worldTime: base.worldTime,
        },
        concludedAtRevision: base.revision,
        finalized: false,
      },
    };
  }

  function heroWaitRecord(
    state: ReturnType<typeof createDemoRun>,
    commandId: string,
    extraEvents: readonly Record<string, unknown>[],
  ) {
    const revision = state.revision + 1;
    const turn = state.turn + 1;
    const heroActor = state.actors.find((actor) => actor.actorId === state.hero.actorId)!;
    const command = { type: 'wait' as const, commandId, expectedRevision: state.revision };
    const result = { status: 'applied' as const, commandId, revision, turn };
    const waited = {
      type: 'hero.waited' as const,
      eventId: commandId,
      heroId: state.hero.actorId,
      x: heroActor.x,
      y: heroActor.y,
    };
    const record = {
      command,
      result,
      events: [waited, ...extraEvents.map((event) => ({ ...event, eventId: commandId }))],
      publicEvents: [],
    };
    return { record, revision, turn };
  }

  function merchantRun(): ReturnType<typeof createDemoRun> {
    const run = structuredClone(createDemoRun()) as any;
    const merchantActor = {
      ...run.actors[0],
      actorId: 'actor.merchant.1',
      contentId: 'npc.lampwright',
      playerControlled: false,
      x: 2,
      disposition: 'neutral',
      behaviorId: 'npc-behavior.travelling-merchant',
      populationId: 'population.merchant.1',
      populationRoleId: null,
      populationPresentation: { name: 'Lampwright', glyph: 'L', color: '#ffd080', leader: false },
    };
    const stock = {
      itemId: 'item.merchant.1',
      contentId: 'item.lantern',
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'merchant-stock', populationId: 'population.merchant.1' },
    };
    run.actors = [...run.actors, merchantActor].sort((left, right) =>
      left.actorId.localeCompare(right.actorId),
    );
    run.items = [stock];
    run.encounterDecisions = [
      {
        encounterId: 'encounter.travelling-lampwright',
        baseProbability: 0.25,
        protectionBonus: 0,
        effectiveProbability: 0.25,
        eligible: true,
        reachedEligibleDepth: true,
        encountered: true,
        instancesCreated: 1,
      },
    ];
    run.populations = [
      {
        populationId: 'population.merchant.1',
        encounterId: 'encounter.travelling-lampwright',
        floorId: merchantActor.floorId,
        createdAt: 0,
        livingMemberIds: [merchantActor.actorId],
        formerMemberIds: [],
        model: 'merchant',
        actorId: merchantActor.actorId,
        npcId: 'npc.travelling-lampwright',
        factionId: 'npc-faction.lampwrights',
        rolledLifetime: 3000,
        departureAt: 3000,
        emittedWarningThresholds: [],
        initialStockItemIds: [stock.itemId],
        stockItemIds: [stock.itemId],
        services: [
          {
            serviceId: 'merchant-service.identify',
            basePrice: 10,
            remainingUses: 1,
            tierIds: ['neutral', 'trusted'],
          },
        ],
        lifecycle: 'available',
        provoked: false,
        aggressionPenaltyApplied: false,
        deathPenaltyApplied: false,
        stockLossResolved: false,
        commerceBonusApplied: false,
      },
    ];
    run.reputations = [{ factionId: 'npc-faction.lampwrights', value: 0 }];
    return run;
  }

  function contentBoundMerchantRun(): any {
    const run = structuredClone(createGameplayDemoRun(compiledContent).run) as any;
    const hero = run.actors.find((actor: any) => actor.actorId === run.hero.actorId);
    const actor = {
      ...hero,
      actorId: 'actor.merchant.content',
      contentId: 'npc.travelling-lampwright',
      playerControlled: false,
      disposition: 'neutral',
      behaviorId: 'npc-behavior.travelling-merchant',
      equipment: emptyEquipment(),
      populationId: 'population.merchant.content',
      populationRoleId: null,
      populationPresentation: {
        name: 'Travelling Lampwright',
        glyph: 'L',
        color: '#ffd080',
        leader: false,
      },
    };
    const stock = {
      ...run.items[0],
      itemId: 'item.merchant.content.stock',
      heirloom: undefined,
      location: { type: 'merchant-stock', populationId: 'population.merchant.content' },
    };
    const population = {
      populationId: 'population.merchant.content',
      encounterId: 'encounter.travelling-lampwright',
      floorId: actor.floorId,
      createdAt: 0,
      livingMemberIds: [actor.actorId],
      formerMemberIds: [],
      model: 'merchant',
      actorId: actor.actorId,
      npcId: 'npc.travelling-lampwright',
      factionId: 'npc-faction.lampwrights',
      rolledLifetime: 3000,
      departureAt: 3000,
      emittedWarningThresholds: [],
      initialStockItemIds: [stock.itemId],
      stockItemIds: [stock.itemId],
      services: [
        {
          serviceId: 'merchant-service.identify',
          basePrice: 10,
          remainingUses: 1,
          tierIds: ['neutral', 'trusted'],
        },
      ],
      lifecycle: 'available',
      provoked: false,
      aggressionPenaltyApplied: false,
      deathPenaltyApplied: false,
      stockLossResolved: false,
      commerceBonusApplied: false,
    };
    run.actors = [...run.actors, actor].sort((left, right) =>
      left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0,
    );
    run.items = [...run.items, stock].sort((left, right) =>
      left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
    );
    run.populations = [...run.populations, population].sort((left, right) =>
      left.populationId < right.populationId ? -1 : left.populationId > right.populationId ? 1 : 0,
    );
    run.reputations = [{ factionId: population.factionId, value: 0 }];
    run.encounterDecisions = run.encounterDecisions.map((decision: any) =>
      decision.encounterId === population.encounterId
        ? {
            ...decision,
            eligible: true,
            reachedEligibleDepth: true,
            instancesCreated: decision.instancesCreated + 1,
          }
        : decision,
    );
    return run;
  }

  function deadMerchant(run: any): any {
    const population = run.populations.find((candidate: any) => candidate.model === 'merchant');
    run.actors = run.actors.map((actor: any) =>
      actor.actorId === population.actorId ? { ...actor, health: 0 } : actor,
    );
    run.items = run.items.filter(
      (item: any) =>
        item.location.type !== 'merchant-stock' ||
        item.location.populationId !== population.populationId,
    );
    population.lifecycle = 'dead';
    population.livingMemberIds = [];
    population.formerMemberIds = [population.actorId];
    population.stockItemIds = [];
    population.stockLossResolved = true;
    return population;
  }

  it('migrates strict schema v4 state through v5, v6, v7, v8, and v9 and preserves every former field', () => {
    const legacy = v4Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(9);
    expect(decoded.hero.currency).toBe(0);
    expect(decoded.hero.classTags).toEqual([]);
    expect(decoded.hero.statModifiers).toEqual({});
    expect(decoded.reputations).toEqual([]);
    expect(decoded.activeTrade).toBeNull();
    expect(decoded.metrics).toEqual(emptyRunMetrics());
    expect(decoded.conclusion).toBeNull();
    expect(decoded.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(decoded.restockedMilestones).toEqual([]);
    const derived = deriveRngStreams(legacy.runSeed as any);
    expect(decoded.rng['merchant-stock']).toEqual(derived['merchant-stock']);
    expect(decoded.rng['merchant-runtime']).toEqual(derived['merchant-runtime']);
    expect(decoded.rng['run-records']).toEqual(derived['run-records']);
    expect(stripToV4Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v5 state through v6, v7, v8, and v9 and preserves every former field', () => {
    const legacy = v5Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(9);
    expect(decoded.hero.classTags).toEqual([]);
    expect(decoded.hero.statModifiers).toEqual({});
    expect(decoded.metrics).toEqual(emptyRunMetrics());
    expect(decoded.conclusion).toBeNull();
    expect(decoded.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(decoded.restockedMilestones).toEqual([]);
    const derived = deriveRngStreams(legacy.runSeed as any);
    expect(decoded.rng['run-records']).toEqual(derived['run-records']);
    expect(stripV6Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v6 state through v7, v8, and v9 and preserves every former field', () => {
    const legacy = v6Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(9);
    expect(decoded.hero.classTags).toEqual([]);
    expect(decoded.hero.statModifiers).toEqual({});
    expect(decoded.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(decoded.restockedMilestones).toEqual([]);
    expect(stripV7Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v7 state to v9 and preserves every former field', () => {
    const legacy = v7Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(9);
    expect(decoded.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(decoded.restockedMilestones).toEqual([]);
    // A pre-Weave hero migrates to full Weave: maxWeave is base 4 + Wits, and weave starts full.
    const migratedHero = decoded.actors.find((actor) => actor.actorId === decoded.hero.actorId)!;
    expect(migratedHero.maxWeave).toBe(4 + migratedHero.attributes.wits);
    expect(migratedHero.weave).toBe(migratedHero.maxWeave);
    expect(stripV8Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it.each([
    [
      'hero currency',
      (legacy: any) => {
        legacy.hero.currency = 0;
      },
    ],
    [
      'merchant RNG stream',
      (legacy: any) => {
        legacy.rng['merchant-stock'] = [1, 2, 3, 4];
      },
    ],
    [
      'run reputation',
      (legacy: any) => {
        legacy.reputations = [];
      },
    ],
  ])('rejects schema-v5-only %s in strict schema v4 input', (_label, corrupt) => {
    const legacy = v4Fixture();
    corrupt(legacy);
    expect(() => decodeActiveRun(JSON.stringify(legacy))).toThrow(SaveLoadError);
  });

  it.each([
    [
      'negative metric value',
      (run: any) => {
        run.metrics = { ...run.metrics, kills: -1 };
      },
    ],
    [
      'unsafe metric value',
      (run: any) => {
        run.metrics = { ...run.metrics, kills: Number.MAX_SAFE_INTEGER + 1 };
      },
    ],
    [
      'extra metric key',
      (run: any) => {
        run.metrics = { ...run.metrics, bogus: 1 };
      },
    ],
    [
      'missing metric key',
      (run: any) => {
        const { kills: _kills, ...rest } = run.metrics;
        run.metrics = rest;
      },
    ],
    [
      'kills below killsByModel sum',
      (run: any) => {
        run.metrics = {
          ...run.metrics,
          kills: 0,
          killsByModel: { individual: 1, group: 0, swarm: 0, boss: 0 },
        };
      },
    ],
    [
      'non-null conclusion with a living hero',
      (run: any) => {
        run.actors[0].health = 20;
      },
    ],
    [
      'dead hero with a null conclusion',
      (run: any) => {
        run.conclusion = null;
      },
    ],
    [
      'finalized shape without the rest of a conclusion (structural)',
      (run: any) => {
        run.conclusion = { finalized: true };
      },
    ],
    [
      'concludedAtRevision above revision',
      (run: any) => {
        run.conclusion.concludedAtRevision = run.revision + 1;
      },
    ],
    [
      'cause.turn above turn',
      (run: any) => {
        run.conclusion.cause.turn = run.turn + 1;
      },
    ],
    [
      'cause.worldTime above worldTime',
      (run: any) => {
        run.conclusion.cause.worldTime = run.worldTime + 1;
      },
    ],
    [
      'non-null killerContentId on a non-died completion',
      (run: any) => {
        run.conclusion.completionType = 'refused';
      },
    ],
  ])('rejects strict v6 corruption: %s', (_label, corrupt) => {
    const input = structuredClone(concludedRun()) as any;
    corrupt(input);
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('round-trips a single retained run.concluded event once the run is concluded', () => {
    const state = concludedRun();
    const concludedEvent = {
      type: 'run.concluded' as const,
      completionType: state.conclusion!.completionType,
      cause: state.conclusion!.cause,
    };
    const { record, revision, turn } = heroWaitRecord(state, 'command.concluded', [concludedEvent]);
    const input = { ...state, revision, turn, recentCommands: [record] };
    expect(decodeActiveRun(encodeActiveRun(input))).toEqual(input);
  });

  it('rejects more than one retained run.concluded event across recentCommands', () => {
    const state = concludedRun();
    const concludedEvent = {
      type: 'run.concluded' as const,
      completionType: state.conclusion!.completionType,
      cause: state.conclusion!.cause,
    };
    const first = heroWaitRecord(state, 'command.concluded.1', [concludedEvent]);
    const second = heroWaitRecord(
      { ...state, revision: first.revision, turn: first.turn },
      'command.concluded.2',
      [concludedEvent],
    );
    const input = {
      ...state,
      revision: second.revision,
      turn: second.turn,
      recentCommands: [first.record, second.record],
    };
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('rejects a run.finalized event retained inside recentCommands', () => {
    const state = concludedRun();
    const finalizedEvent = {
      type: 'run.finalized' as const,
      recordId: 'record.demo',
      completionType: state.conclusion!.completionType,
      scoreTotal: 100,
    };
    const { record, revision, turn } = heroWaitRecord(state, 'command.finalized', [finalizedEvent]);
    expect(() => encodeActiveRun({ ...state, revision, turn, recentCommands: [record] })).toThrow(
      SaveLoadError,
    );
  });

  it('rejects an achievement.granted event retained inside recentCommands', () => {
    const state = concludedRun();
    const grantedEvent = {
      type: 'achievement.granted' as const,
      achievementId: 'achievement.first-champion-defeat',
      criteriaId: 'first-champion-defeat' as const,
      name: 'First Champion Defeat',
    };
    const { record, revision, turn } = heroWaitRecord(state, 'command.granted', [grantedEvent]);
    expect(() => encodeActiveRun({ ...state, revision, turn, recentCommands: [record] })).toThrow(
      SaveLoadError,
    );
  });

  it.each([-1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid hero currency %s', (currency) => {
    expect(() =>
      encodeActiveRun({ ...createDemoRun(), hero: { ...createDemoRun().hero, currency } } as any),
    ).toThrow(/hero\.currency/i);
  });

  it('rejects an empty-string hero class tag', () => {
    const run = createDemoRun();
    expect(() =>
      encodeActiveRun({ ...run, hero: { ...run.hero, classTags: [''] } } as any),
    ).toThrow(/hero\.classTags/i);
  });

  it('rejects a hero stat modifier with an unknown stat key', () => {
    const run = createDemoRun();
    expect(() =>
      encodeActiveRun({ ...run, hero: { ...run.hero, statModifiers: { bogusStat: 1 } } } as any),
    ).toThrow(/hero\.statModifiers/i);
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a hero stat modifier value %s that is not a safe integer',
    (value) => {
      const run = createDemoRun();
      expect(() =>
        encodeActiveRun({
          ...run,
          hero: { ...run.hero, statModifiers: { defense: value } },
        } as any),
      ).toThrow(/hero\.statModifiers/i);
    },
  );

  it('rejects unsorted and duplicate faction reputation records', () => {
    const run = createDemoRun();
    expect(() =>
      encodeActiveRun({
        ...run,
        reputations: [
          { factionId: 'faction.z', value: 0 },
          { factionId: 'faction.a', value: 0 },
        ],
      } as any),
    ).toThrow(/reputations\.1\.factionId|strictly increasing/i);
    expect(() =>
      encodeActiveRun({
        ...run,
        reputations: [
          { factionId: 'faction.a', value: 0 },
          { factionId: 'faction.a', value: 1 },
        ],
      } as any),
    ).toThrow(/reputations\.1\.factionId|strictly increasing/i);
  });

  it.each([
    [
      'missing actor',
      (run: any) => {
        run.actors = run.actors.filter(
          (actor: any) => actor.actorId !== run.populations[0].actorId,
        );
      },
    ],
    [
      'invalid departure',
      (run: any) => {
        run.populations[0].departureAt = 2999;
      },
    ],
    [
      'inconsistent warning',
      (run: any) => {
        run.populations[0].emittedWarningThresholds = [3000];
      },
    ],
    [
      'negative service uses',
      (run: any) => {
        run.populations[0].services[0].remainingUses = -1;
      },
    ],
    [
      'duplicate service',
      (run: any) => {
        run.populations[0].services.push(run.populations[0].services[0]);
      },
    ],
    [
      'contradictory penalty',
      (run: any) => {
        run.populations[0].aggressionPenaltyApplied = true;
      },
    ],
    [
      'unapplied provocation',
      (run: any) => {
        run.populations[0].provoked = true;
      },
    ],
    [
      'available after provocation',
      (run: any) => {
        run.populations[0].provoked = true;
        run.populations[0].aggressionPenaltyApplied = true;
        run.populations[0].stockLossResolved = true;
      },
    ],
    [
      'dangling stock id',
      (run: any) => {
        run.populations[0].stockItemIds = ['item.missing'];
      },
    ],
    [
      'reverse dangling stock',
      (run: any) => {
        run.populations[0].stockItemIds = [];
      },
    ],
    [
      'departed actor',
      (run: any) => {
        run.populations[0].lifecycle = 'departed';
      },
    ],
    [
      'dead living actor',
      (run: any) => {
        run.populations[0].lifecycle = 'dead';
      },
    ],
  ])('rejects invalid merchant lifecycle state: %s', (_label, corrupt) => {
    const run = merchantRun() as any;
    corrupt(run);
    expect(() => encodeActiveRun(run)).toThrow(
      /population|merchant|stock|service|departure|warning|penalty/i,
    );
  });

  it('rejects an active trade that does not match an adjacent available merchant', () => {
    const run = merchantRun() as any;
    run.activeTrade = {
      merchantPopulationId: run.populations[0].populationId,
      merchantActorId: 'actor.missing',
      openedByCommandId: 'command.trade-open',
      openedAtRevision: 0,
      completedCommerce: false,
    };
    expect(() => encodeActiveRun(run)).toThrow(/activeTrade|merchantActorId/i);
  });

  it.each(['available', 'fleeing', 'departed', 'dead'] as const)(
    'round-trips a valid %s merchant lifecycle',
    (lifecycle) => {
      const run = merchantRun() as any;
      const population = run.populations[0];
      population.lifecycle = lifecycle;
      if (lifecycle === 'fleeing') {
        population.provoked = true;
        population.aggressionPenaltyApplied = true;
        population.stockLossResolved = true;
      }
      if (lifecycle === 'departed') {
        run.actors = run.actors.filter((actor: any) => actor.actorId !== population.actorId);
        run.items = [];
        population.livingMemberIds = [];
        population.formerMemberIds = [];
        population.stockItemIds = [];
      }
      if (lifecycle === 'dead') {
        run.actors = run.actors.map((actor: any) =>
          actor.actorId === population.actorId ? { ...actor, health: 0 } : actor,
        );
        run.items = [];
        population.livingMemberIds = [];
        population.formerMemberIds = [population.actorId];
        population.stockItemIds = [];
        population.stockLossResolved = true;
        population.deathPenaltyApplied = true;
      }
      expect(decodeActiveRun(encodeActiveRun(run))).toEqual(run);
    },
  );

  it('round-trips a permanent merchant with a null departureAt', () => {
    const run = merchantRun() as any;
    run.populations[0].departureAt = null;
    expect(decodeActiveRun(encodeActiveRun(run))).toEqual(run);
  });

  it('rejects a permanent merchant whose emitted warnings still bound its rolled lifetime', () => {
    const run = merchantRun() as any;
    run.populations[0].departureAt = null;
    run.populations[0].emittedWarningThresholds = [4000];
    expect(() => encodeActiveRun(run)).toThrow(/warning/i);
  });

  it('round-trips a house-located item stack within house capacity', () => {
    const run = createDemoRun() as any;
    run.items = [
      {
        itemId: 'item.house.1',
        contentId: 'item.lantern',
        quantity: 1,
        condition: 100,
        enchantment: null,
        identified: true,
        charges: null,
        fuel: null,
        enabled: null,
        location: { type: 'house' },
      },
    ];
    expect(decodeActiveRun(encodeActiveRun(run))).toEqual(run);
  });

  it('rejects more house item stacks than the house capacity allows', () => {
    const run = createDemoRun() as any;
    run.house = { capacity: 1, upgradesPurchased: 0 };
    run.items = [0, 1].map((index) => ({
      itemId: `item.house.${index}`,
      contentId: 'item.lantern',
      quantity: 1,
      condition: 100,
      enchantment: null,
      identified: true,
      charges: null,
      fuel: null,
      enabled: null,
      location: { type: 'house' as const },
    }));
    expect(() => encodeActiveRun(run)).toThrow(/house\.capacity|capacity/i);
  });

  it('round-trips an invalid trade-service command with a null target item id', () => {
    const state = createDemoRun();
    const command = {
      type: 'trade-service' as const,
      commandId: 'command.service-null',
      expectedRevision: 0,
      merchantPopulationId: 'population.missing',
      serviceId: 'merchant-service.identify' as const,
      targetItemId: null,
    };
    const result = {
      status: 'invalid' as const,
      commandId: command.commandId,
      revision: 0,
      turn: 0,
      reason: 'merchant.unavailable' as const,
    };
    const invalidEvent = {
      type: 'action.invalid' as const,
      eventId: command.commandId,
      commandId: command.commandId,
      reason: result.reason,
    };
    const withHistory = {
      ...state,
      recentCommands: [{ command, result, events: [invalidEvent], publicEvents: [] }],
    };
    expect(decodeActiveRun(encodeActiveRun(withHistory))).toEqual(withHistory);
  });

  it.each(['house-deposit', 'house-withdraw'] as const)(
    'round-trips an invalid %s command rejected as house.full',
    (type) => {
      const state = createDemoRun();
      const command = {
        type,
        commandId: `command.${type}`,
        expectedRevision: 0,
        itemId: 'item.house.1',
        quantity: 1,
      };
      const result = {
        status: 'invalid' as const,
        commandId: command.commandId,
        revision: 0,
        turn: 0,
        reason: 'house.full' as const,
      };
      const invalidEvent = {
        type: 'action.invalid' as const,
        eventId: command.commandId,
        commandId: command.commandId,
        reason: result.reason,
      };
      const withHistory = {
        ...state,
        recentCommands: [{ command, result, events: [invalidEvent], publicEvents: [] }],
      };
      expect(decodeActiveRun(encodeActiveRun(withHistory))).toEqual(withHistory);
    },
  );

  it('rejects a house.full reason attached to a non-house command', () => {
    const state = createDemoRun();
    const command = { type: 'wait' as const, commandId: 'command.wait-house', expectedRevision: 0 };
    const result = {
      status: 'invalid' as const,
      commandId: command.commandId,
      revision: 0,
      turn: 0,
      reason: 'house.full' as const,
    };
    const invalidEvent = {
      type: 'action.invalid' as const,
      eventId: command.commandId,
      commandId: command.commandId,
      reason: result.reason,
    };
    expect(() =>
      encodeActiveRun({
        ...state,
        recentCommands: [{ command, result, events: [invalidEvent], publicEvents: [] }],
      }),
    ).toThrow(/house reason requires a house command/i);
  });

  it.each(['town.truce', 'town.rest'] as const)(
    'round-trips an invalid wait command rejected as %s',
    (reason) => {
      const state = createDemoRun();
      const command = {
        type: 'wait' as const,
        commandId: `command.${reason}`,
        expectedRevision: 0,
      };
      const result = {
        status: 'invalid' as const,
        commandId: command.commandId,
        revision: 0,
        turn: 0,
        reason,
      };
      const invalidEvent = {
        type: 'action.invalid' as const,
        eventId: command.commandId,
        commandId: command.commandId,
        reason,
      };
      const withHistory = {
        ...state,
        recentCommands: [{ command, result, events: [invalidEvent], publicEvents: [] }],
      };
      expect(decodeActiveRun(encodeActiveRun(withHistory))).toEqual(withHistory);
    },
  );

  it('rejects a dead merchant whose death transition was not flagged as resolved', () => {
    const run = merchantRun() as any;
    const population = deadMerchant(run);
    population.deathPenaltyApplied = false;
    expect(() => encodeActiveRun(run)).toThrow(/deathPenaltyApplied|death penalty/i);
  });

  it('accepts a resolved dead merchant even when the authored death reputation delta is zero', () => {
    const run = contentBoundMerchantRun();
    const population = deadMerchant(run);
    population.deathPenaltyApplied = true;
    const content = structuredClone(compiledContent) as any;
    const encounter = content.entries.find((entry: any) => entry.id === population.encounterId);
    encounter.definition.deathReputationDelta = 0;
    expect(() => validateActiveRun(run)).not.toThrow();
    expect(() => validateContentBoundRun(run, content)).not.toThrow();
  });

  it.each([
    [
      'NPC',
      (run: any) => {
        run.populations.at(-1).npcId = 'npc.missing';
      },
    ],
    [
      'faction',
      (run: any) => {
        run.populations.at(-1).factionId = 'npc-faction.missing';
      },
    ],
    [
      'encounter',
      (run: any) => {
        run.populations.at(-1).encounterId = 'encounter.missing';
      },
    ],
    [
      'service',
      (run: any) => {
        run.populations.at(-1).services[0].serviceId = 'merchant-service.missing';
      },
    ],
  ])('rejects a merchant with a missing content-bound %s reference', (_label, corrupt) => {
    const run = contentBoundMerchantRun();
    expect(() => validateContentBoundRun(run, compiledContent)).not.toThrow();
    corrupt(run);
    expect(() => validateContentBoundRun(run, compiledContent)).toThrow(
      /content-bound validation/i,
    );
  });

  it.each([
    [
      'missing service state',
      (population: any) => {
        population.services = [];
      },
    ],
    [
      'extra service state',
      (population: any) => {
        population.services.push(structuredClone(population.services[0]));
      },
    ],
    [
      'base price mismatch',
      (population: any) => {
        population.services[0].basePrice += 1;
      },
    ],
    [
      'tier mismatch',
      (population: any) => {
        population.services[0].tierIds = ['trusted'];
      },
    ],
    [
      'uses above authored maximum',
      (population: any) => {
        population.services[0].remainingUses = 3;
      },
    ],
  ])('rejects merchant content with %s', (_label, corrupt) => {
    const run = contentBoundMerchantRun();
    const population = run.populations.find((candidate: any) => candidate.model === 'merchant');
    corrupt(population);
    expect(() => validateContentBoundRun(run, compiledContent)).toThrow(
      /merchant population.*service/i,
    );
  });

  it('accepts zero remaining merchant service uses after depletion below the authored initial minimum', () => {
    const run = contentBoundMerchantRun();
    const population = run.populations.find((candidate: any) => candidate.model === 'merchant');
    population.services[0].remainingUses = 0;
    expect(() => validateContentBoundRun(run, compiledContent)).not.toThrow();
  });

  function richRun(): ReturnType<typeof createDemoRun> {
    const base = createDemoRun();
    const tiles = [
      0, 0, 0, 0, 0, 0, 4, 1, 2, 0, 0, 1, 3, 1, 0, 0, 1, 5, 1, 0, 0, 0, 0, 0, 0,
    ] as const;
    const hero = { ...base.hero, sightRadius: 12 };
    const heroActor = { ...base.actors[0]!, floorId: 'floor.rich', x: 1, y: 2 };
    const floor = {
      ...base.floors[0]!,
      floorId: 'floor.rich',
      width: 5,
      height: 5,
      tiles,
      themeId: 'theme.rich',
      ambient: { color: [255, 240, 224] as const, strength: 64 },
      knowledge: createUnknownKnowledge(25),
      lights: [
        {
          lightId: 'light.a',
          location: { type: 'fixed' as const, x: 2, y: 1 },
          color: [255, 128, 64] as const,
          radius: 4,
          strength: 200,
          enabled: true,
          falloff: 'linear' as const,
          vaultPlacementId: 'placement.a',
          presentation: { glyph: '*', token: 'fixture.torch' },
        },
        {
          lightId: 'light.b',
          location: { type: 'actor' as const, actorId: heroActor.actorId },
          color: [64, 128, 255] as const,
          radius: 3,
          strength: 100,
          enabled: true,
          falloff: 'linear' as const,
          vaultPlacementId: null,
          presentation: null,
        },
      ],
      stairUp: { x: 1, y: 1 },
      stairDown: { x: 2, y: 3 },
      vaults: [
        {
          placementId: 'placement.a',
          vaultId: 'vault.a',
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          rotation: 90 as const,
          reflected: true,
          entrances: [{ x: 1, y: 2 }],
        },
      ],
      placementSlots: [
        {
          slotId: 'slot.a',
          vaultPlacementId: 'placement.a',
          kind: 'fixture' as const,
          required: true,
          tags: ['lit'],
          x: 2,
          y: 1,
        },
      ],
      entities: [{ entityId: 'entity.a', x: 3, y: 2 }],
    };
    const knowledge = refreshKnowledge({
      floor,
      hero: heroPerception(hero, heroActor),
      actors: new Map([
        [heroActor.actorId, heroActor],
        ['entity.a', floor.entities[0]!],
      ]),
    }).knowledge;
    return {
      ...base,
      hero,
      actors: [heroActor],
      features: [
        {
          featureId: 'door.rich.1',
          type: 'door',
          floorId: floor.floorId,
          x: 3,
          y: 1,
          contentId: null,
          coverTileId: 2,
          state: 'closed',
        },
      ],
      activeFloorId: floor.floorId,
      floors: [{ ...floor, knowledge }],
    } as ReturnType<typeof createDemoRun>;
  }

  function populationRun(): ReturnType<typeof createDemoRun> {
    const base = createDemoRun();
    const hero = base.actors[0]!;
    const beetle = {
      ...hero,
      actorId: 'monster.beetle.1',
      contentId: 'monster.training-beetle',
      playerControlled: false,
      x: 2,
      y: 1,
      disposition: 'hostile' as const,
      awareActorIds: [hero.actorId],
      behaviorId: 'behavior.approach-and-attack',
      behaviorState: {
        intent: 'regroup' as const,
        goal: {
          type: 'formation' as const,
          populationId: 'population.beetles.1',
          roleId: 'guard',
          x: 3,
          y: 1,
        },
        lastKnownTargets: [
          {
            targetActorId: hero.actorId,
            floorId: hero.floorId,
            x: hero.x,
            y: hero.y,
            observedAt: 0,
            source: 'sight' as const,
            observerActorId: 'monster.beetle.1',
          },
        ],
        investigation: { floorId: hero.floorId, x: 3, y: 1, startedAt: 0, expiresAt: 300 },
      },
      populationId: 'population.beetles.1',
      populationRoleId: 'guard',
      populationPresentation: { name: 'Beetle guard', glyph: 'B', color: '#d3b45f', leader: true },
    };
    const heirloom = (recordId: string, contentId: string) => ({
      contentId,
      sourceItemId: 'item.recorded.1',
      enchantment: null,
      condition: 90,
      charges: null,
      fuel: null,
      qualityRank: 3,
      displayName: 'Old iron sword',
      glyph: ')',
      color: '#c0c0c0',
      originatingHallRecordId: recordId,
    });
    return {
      ...base,
      actors: [hero, beetle],
      encounterDecisions: [
        {
          encounterId: 'encounter.beetle-patrol',
          baseProbability: 0.65,
          protectionBonus: 0.08,
          effectiveProbability: 0.73,
          eligible: true,
          reachedEligibleDepth: true,
          encountered: true,
          instancesCreated: 1,
        },
      ],
      populations: [
        {
          populationId: 'population.beetles.1',
          encounterId: 'encounter.beetle-patrol',
          floorId: hero.floorId,
          createdAt: 0,
          model: 'group' as const,
          livingMemberIds: [beetle.actorId],
          formerMemberIds: [],
          leaderActorId: beetle.actorId,
          bonusActive: true,
          roleMembership: [{ actorId: beetle.actorId, roleId: 'guard' }],
          sharedKnowledge: beetle.behaviorState.lastKnownTargets,
          leaderResponseApplied: false,
          leaderResponseExpiresAt: null,
        },
      ],
      fallenHeroStandings: [
        {
          rank: 1,
          hallRecordId: 'hall.champion',
          heroName: 'Brynja',
          portraitGlyph: '@',
          classTags: ['fighter'],
          attributes: hero.attributes,
          equippedItemContentIds: ['item.iron-sword'],
          signatureAbilityIds: ['ability.cleave'],
          deathDepth: 8,
          sourceContentHash: base.contentHash,
          heirloom: heirloom('hall.champion', 'item.iron-sword'),
        },
        {
          rank: 2,
          hallRecordId: 'hall.echo',
          heroName: 'Cormac',
          portraitGlyph: '@',
          classTags: ['scout'],
          attributes: hero.attributes,
          equippedItemContentIds: ['item.short-bow'],
          signatureAbilityIds: ['ability.quick-shot'],
          deathDepth: 5,
          sourceContentHash: base.contentHash,
          heirloom: heirloom('hall.echo', 'item.short-bow'),
        },
      ],
      fallenHeroDecisions: [
        {
          hallRecordId: 'hall.champion',
          rank: 1,
          role: 'champion' as const,
          gateRoll: null,
          retained: true,
          encountered: false,
          defeated: false,
        },
        {
          hallRecordId: 'hall.echo',
          rank: 2,
          role: 'echo' as const,
          gateRoll: 123,
          retained: true,
          encountered: false,
          defeated: false,
        },
      ],
    };
  }

  function expectInvalidSave(state: ReturnType<typeof createDemoRun>, path: string): void {
    try {
      encodeActiveRun(state);
      throw new Error('expected save validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveLoadError);
      expect((error as SaveLoadError).path).toBe(path);
      expect((error as Error).message).not.toContain(JSON.stringify(state));
    }
  }

  it('round-trips current state to identical stable bytes', () => {
    const state = createDemoRun();
    const encoded = encodeActiveRun(state);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(encoded.startsWith('{"activeFloorEnteredAt"')).toBe(true);
  });

  it('round-trips every Champion and Echo event through command history and duplicate replay', () => {
    const state = createDemoRun();
    const eventId = 'command.champion-events';
    const events = [
      { type: 'hero.waited' as const, eventId, heroId: state.hero.actorId, x: 1, y: 1 },
      {
        type: 'champion.encountered' as const,
        eventId,
        populationId: 'population.champion',
        actorId: 'actor.champion',
        hallRecordId: 'hall.champion',
        rank: 1 as const,
      },
      {
        type: 'champion.defeated' as const,
        eventId,
        populationId: 'population.champion',
        actorId: 'actor.champion',
        hallRecordId: 'hall.champion',
        rank: 1 as const,
      },
      {
        type: 'champion.heirloom-created' as const,
        eventId,
        populationId: 'population.champion',
        actorId: 'actor.champion',
        hallRecordId: 'hall.champion',
        rank: 1 as const,
        itemId: 'item.heirloom',
        contentId: 'item.sword',
        originatingHallRecordId: 'hall.champion',
        displayName: 'Safe sword',
        glyph: ')',
        color: '#c0c0c0',
        fallback: false,
      },
      {
        type: 'echo.encountered' as const,
        eventId,
        populationId: 'population.echo',
        actorId: 'actor.echo',
        hallRecordId: 'hall.echo',
        rank: 2,
      },
      {
        type: 'echo.defeated' as const,
        eventId,
        populationId: 'population.echo',
        actorId: 'actor.echo',
        hallRecordId: 'hall.echo',
        rank: 2,
      },
      {
        type: 'echo.loot-created' as const,
        eventId,
        populationId: 'population.echo',
        actorId: 'actor.echo',
        hallRecordId: 'hall.echo',
        rank: 2,
        itemIds: ['item.echo-loot'],
      },
    ];
    const command = {
      type: 'wait' as const,
      commandId: 'command.champion-events',
      expectedRevision: 0,
    };
    const result = {
      status: 'applied' as const,
      commandId: command.commandId,
      revision: 1,
      turn: 1,
    };
    const publicEvents = [
      {
        type: 'population.notice' as const,
        eventId,
        category: 'champion-encountered' as const,
        actorId: 'actor.champion',
        presentation: 'champion.encountered',
        displayName: "Brynja, the Deep's Champion",
      },
      {
        type: 'actor.damage-observed' as const,
        eventId,
        actorId: 'actor.champion',
        amount: 2,
        health: 8,
      },
      {
        type: 'actor.death-observed' as const,
        eventId,
        actorId: 'actor.champion',
        contentId: 'monster.champion',
        displayName: "Brynja, the Deep's Champion",
      },
    ];
    const withHistory = {
      ...state,
      revision: 1,
      turn: 1,
      recentCommands: [{ command, result, events, publicEvents }],
    };
    const loaded = decodeActiveRun(encodeActiveRun(withHistory));
    expect(loaded.recentCommands[0]?.events.slice(1)).toEqual(events.slice(1));
    expect(loaded.recentCommands[0]?.result).toEqual(result);
    const duplicate = resolveCommand(loaded, command);
    expect(duplicate.state).toBe(loaded);
    expect(duplicate.result).toEqual(result);
    expect(duplicate.events).toEqual(publicEvents);
  });

  it('rejects authoritative population details stored as public events', () => {
    const state = createDemoRun();
    const command = {
      type: 'wait' as const,
      commandId: 'command.private-public',
      expectedRevision: 0,
    };
    const result = {
      status: 'applied' as const,
      commandId: command.commandId,
      revision: 1,
      turn: 1,
    };
    const hidden = {
      type: 'boss.recovered' as const,
      eventId: command.commandId,
      populationId: 'population.secret',
      actorId: 'actor.secret',
      encounterId: 'encounter.secret',
      amount: 23,
      health: 88,
    };
    expect(() =>
      encodeActiveRun({
        ...state,
        revision: 1,
        turn: 1,
        recentCommands: [{ command, result, events: [hidden], publicEvents: [hidden] }],
      }),
    ).toThrow(/publicEvents/);
  });

  it('round-trips all schema v5 source state without storing derived fields', () => {
    const state = richRun();
    const encoded = encodeActiveRun(state);
    expect(decodeActiveRun(encoded)).toEqual(state);
    expect(encoded).not.toMatch(/visibilityWords|illumination|projection|generationReport/);
  });

  function lockedDoorRun(): ReturnType<typeof createDemoRun> & {
    features: readonly [DoorFeature];
  } {
    const base = createDemoRun();
    const door: DoorFeature = {
      featureId: 'door.locked.1',
      type: 'door',
      floorId: base.floors[0]!.floorId,
      x: 3,
      y: 2,
      contentId: null,
      coverTileId: 0,
      state: 'locked',
      lock: { difficulty: 12, keyContentId: 'item.key.locked' },
    };
    return { ...base, features: [door] };
  }

  function chestRun(
    state: 'locked' | 'closed' | 'looted' | 'jammed',
  ): ReturnType<typeof createDemoRun> & { features: readonly [ChestFeature] } {
    const base = createDemoRun();
    const chest: ChestFeature = {
      featureId: 'chest.1',
      type: 'chest',
      floorId: base.floors[0]!.floorId,
      x: 1,
      y: 1,
      contentId: null,
      coverTileId: 0,
      state,
      lock: state === 'locked' ? { difficulty: 14, keyContentId: null } : null,
      lootTableId: state === 'looted' || state === 'jammed' ? null : 'loot-table.chest',
      lootContentId: null,
    };
    return { ...base, features: [chest] };
  }

  it('round-trips a locked door carrying its lock payload', () => {
    const state = lockedDoorRun();
    expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
  });

  it('round-trips a door without a lock payload once unlocked', () => {
    const state = lockedDoorRun();
    const { lock: _lock, ...doorWithoutLock } = state.features[0]!;
    const unlocked = {
      ...state,
      features: [{ ...doorWithoutLock, state: 'closed' as const }],
    };
    expect(decodeActiveRun(encodeActiveRun(unlocked))).toEqual(unlocked);
  });

  it.each(['locked', 'closed', 'looted', 'jammed'] as const)('round-trips a %s chest', (state) => {
    const run = chestRun(state);
    expect(decodeActiveRun(encodeActiveRun(run))).toEqual(run);
  });

  it('rejects a locked door with no lock payload', () => {
    const state = lockedDoorRun();
    const { lock: _lock, ...doorWithoutLock } = state.features[0]!;
    const malformed = { ...state, features: [doorWithoutLock] };
    expectInvalidSave(malformed, 'features.0.lock');
  });

  it('rejects a closed door that still carries a lock payload', () => {
    const state = lockedDoorRun();
    const malformed = { ...state, features: [{ ...state.features[0]!, state: 'closed' as const }] };
    expectInvalidSave(malformed, 'features.0.lock');
  });

  it('rejects a locked chest with no lock payload', () => {
    const run = chestRun('locked');
    const malformed = { ...run, features: [{ ...run.features[0]!, lock: null }] };
    expectInvalidSave(malformed, 'features.0.lock');
  });

  it('rejects a closed chest that still carries a lock payload', () => {
    const run = chestRun('closed');
    const malformed = {
      ...run,
      features: [{ ...run.features[0]!, lock: { difficulty: 10, keyContentId: null } }],
    };
    expectInvalidSave(malformed, 'features.0.lock');
  });

  it('rejects a jammed chest still holding a live loot pointer', () => {
    const run = chestRun('jammed');
    const malformed = {
      ...run,
      features: [{ ...run.features[0]!, lootTableId: 'loot-table.chest' }],
    };
    expectInvalidSave(malformed, 'features.0.lootTableId');
  });

  it('rejects a looted chest still holding a live loot pointer', () => {
    const run = chestRun('looted');
    const malformed = {
      ...run,
      features: [{ ...run.features[0]!, lootContentId: 'item.gold' }],
    };
    expectInvalidSave(malformed, 'features.0.lootTableId');
  });

  it('rejects an unlooted chest with no loot pointer at all', () => {
    const run = chestRun('locked');
    const malformed = { ...run, features: [{ ...run.features[0]!, lootTableId: null }] };
    expectInvalidSave(malformed, 'features.0.lootTableId');
  });

  it('rejects a chest naming both a loot table and a loot content id', () => {
    const run = chestRun('closed');
    const malformed = {
      ...run,
      features: [{ ...run.features[0]!, lootContentId: 'item.gold' }],
    };
    expectInvalidSave(malformed, 'features.0.lootTableId');
  });

  it('round-trips durable group behavior and fallen-hero run decisions', () => {
    const state = populationRun();
    expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
  });

  it.each(['individual', 'swarm', 'boss', 'champion', 'echo'] as const)(
    'round-trips %s population state',
    (model) => {
      const state = structuredClone(populationRun()) as any;
      const actor = state.actors[1];
      actor.behaviorState = {
        intent: 'hold',
        goal: null,
        lastKnownTargets: [],
        investigation: null,
      };
      actor.populationRoleId = null;
      actor.populationPresentation.leader = false;
      const base = {
        populationId: `population.${model}.1`,
        encounterId: `encounter.${model}`,
        floorId: actor.floorId,
        createdAt: 0,
        model,
        livingMemberIds: [actor.actorId],
        formerMemberIds: [],
      };
      actor.populationId = base.populationId;
      if (model === 'individual') state.populations = [base];
      if (model === 'swarm')
        state.populations = [
          {
            ...base,
            sourceActorId: actor.actorId,
            nextSpawnAt: 300,
            spawnedCount: 0,
            peakLivingSize: 1,
            shutdownState: null,
            emittedCapLevels: [],
            shutdownExpiresAt: null,
          },
        ];
      if (model === 'boss')
        state.populations = [
          {
            ...base,
            actorId: actor.actorId,
            currentPhaseId: 'kindled',
            crossedPhaseIds: ['kindled'],
            lastFloorExitAt: null,
            rewardCreated: false,
            rewardReceipt: null,
            recoveryHistory: [],
          },
        ];
      if (model === 'champion' || model === 'echo') {
        const standing = state.fallenHeroStandings[model === 'champion' ? 0 : 1];
        base.encounterId = 'fallen-champion-template.core';
        state.populations = [
          {
            ...base,
            actorId: actor.actorId,
            hallRecordId: standing.hallRecordId,
            rank: standing.rank,
            defeated: false,
            equipmentContentIds: standing.equippedItemContentIds,
            abilityIds: standing.signatureAbilityIds,
            ...(model === 'champion' ? { rewardCreated: false } : { lootCreated: false }),
          },
        ];
        state.encounterDecisions = [];
      } else {
        state.encounterDecisions = [
          {
            encounterId: base.encounterId,
            baseProbability: 0.25,
            protectionBonus: 0,
            effectiveProbability: 0.25,
            eligible: true,
            reachedEligibleDepth: true,
            encountered: false,
            instancesCreated: 1,
          },
        ];
      }
      expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
    },
  );

  it.each(['group', 'swarm'] as const)('retains a defeated %s source identity', (model) => {
    const state = structuredClone(populationRun()) as any;
    const actor = state.actors[1];
    actor.health = 0;
    actor.behaviorState = { intent: 'flee', goal: null, lastKnownTargets: [], investigation: null };
    const population = state.populations[0];
    population.livingMemberIds = [];
    population.formerMemberIds = [actor.actorId];
    if (model === 'group') {
      population.bonusActive = false;
      population.leaderResponseApplied = true;
    } else {
      actor.populationRoleId = null;
      population.model = 'swarm';
      population.sourceActorId = actor.actorId;
      population.nextSpawnAt = 300;
      population.spawnedCount = 0;
      population.peakLivingSize = 1;
      population.shutdownState = 'flee';
      population.emittedCapLevels = [];
      population.shutdownExpiresAt = null;
      delete population.leaderActorId;
      delete population.bonusActive;
      delete population.roleMembership;
      delete population.sharedKnowledge;
      delete population.leaderResponseApplied;
      delete population.leaderResponseExpiresAt;
    }
    expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
  });

  it.each([
    [
      'actors.1.behaviorState.goal.roleId',
      (run: any) => {
        run.actors[1].behaviorState.goal.roleId = 'archer';
      },
    ],
    [
      'populations.0.roleMembership.0',
      (run: any) => {
        run.populations[0].roleMembership[0].roleId = 'archer';
      },
    ],
    [
      'populations.0.bonusActive',
      (run: any) => {
        run.populations[0].bonusActive = false;
      },
    ],
    [
      'fallenHeroStandings.1.hallRecordId',
      (run: any) => {
        run.fallenHeroStandings[1].hallRecordId = 'hall.champion';
      },
    ],
    [
      'fallenHeroDecisions.1.encountered',
      (run: any) => {
        run.fallenHeroDecisions[1].retained = false;
        run.fallenHeroDecisions[1].encountered = true;
      },
    ],
  ])('rejects inconsistent population state at %s', (path, corrupt) => {
    const input = structuredClone(populationRun()) as any;
    corrupt(input);
    expectInvalidSave(input, path);
  });

  it('round-trips expanded unavailable commands and ordered event arrays', () => {
    const processed = resolveCommand(createDemoRun(), {
      type: 'attack',
      commandId: 'command.saved-attack',
      expectedRevision: 0,
      targetActorId: 'monster.missing',
    }).state;
    const record = processed.recentCommands[0]!;
    const withMultipleEvents = {
      ...processed,
      recentCommands: [
        {
          ...record,
          events: [
            ...record.events,
            {
              type: 'actor.damaged' as const,
              eventId: 'command.saved-attack',
              actorId: 'hero.demo',
              sourceActorId: 'hero.demo',
              amount: 0,
              health: 20,
            },
            {
              type: 'condition.expired' as const,
              eventId: 'command.saved-attack',
              actorId: 'hero.demo',
              conditionId: 'condition.saved',
            },
            {
              type: 'hunger.stage-changed' as const,
              eventId: 'command.saved-attack',
              actorId: 'hero.demo',
              previousStage: 'sated' as const,
              stage: 'hungry' as const,
              reserve: 3000,
            },
            {
              type: 'hunger.restored' as const,
              eventId: 'command.saved-attack',
              actorId: 'hero.demo',
              amount: 5,
              reserve: 3005,
            },
            {
              type: 'fuel.warning' as const,
              eventId: 'command.saved-attack',
              itemId: 'item.lantern',
              threshold: 100,
              fuel: 90,
            },
            {
              type: 'item.light-extinguished' as const,
              eventId: 'command.saved-attack',
              itemId: 'item.lantern',
            },
            {
              type: 'actor.intent-changed' as const,
              eventId: 'command.saved-attack',
              actorId: 'hero.demo',
              intent: 'hold' as const,
              presentation: 'intent.hold' as const,
              targetCategory: null,
            },
          ],
          publicEvents: [],
        },
      ],
    };
    expect(decodeActiveRun(encodeActiveRun(withMultipleEvents))).toEqual(withMultipleEvents);
  });

  it.each([
    { type: 'attack', targetActorId: 'monster.target' },
    { type: 'fire', itemId: 'item.bow', target: { x: 2, y: 2 } },
    { type: 'cast', spellId: 'spell.spark', target: null },
    { type: 'throw-item', itemId: 'item.rock', quantity: 1, target: { x: 2, y: 2 } },
    { type: 'use-item', itemId: 'item.potion', target: null },
    { type: 'equip', itemId: 'item.sword', slot: 'main-hand' },
    { type: 'unequip', slot: 'main-hand' },
    { type: 'pickup', itemId: 'item.coin', quantity: 1 },
    { type: 'drop', itemId: 'item.coin', quantity: 1 },
    { type: 'split-stack', itemId: 'item.coin', quantity: 1, newItemId: 'item.coin.split' },
    { type: 'refuel', itemId: 'item.lantern', fuelItemId: 'item.oil', quantity: 1 },
    { type: 'toggle-light', itemId: 'item.lantern', enabled: true },
    { type: 'open-door', featureId: 'door.one' },
    { type: 'close-door', featureId: 'door.one' },
    { type: 'search' },
    { type: 'disarm', featureId: 'trap.one' },
    { type: 'rest', until: 'interrupted', maximumDuration: 500 },
  ] as const)('round-trips a processed $type command', (body) => {
    const command = {
      ...body,
      commandId: `command.${body.type}`,
      expectedRevision: 0,
    } as GameCommand;
    const state = resolveCommand(createDemoRun(), command).state;
    expect(decodeActiveRun(encodeActiveRun(state))).toEqual(state);
  });

  it.each([
    [
      'tile outside 0-6',
      (run: any) => {
        run.floors[0].tiles[6] = 7;
      },
    ],
    [
      'knowledge word length',
      (run: any) => {
        run.floors[0].knowledge.exploredWords = [];
      },
    ],
    [
      'knowledge padding',
      (run: any) => {
        run.floors[0].knowledge.exploredWords[0] = 0xffff_ffff;
      },
    ],
    [
      'knowledge disagreement',
      (run: any) => {
        run.floors[0].knowledge.rememberedTerrainWords[0] = 0xffff_ffff;
      },
    ],
    [
      'ambient color',
      (run: any) => {
        run.floors[0].ambient.color[0] = 256;
      },
    ],
    [
      'ambient strength',
      (run: any) => {
        run.floors[0].ambient.strength = -1;
      },
    ],
    [
      'invalid light identifier',
      (run: any) => {
        run.floors[0].lights[0].lightId = 'Bad';
      },
    ],
    [
      'duplicate light identifier',
      (run: any) => {
        run.floors[0].lights[1].lightId = 'light.a';
      },
    ],
    [
      'unordered light identifiers',
      (run: any) => {
        run.floors[0].lights.reverse();
      },
    ],
    [
      'malformed presentation',
      (run: any) => {
        run.floors[0].lights[0].presentation.glyph = '**';
      },
    ],
    [
      'missing vault ownership',
      (run: any) => {
        run.floors[0].lights[0].vaultPlacementId = 'placement.missing';
      },
    ],
    [
      'unresolved actor',
      (run: any) => {
        run.floors[0].lights[1].location.actorId = 'actor.missing';
      },
    ],
    [
      'fixed light on void',
      (run: any) => {
        run.floors[0].tiles[7] = 6;
      },
    ],
    [
      'fixed light out of bounds',
      (run: any) => {
        run.floors[0].lights[0].location.x = 99;
      },
    ],
    [
      'vault-owned light outside placement',
      (run: any) => {
        run.floors[0].lights[0].location.x = 3;
      },
    ],
    [
      'negative hero sight radius',
      (run: any) => {
        run.hero.sightRadius = -1;
      },
    ],
    [
      'unsafe hero sight radius',
      (run: any) => {
        run.hero.sightRadius = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'unsafe actor behavior number',
      (run: any) => {
        run.actors[0].behaviorState.counter = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'stair tile mismatch',
      (run: any) => {
        run.floors[0].stairUp = { x: 2, y: 1 };
      },
    ],
    [
      'duplicate stair positions',
      (run: any) => {
        run.floors[0].stairDown = { x: 1, y: 1 };
      },
    ],
    [
      'unreferenced stair-up tile',
      (run: any) => {
        run.floors[0].stairUp = null;
      },
    ],
    [
      'unreferenced stair-down tile',
      (run: any) => {
        run.floors[0].stairDown = null;
      },
    ],
    [
      'additional stair-up tile',
      (run: any) => {
        run.floors[0].tiles[8] = 4;
      },
    ],
    [
      'additional stair-down tile',
      (run: any) => {
        run.floors[0].tiles[16] = 5;
      },
    ],
    [
      'duplicate vault identifier',
      (run: any) => {
        run.floors[0].vaults.push({ ...run.floors[0].vaults[0] });
      },
    ],
    [
      'unordered vault identifiers',
      (run: any) => {
        run.floors[0].vaults.unshift({
          ...run.floors[0].vaults[0],
          placementId: 'placement.z',
          vaultId: 'vault.z',
          x: 3,
          y: 1,
          width: 1,
          height: 1,
          entrances: [],
        });
      },
    ],
    [
      'duplicate slot identifier',
      (run: any) => {
        run.floors[0].placementSlots.push({ ...run.floors[0].placementSlots[0] });
      },
    ],
    [
      'unordered slot identifiers',
      (run: any) => {
        run.floors[0].placementSlots.unshift({
          ...run.floors[0].placementSlots[0],
          slotId: 'slot.z',
        });
      },
    ],
    [
      'overlapping vaults',
      (run: any) => {
        run.floors[0].vaults.push({
          ...run.floors[0].vaults[0],
          placementId: 'placement.b',
          vaultId: 'vault.b',
        });
      },
    ],
    [
      'out-of-bounds vault',
      (run: any) => {
        run.floors[0].vaults[0].width = 9;
      },
    ],
    [
      'unowned slot',
      (run: any) => {
        run.floors[0].placementSlots[0].vaultPlacementId = 'placement.missing';
      },
    ],
  ])('rejects v5 corruption: %s', (_label, corrupt) => {
    const input = structuredClone(richRun()) as any;
    corrupt(input);
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('rejects sparse saved arrays and unordered entity identifiers', () => {
    const sparse = structuredClone(richRun()) as any;
    delete sparse.floors[0].tiles[1];
    expect(() => encodeActiveRun(sparse)).toThrow(SaveLoadError);

    const unordered = structuredClone(richRun()) as any;
    unordered.floors[0].entities = [
      { entityId: 'entity.z', x: 3, y: 1 },
      { entityId: 'entity.a', x: 3, y: 2 },
    ];
    expect(() => encodeActiveRun(unordered)).toThrow(SaveLoadError);
  });

  it.each(['visibilityWords', 'illumination', 'projection', 'generationReport'])(
    'rejects derived floor field %s',
    (field) => {
      const input = structuredClone(richRun()) as any;
      input.floors[0][field] = [];
      expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
    },
  );

  it('rejects colliding presented fixed fixtures', () => {
    const input = structuredClone(richRun()) as any;
    input.floors[0].lights.splice(1, 0, { ...input.floors[0].lights[0], lightId: 'light.aa' });
    expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
  });

  it('accepts a presented fixed fixture without vault ownership', () => {
    const input = structuredClone(richRun()) as any;
    input.floors[0].lights[0].vaultPlacementId = null;
    expect(() => encodeActiveRun(input)).not.toThrow();
  });

  it.each(['light', 'vault placement', 'slot'])(
    'rejects a duplicate %s identifier across floors',
    (kind) => {
      const input = structuredClone(richRun()) as any;
      const first = input.floors[0];
      const second = {
        ...structuredClone(first),
        floorId: 'floor.z',
        entities: [],
        lights: [],
        vaults: [],
        placementSlots: [],
      };
      if (kind === 'light') {
        second.vaults = [{ ...first.vaults[0], placementId: 'placement.z', vaultId: 'vault.z' }];
        second.lights = [{ ...first.lights[0], vaultPlacementId: 'placement.z' }];
      } else if (kind === 'vault placement') {
        second.vaults = [structuredClone(first.vaults[0])];
      } else {
        second.vaults = [{ ...first.vaults[0], placementId: 'placement.z', vaultId: 'vault.z' }];
        second.placementSlots = [{ ...first.placementSlots[0], vaultPlacementId: 'placement.z' }];
      }
      input.floors.push(second);
      expect(() => encodeActiveRun(input)).toThrow(SaveLoadError);
    },
  );

  it.each([
    ['contentHash', 'bad'],
    ['activeFloorId', 'floor.missing'],
    ['actors.0.x', 99],
    ['floors.0.tiles', [1]],
    ['floors.0.tiles.8', 9],
    ['rng.combat', [0, 0, 0, 0]],
  ] as const)('rejects corrupt %s with a safe path', (path, replacement) => {
    const input = structuredClone(createDemoRun()) as Record<string, unknown>;
    const segments = path.split('.');
    let target: Record<string, unknown> | unknown[] = input;
    for (const segment of segments.slice(0, -1))
      target = target[Number.isNaN(Number(segment)) ? segment : Number(segment)] as typeof target;
    target[Number.isNaN(Number(segments.at(-1))) ? segments.at(-1)! : Number(segments.at(-1))] =
      replacement;
    expect(() => decodeActiveRun(JSON.stringify(input))).toThrow(SaveLoadError);
    try {
      decodeActiveRun(JSON.stringify(input));
    } catch (error) {
      expect((error as SaveLoadError).path).toContain(path.split('.')[0]);
      expect((error as Error).message).not.toContain(JSON.stringify(input));
    }
  });

  it('rejects malformed JSON and unknown object keys', () => {
    expect(() => decodeActiveRun('{')).toThrow(/JSON/);
    expect(() => decodeActiveRun(JSON.stringify({ ...createDemoRun(), surprise: true }))).toThrow(
      /surprise/,
    );
  });

  it.each([0, 1, 2, 3, 10])(
    'rejects unsupported schema version %i without partial state',
    (schemaVersion) => {
      try {
        decodeActiveRun(JSON.stringify({ schemaVersion }));
        expect.fail('expected unsupported version');
      } catch (error) {
        expect(error).toMatchObject({ kind: 'unsupported_version', path: 'schemaVersion' });
      }
    },
  );

  it('rejects duplicate floor, entity, and recent-command identifiers', () => {
    const state = createDemoRun();
    expect(() =>
      encodeActiveRun({ ...state, floors: [...state.floors, state.floors[0]!] }),
    ).toThrow(/floorId/);
    const floor = state.floors[0]!;
    const entity = { entityId: 'entity.1', x: 2, y: 1 };
    expect(() =>
      encodeActiveRun({ ...state, floors: [{ ...floor, entities: [entity, entity] }] }),
    ).toThrow(/entityId/);
    const processed = resolveCommand(state, {
      type: 'wait',
      commandId: 'command.saved',
      expectedRevision: 0,
    }).state;
    const record = processed.recentCommands[0]!;
    expect(() => encodeActiveRun({ ...processed, recentCommands: [record, record] })).toThrow(
      /command identifier/,
    );
  });

  it('rejects remaining semantic and numeric corruption boundaries', () => {
    const state = createDemoRun();
    expect(() =>
      encodeActiveRun({ ...state, actors: [{ ...state.actors[0]!, x: 0, y: 0 }] }),
    ).toThrow(/walkable/);
    expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'e\u0301' } })).toThrow(
      /hero.name|Invalid save/,
    );
    expect(() => encodeActiveRun({ ...state, hero: { ...state.hero, name: 'Ada\u0000' } })).toThrow(
      /hero.name|Invalid save/,
    );
    expect(() =>
      encodeActiveRun({ ...state, rng: { ...state.rng, combat: [0x1_0000_0000, 1, 2, 3] } }),
    ).toThrow(/rng.combat/);

    const first = resolveCommand(state, {
      type: 'wait',
      commandId: 'command.first',
      expectedRevision: 0,
    }).state;
    const second = resolveCommand(first, {
      type: 'wait',
      commandId: 'command.second',
      expectedRevision: 1,
    }).state;
    const [firstRecord, secondRecord] = second.recentCommands;
    expect(() =>
      encodeActiveRun({ ...second, recentCommands: [secondRecord!, firstRecord!] }),
    ).toThrow(/monotonic/);
    expect(() =>
      encodeActiveRun({
        ...first,
        recentCommands: [
          {
            ...first.recentCommands[0]!,
            result: { ...first.recentCommands[0]!.result, commandId: 'command.different' },
          },
        ],
      }),
    ).toThrow(/result does not match command/);
  });

  it('rejects floor snapshots that are not strictly ordered by floor identifier', () => {
    const state = createDemoRun();
    const floor = state.floors[0]!;
    expectInvalidSave(
      {
        ...state,
        floors: [
          { ...floor, floorId: 'floor.z' },
          { ...floor, floorId: 'floor.a' },
        ],
        activeFloorId: 'floor.z',
        actors: [{ ...state.actors[0]!, floorId: 'floor.z' }],
      },
      'floors.1.floorId',
    );
  });

  it('rejects a large expected-revision gap between adjacent recent records', () => {
    const invalid = resolveCommand(createDemoRun(), {
      type: 'move',
      commandId: 'command.wall',
      expectedRevision: 0,
      direction: 'north',
    }).state;
    const moved = resolveCommand(invalid, {
      type: 'move',
      commandId: 'command.move',
      expectedRevision: 0,
      direction: 'east',
    }).state;
    const second = moved.recentCommands[1]!;
    expectInvalidSave(
      {
        ...moved,
        revision: 101,
        turn: 101,
        recentCommands: [
          moved.recentCommands[0]!,
          {
            ...second,
            command: { ...second.command, expectedRevision: 100 },
            result: { ...second.result, revision: 101, turn: 101 },
          },
        ],
      },
      'recentCommands.1.command.expectedRevision',
    );
  });

  it('rejects move coordinates that disagree with the command direction', () => {
    const moved = resolveCommand(createDemoRun(), {
      type: 'move',
      commandId: 'command.move',
      expectedRevision: 0,
      direction: 'east',
    }).state;
    const record = moved.recentCommands[0]!;
    expectInvalidSave(
      {
        ...moved,
        actors: [{ ...moved.actors[0]!, x: 1, y: 2 }],
        recentCommands: [
          {
            ...record,
            events: [{ ...record.events[0]!, from: { x: 1, y: 1 }, to: { x: 1, y: 2 } }],
          },
        ],
      },
      'recentCommands.0.events.0.to',
    );
  });

  it('rejects a move event that teleports more than one cell', () => {
    const moved = resolveCommand(createDemoRun(), {
      type: 'move',
      commandId: 'command.move',
      expectedRevision: 0,
      direction: 'east',
    }).state;
    const record = moved.recentCommands[0]!;
    expectInvalidSave(
      {
        ...moved,
        actors: [{ ...moved.actors[0]!, x: 3, y: 1 }],
        recentCommands: [{ ...record, events: [{ ...record.events[0]!, to: { x: 3, y: 1 } }] }],
      },
      'recentCommands.0.events.0.to',
    );
  });

  it('rejects a broken position chain between adjacent processed commands', () => {
    const first = resolveCommand(createDemoRun(), {
      type: 'move',
      commandId: 'command.first',
      expectedRevision: 0,
      direction: 'east',
    }).state;
    const second = resolveCommand(first, {
      type: 'move',
      commandId: 'command.second',
      expectedRevision: 1,
      direction: 'east',
    }).state;
    const finalRecord = second.recentCommands[1]!;
    expectInvalidSave(
      {
        ...second,
        actors: [{ ...second.actors[0]!, x: 2 }],
        recentCommands: [
          second.recentCommands[0]!,
          {
            ...finalRecord,
            events: [{ ...finalRecord.events[0]!, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }],
          },
        ],
      },
      'recentCommands.0.events.0.to',
    );
  });

  it('rejects retained history that does not terminate at the current counters or hero', () => {
    const waited = resolveCommand(createDemoRun(), {
      type: 'wait',
      commandId: 'command.wait',
      expectedRevision: 0,
    }).state;
    expectInvalidSave({ ...waited, revision: 2, turn: 2 }, 'recentCommands.0.result.revision');
    expectInvalidSave(
      { ...waited, actors: [{ ...waited.actors[0]!, x: 2 }] },
      'recentCommands.0.events.0',
    );
  });

  it('rejects an invalid wait record with a terrain-only reason', () => {
    const invalid = resolveCommand(createDemoRun(), {
      type: 'move',
      commandId: 'command.wall',
      expectedRevision: 0,
      direction: 'north',
    }).state;
    const record = invalid.recentCommands[0]!;
    expectInvalidSave(
      {
        ...invalid,
        recentCommands: [
          {
            ...record,
            command: { type: 'wait', commandId: record.command.commandId, expectedRevision: 0 },
          },
        ],
      },
      'recentCommands.0.result.reason',
    );
  });

  it.each([
    [0, 'blocked.wall'],
    [2, 'blocked.door'],
    [3, 'blocked.pillar'],
    [6, 'blocked.void'],
  ] as const)('validates retained terrain %i as %s', (tile, reason) => {
    const demo = createDemoRun();
    const floor = demo.floors[0]!;
    const initial = {
      ...demo,
      floors: [
        {
          ...floor,
          tiles: floor.tiles.map((current, index) => (index === 1 ? tile : current)),
        },
      ],
    };
    const invalid = resolveCommand(initial, {
      type: 'move',
      commandId: `command.${reason}`,
      expectedRevision: 0,
      direction: 'north',
    }).state;
    const record = invalid.recentCommands[0]!;

    expect(record.result).toMatchObject({ status: 'invalid', reason });
    expect(() => encodeActiveRun(invalid)).not.toThrow();
    expectInvalidSave(
      {
        ...invalid,
        recentCommands: [
          {
            ...record,
            result: { ...record.result, reason: 'blocked.bounds' },
            events: [{ ...record.events[0]!, reason: 'blocked.bounds' }],
          },
        ],
      },
      'recentCommands.0.result.reason',
    );
  });

  it('accepts a reachable retained suffix after older records are evicted', () => {
    let state = createDemoRun();
    for (let index = 0; index < 129; index += 1) {
      state = resolveCommand(state, {
        type: 'wait',
        commandId: `command.${index}`,
        expectedRevision: index,
      }).state;
    }
    expect(state.recentCommands[0]?.command.expectedRevision).toBe(1);
    expect(() => encodeActiveRun(state)).not.toThrow();
  });
});
