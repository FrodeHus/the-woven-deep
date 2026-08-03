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
  RNG_STREAM_NAMES,
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

  // Pre-floor-loot saves carry no `rng['loot-placement']` stream; drop it so a legacy fixture and
  // the reciprocal strip both round-trip against the frozen ten-stream legacy rng shape.
  const stripLootPlacementStream = (run: Record<string, unknown>): Record<string, unknown> => {
    const { 'loot-placement': _lootPlacement, ...rng } = run.rng as Record<string, unknown>;
    return { ...run, rng };
  };

  // Pre-artifact saves (v4-v12) carry neither `offeredArtifact` nor `artifactsUndiscovered`; drop
  // them so every legacy fixture and its reciprocal strip round-trip against the frozen legacy run
  // shapes.
  const stripArtifactFields = (run: Record<string, unknown>): Record<string, unknown> => {
    const {
      offeredArtifact: _offeredArtifact,
      artifactsUndiscovered: _artifactsUndiscovered,
      ...rest
    } = run;
    return rest;
  };

  // Pre-run-mode saves (v4-v14) carry no `mode`; drop it so every legacy fixture and its reciprocal
  // strip both round-trip against the frozen legacy run shapes.
  const stripModeField = (run: Record<string, unknown>): Record<string, unknown> => {
    const { mode: _mode, ...rest } = run;
    return rest;
  };

  // Pre-tempering saves (v4-v16) carry no `hero.tempering` and no `rng.enchanting`; drop both so
  // every legacy fixture and its reciprocal strip both round-trip against the frozen legacy shapes.
  const stripTemperingField = (run: Record<string, unknown>): Record<string, unknown> => {
    const hero = run.hero as Record<string, unknown>;
    const { tempering: _tempering, ...heroRest } = hero;
    const rng = run.rng as Record<string, unknown>;
    const { enchanting: _enchanting, ...rngRest } = rng;
    return { ...run, hero: heroRest, rng: rngRest };
  };

  function v4Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
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
    return stripLootPlacementStream(
      stripActorWeave({ ...withoutRunFields, schemaVersion: 4, hero, rng }),
    );
  }

  function stripToV4Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
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
    return stripLootPlacementStream(
      stripActorWeave({ ...withoutRunFields, schemaVersion: 4, hero, rng }),
    );
  }

  function v5Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    const {
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV6Fields
    } = current;
    const { 'run-records': _runRecords, ...rng } = withoutV6Fields.rng;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = withoutV6Fields.hero;
    return stripLootPlacementStream(
      stripActorWeave({ ...withoutV6Fields, schemaVersion: 5, hero, rng }),
    );
  }

  function stripV6Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    const {
      metrics: _metrics,
      conclusion: _conclusion,
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV6Fields
    } = current;
    const { 'run-records': _runRecords, ...rng } = withoutV6Fields.rng;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = withoutV6Fields.hero;
    return stripLootPlacementStream(
      stripActorWeave({ ...withoutV6Fields, schemaVersion: 5, hero, rng }),
    );
  }

  function v6Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = current.hero;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...withoutV8Fields, schemaVersion: 6, hero })),
    );
  }

  function stripV7Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    const { classTags: _classTags, statModifiers: _statModifiers, ...hero } = current.hero;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...withoutV8Fields, schemaVersion: 6, hero })),
    );
  }

  function v7Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...withoutV8Fields, schemaVersion: 7 })),
    );
  }

  function stripV8Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    const {
      house: _house,
      restockedMilestones: _restockedMilestones,
      ...withoutV8Fields
    } = current;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...withoutV8Fields, schemaVersion: 7 })),
    );
  }

  function v8Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...current, schemaVersion: 8 })),
    );
  }

  function stripV9Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    return stripLootPlacementStream(
      stripDefeatedBossMonsterIds(stripActorWeave({ ...current, schemaVersion: 8 })),
    );
  }

  // Pre-boss-tracking saves carry no `metrics.defeatedBossMonsterIds`; drop it so a legacy fixture
  // and the reciprocal strip both round-trip against the frozen legacy metrics shape.
  const stripDefeatedBossMonsterIds = (run: Record<string, unknown>): Record<string, unknown> => {
    const { defeatedBossMonsterIds: _defeatedBossMonsterIds, ...metrics } = run.metrics as Record<
      string,
      unknown
    >;
    return { ...run, metrics };
  };

  function v9Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    return stripLootPlacementStream(stripDefeatedBossMonsterIds({ ...current, schemaVersion: 9 }));
  }

  function stripV10Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    return stripLootPlacementStream(stripDefeatedBossMonsterIds({ ...current, schemaVersion: 9 }));
  }

  // v10 saves are structurally identical to the current shape (achievement.granted events can
  // never legitimately be retained in recentCommands, see the "cannot be retained" invariant
  // below), so the only difference is the schemaVersion literal.
  function v10Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    return stripLootPlacementStream({ ...current, schemaVersion: 10 });
  }

  function stripV11Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    return stripLootPlacementStream({ ...current, schemaVersion: 10 });
  }

  // v11 saves are structurally identical to the current shape apart from the loot-placement RNG
  // stream, which floor loot placement introduced at v12.
  function v11Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    return stripLootPlacementStream({ ...current, schemaVersion: 11 });
  }

  function stripV12Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    return stripLootPlacementStream({ ...current, schemaVersion: 11 });
  }

  // v12 saves are structurally identical to the current shape apart from the two artifact run
  // fields, which the artifact offer introduced at v13.
  function v12Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(createDemoRun())) as any),
    ) as any;
    return { ...current, schemaVersion: 12 };
  }

  function stripV13Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(
      stripArtifactFields(stripTemperingField(structuredClone(run)) as any),
    ) as any;
    return { ...current, schemaVersion: 12 };
  }

  // v13 saves are structurally identical to the current shape apart from `curse` on items and
  // recorded heirlooms (introduced at v14) and `mode` (introduced at v15).
  function v13Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripTemperingField(structuredClone(createDemoRun())) as any,
    ) as any;
    return { ...current, schemaVersion: 13 };
  }

  // Strips everything the cursed-item feature introduced at v14: `curse` on items (optional, so
  // simply omitted) and `curse` on every recorded heirloom snapshot (required, so removed rather
  // than merely nulled — a genuine v13 save never had the key). Also strips `mode`, which the
  // run-mode feature introduced at v15.
  function stripV14Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(stripTemperingField(structuredClone(run)) as any) as any;
    return {
      ...current,
      schemaVersion: 13,
      items: current.items.map((item: Record<string, unknown>) => {
        const { curse: _curse, ...rest } = item;
        return rest;
      }),
      fallenHeroStandings: current.fallenHeroStandings.map((standing: any) => {
        const { curse: _curse, ...heirloomRest } = standing.heirloom;
        return { ...standing, heirloom: heirloomRest };
      }),
    };
  }

  // v14 saves are structurally identical to the current shape apart from `mode`, which the
  // run-mode feature introduced at v15.
  function v14Fixture(): Record<string, unknown> {
    const current = stripModeField(
      stripTemperingField(structuredClone(createDemoRun())) as any,
    ) as any;
    return { ...current, schemaVersion: 14 };
  }

  // Strips everything the run-mode feature introduced at v15: `mode`.
  function stripV15Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripModeField(stripTemperingField(structuredClone(run)) as any) as any;
    return { ...current, schemaVersion: 14 };
  }

  // v15 saves are structurally identical to the current shape apart from `cause`/`deathInventory`
  // on every standing and `appeased` on every decision (introduced at v16), and `hero.tempering`/
  // `rng.enchanting` (introduced at v17).
  function v15Fixture(): Record<string, unknown> {
    const current = stripTemperingField(structuredClone(createDemoRun())) as any;
    return { ...current, schemaVersion: 15 };
  }

  // Strips everything the haunts feature introduced at v16: `cause`/`deathInventory` on every
  // standing and `appeased` on every decision. `hero.tempering`/`rng.enchanting` are already gone
  // (stripped before this function's own additions), since those arrived a version later, at v17.
  function stripV16Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripTemperingField(structuredClone(run)) as any;
    return {
      ...current,
      schemaVersion: 15,
      fallenHeroStandings: current.fallenHeroStandings.map((standing: any) => {
        const { cause: _cause, deathInventory: _deathInventory, ...rest } = standing;
        return rest;
      }),
      fallenHeroDecisions: current.fallenHeroDecisions.map((decision: any) => {
        const { appeased: _appeased, ...rest } = decision;
        return rest;
      }),
    };
  }

  // v16 saves are structurally identical to the current shape apart from `hero.tempering` and the
  // `rng.enchanting` stream, which the hero-power-curve feature introduced at v17.
  function v16Fixture(): Record<string, unknown> {
    const current = stripTemperingField(structuredClone(createDemoRun())) as any;
    return { ...current, schemaVersion: 16 };
  }

  // Strips everything the hero-power-curve feature introduced at v17: `hero.tempering` and the
  // `rng.enchanting` stream.
  function stripV17Fields(run: ReturnType<typeof createDemoRun>): Record<string, unknown> {
    const current = stripTemperingField(structuredClone(run)) as any;
    return { ...current, schemaVersion: 16 };
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

  // A content-bound run (real compiled pack, real item/curse content ids) for the curse save
  // codec tests, which need to round-trip against `compiledContent` rather than the lightweight
  // demo pack.
  function baseRun(): any {
    return structuredClone(createGameplayDemoRun(compiledContent).run) as any;
  }

  function withCursedItem(run: any, curse: Readonly<{ curseId: string; revealed: boolean }>): any {
    const [first, ...rest] = run.items;
    return { ...run, items: [{ ...first, curse: { ...curse } }, ...rest] };
  }

  function heirloomFixture(): Record<string, unknown> {
    return {
      contentId: 'item.iron-sword',
      sourceItemId: 'item.recorded.heirloom',
      enchantment: null,
      condition: 90,
      charges: null,
      fuel: null,
      curse: null,
      qualityRank: 0,
      displayName: 'Old Iron Sword',
      glyph: ')',
      color: '#c0c0c0',
      originatingHallRecordId: 'hall.heirloom',
    };
  }

  // A recorded-heirloom snapshot as a genuine pre-curse save would have stored it: no `curse` key
  // at all (the field did not exist before v14), not merely `curse: null`.
  function preCurseHeirloomFixture(): Record<string, unknown> {
    const { curse: _curse, ...rest } = heirloomFixture();
    return rest;
  }

  // A second equipped-item snapshot distinct from the heirloom, for `deathInventory` fixtures that
  // need more than one member.
  function secondEquippedFixture(): Record<string, unknown> {
    return {
      contentId: 'item.leather-cap',
      sourceItemId: 'item.recorded.second-equipped',
      enchantment: null,
      condition: 75,
      charges: null,
      fuel: null,
      curse: null,
      qualityRank: 0,
      displayName: 'Worn Leather Cap',
      glyph: '[',
      color: '#8a6d3b',
      originatingHallRecordId: 'hall.heirloom',
    };
  }

  // `legacy: true` produces a standing/decision with no `cause`/`deathInventory`/`appeased` key at
  // all (the fields did not exist before v16) -- what a genuine pre-haunt save actually stored.
  // Default (`legacy` omitted) produces the live shape, valid against the current `activeRunSchema`.
  function withRecordedHeirloom(
    run: any,
    heirloom: Record<string, unknown>,
    options: Readonly<{ legacy?: boolean }> = {},
  ): any {
    const heroActor = run.actors.find((actor: any) => actor.actorId === run.hero.actorId);
    const standing: Record<string, unknown> = {
      rank: 1,
      hallRecordId: heirloom.originatingHallRecordId,
      heroName: 'Test Hero',
      portraitGlyph: '@',
      classTags: ['fighter'],
      attributes: heroActor.attributes,
      equippedItemContentIds: [heirloom.contentId],
      signatureAbilityIds: [],
      deathDepth: 1,
      sourceContentHash: run.contentHash,
      heirloom,
    };
    const decision: Record<string, unknown> = {
      hallRecordId: standing.hallRecordId,
      rank: 1,
      role: 'champion' as const,
      gateRoll: null,
      retained: true,
      encountered: false,
      defeated: false,
    };
    if (!options.legacy) {
      standing.cause = null;
      standing.deathInventory = [heirloom];
      decision.appeased = false;
    }
    return { ...run, fallenHeroStandings: [standing], fallenHeroDecisions: [decision] };
  }

  // Builds a live-shape (v16) haunt standing, then overrides `cause`/`deathInventory` to the given
  // values -- unlike `withRecordedHeirloom`'s own defaults (`cause: null`, `deathInventory: [heirloom]`),
  // which model a legacy standing migrated forward, not a fresh haunt capture.
  function withHauntStanding(
    run: any,
    overrides: Readonly<{
      cause: Record<string, unknown> | null;
      deathInventory: readonly Record<string, unknown>[];
    }>,
  ): any {
    const heirloom = overrides.deathInventory[0]!;
    const withStanding = withRecordedHeirloom(run, heirloom);
    const standing = { ...withStanding.fallenHeroStandings[0], ...overrides };
    return { ...withStanding, fallenHeroStandings: [standing] };
  }

  // Builds a live-shape decision whose haunt was appeased rather than defeated.
  function withAppeasedDecision(run: any): any {
    const withStanding = withRecordedHeirloom(run, heirloomFixture());
    const decision = { ...withStanding.fallenHeroDecisions[0], appeased: true, defeated: false };
    return { ...withStanding, fallenHeroDecisions: [decision] };
  }

  // A genuine pre-haunt blob at the given legacy schema version, carrying an actual standing/decision
  // (no `cause`/`deathInventory`/`appeased` key anywhere) -- proves the migration chain actually
  // defaults these fields, rather than vacuously passing over an empty `fallenHeroStandings` array.
  function legacyFixtureAtVersion(
    version: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16,
  ): Record<string, unknown> {
    const builders: Record<number, () => Record<string, unknown>> = {
      4: v4Fixture,
      5: v5Fixture,
      6: v6Fixture,
      7: v7Fixture,
      8: v8Fixture,
      9: v9Fixture,
      10: v10Fixture,
      11: v11Fixture,
      12: v12Fixture,
      13: v13Fixture,
      14: v14Fixture,
      15: v15Fixture,
      16: v16Fixture,
    };
    const base = builders[version]!();
    // Curse (`ItemInstance.curse`/`RecordedHeirloomSnapshot.curse`) landed at v14: earlier versions
    // never had the key at all.
    const heirloom = version >= 14 ? heirloomFixture() : preCurseHeirloomFixture();
    // Haunts (`cause`/`deathInventory`/`appeased`) landed at v16: a genuine v16 fixture already has
    // them, so only versions below that need the legacy (fields-absent) standing/decision shape.
    return withRecordedHeirloom(base, heirloom, { legacy: version < 16 });
  }

  // A JSON-safe pre-haunt (v15) run fixture carrying a genuine standing -- the seed for the
  // "migrates a v15 standing" test, which forces its `schemaVersion` down to 15 (already its value)
  // to mirror the brief's exact test shape.
  function encodedFixtureWithStandings(): Record<string, unknown> {
    return legacyFixtureAtVersion(15);
  }

  // A JSON-safe live (v17) run fixture, the seed for the "migrates a v16 save" test, which forces
  // its `schemaVersion` down to 16 and deletes the tempering-era fields itself to mirror the
  // brief's exact test shape.
  function encodedFixture(): Record<string, unknown> {
    return JSON.parse(encodeActiveRun(baseRun())) as Record<string, unknown>;
  }

  function zeroSpent(): Readonly<Record<string, number>> {
    return { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 };
  }

  function withTempering(
    run: any,
    tempering: Readonly<{ banked: number; spent: Readonly<Record<string, number>> }>,
  ): any {
    return { ...run, hero: { ...run.hero, tempering } };
  }

  // Overrides the hero actor's attributes on top of `baseRun`'s own, for tests that need a specific
  // attribute value to exercise the `attributes = base + spent` tempering invariant.
  function baseRunWithAttributes(overrides: Readonly<Record<string, number>>): any {
    const run = baseRun();
    const actors = run.actors.map((actor: any) =>
      actor.actorId === run.hero.actorId
        ? { ...actor, attributes: { ...actor.attributes, ...overrides } }
        : actor,
    );
    return { ...run, actors };
  }

  function recordedHeirloomOf(run: any): Record<string, unknown> {
    return run.fallenHeroStandings[0].heirloom;
  }

  it('migrates strict schema v4 state through v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, and v17 and preserves every former field', () => {
    const legacy = v4Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
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

  it('migrates strict schema v5 state through v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, and v17 and preserves every former field', () => {
    const legacy = v5Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
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

  it('migrates strict schema v6 state through v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, and v17 and preserves every former field', () => {
    const legacy = v6Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.hero.classTags).toEqual([]);
    expect(decoded.hero.statModifiers).toEqual({});
    expect(decoded.house).toEqual({ capacity: 6, upgradesPurchased: 0 });
    expect(decoded.restockedMilestones).toEqual([]);
    expect(stripV7Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v7 state to v17 and preserves every former field', () => {
    const legacy = v7Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
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

  it('migrates strict schema v8 state to v17 and preserves every former field', () => {
    const legacy = v8Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    // A pre-Weave hero migrates to full Weave: maxWeave is base 4 + Wits, and weave starts full.
    const migratedHero = decoded.actors.find((actor) => actor.actorId === decoded.hero.actorId)!;
    expect(migratedHero.maxWeave).toBe(4 + migratedHero.attributes.wits);
    expect(migratedHero.weave).toBe(migratedHero.maxWeave);
    for (const actor of decoded.actors) {
      if (!actor.playerControlled) {
        expect(actor.weave).toBe(0);
        expect(actor.maxWeave).toBe(0);
      }
    }
    expect(stripV9Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v9 state to v17 and preserves every former field', () => {
    const legacy = v9Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.metrics.defeatedBossMonsterIds).toEqual([]);
    expect(stripV10Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v10 state to v17 and preserves every former field', () => {
    const legacy = v10Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(stripV11Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v11 state to v17 and preserves every former field', () => {
    const legacy = v11Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.rng['loot-placement']).toEqual(
      deriveRngStreams(legacy.runSeed as any)['loot-placement'],
    );
    expect(stripV12Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v12 state to v17 and preserves every former field', () => {
    const legacy = v12Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.offeredArtifact).toBeNull();
    expect(decoded.artifactsUndiscovered).toEqual([]);
    expect(stripV13Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v13 state to v17 and preserves every former field', () => {
    const legacy = v13Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(stripV14Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v14 state to v17 and preserves every former field', () => {
    const legacy = v14Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(stripV15Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v15 state to v17 and preserves every former field', () => {
    const legacy = v15Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(stripV16Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates strict schema v16 state to v17 and preserves every former field', () => {
    const legacy = v16Fixture();
    const decoded = decodeActiveRun(JSON.stringify(legacy));

    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.hero.tempering).toEqual({
      banked: 0,
      spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
    });
    expect(decoded.rng.enchanting).toEqual(deriveRngStreams(decoded.runSeed).enchanting);
    expect(stripV17Fields(decoded)).toEqual(legacy);
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
  });

  it('migrates a v16 save to zeroed tempering and a seed-derived enchanting stream', () => {
    const v16 = { ...structuredClone(encodedFixture()), schemaVersion: 16 } as Record<
      string,
      unknown
    >;
    delete (v16.hero as Record<string, unknown>).tempering;
    delete (v16.rng as Record<string, unknown>).enchanting;
    const decoded = decodeActiveRun(JSON.stringify(v16), compiledContent);
    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.hero.tempering).toEqual({
      banked: 0,
      spent: { might: 0, agility: 0, vitality: 0, wits: 0, resolve: 0 },
    });
    expect(decoded.rng.enchanting).toEqual(deriveRngStreams(decoded.runSeed).enchanting);
  });

  it('defaults tempering and the enchanting stream for every legacy entry version', () => {
    for (const version of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const) {
      const decoded = decodeActiveRun(
        JSON.stringify(legacyFixtureAtVersion(version)),
        compiledContent,
      );
      expect(decoded.schemaVersion).toBe(17);
      expect(decoded.hero.tempering.banked).toBe(0);
      expect(decoded.rng.enchanting).toEqual(deriveRngStreams(decoded.runSeed).enchanting);
    }
  });

  it('leaves every pre-existing stream state untouched by the migration', () => {
    const v16 = legacyFixtureAtVersion(16);
    const decoded = decodeActiveRun(JSON.stringify(v16), compiledContent);
    const v16Rng = v16.rng as Record<string, unknown>;
    for (const stream of Object.keys(v16Rng)) {
      expect((decoded.rng as unknown as Record<string, unknown>)[stream]).toEqual(v16Rng[stream]);
    }
  });

  it('round-trips a tempered hero byte-identically', () => {
    const run = withTempering(baseRun(), {
      banked: 2,
      spent: { might: 1, agility: 0, vitality: 3, wits: 0, resolve: 0 },
    });
    const encoded = encodeActiveRun(run);
    expect(encodeActiveRun(decodeActiveRun(encoded, compiledContent))).toBe(encoded);
  });

  it('rejects spent points the attributes cannot account for', () => {
    const run = withTempering(baseRunWithAttributes({ vitality: 2 }), {
      banked: 0,
      spent: { might: 0, agility: 0, vitality: 5, wits: 0, resolve: 0 },
    });
    expect(() => decodeActiveRun(encodeActiveRun(run), compiledContent)).toThrow(/tempering/);
  });

  it('rejects a negative banked count', () => {
    const run = withTempering(baseRun(), { banked: -1, spent: zeroSpent() });
    expect(() => decodeActiveRun(encodeActiveRun(run), compiledContent)).toThrow(/banked/);
  });

  it('migrates a v15 standing to a cause-less single-item death inventory', () => {
    const v15 = { ...structuredClone(encodedFixtureWithStandings()), schemaVersion: 15 };
    const decoded = decodeActiveRun(JSON.stringify(v15), compiledContent);
    expect(decoded.schemaVersion).toBe(17);
    for (const standing of decoded.fallenHeroStandings) {
      expect(standing.cause).toBeNull();
      expect(standing.deathInventory).toEqual([standing.heirloom]);
    }
    for (const decision of decoded.fallenHeroDecisions) {
      expect(decision.appeased).toBe(false);
    }
  });

  /**
   * A genuine pre-haunt (v15) blob carrying a haunt that was already PUT DOWN before the death
   * inventory drop existed: a champion whose single reward is `item.heirloom.${populationId}`, and
   * an echo that surrendered no piece at all (it only ever dropped spoils). Both are states the
   * v16 rules would otherwise reject outright, bricking the save.
   */
  function v15WithDefeatedHaunts(): Record<string, unknown> {
    const base: any = stripTemperingField(structuredClone(createDemoRun()));
    const hero = base.actors[0];
    const championPopulationId = 'population.fallen-champion.hall-a';
    const echoPopulationId = 'population.fallen-echo-2.hall-b';
    const championActorId = 'actor.fallen-champion.001';
    const echoActorId = 'actor.fallen-echo.001';
    const corpse = (actorId: string, populationId: string, x: number) => ({
      ...structuredClone(hero),
      actorId,
      contentId: 'monster.champion-fallback',
      playerControlled: false,
      x,
      y: 1,
      health: 0,
      disposition: 'hostile',
      populationId,
      populationPresentation: { name: 'Fallen', glyph: '@', color: '#ffffff', leader: false },
    });
    const snapshot = (recordId: string, contentId: string) => ({
      contentId,
      sourceItemId: `item.recorded.${recordId}`,
      enchantment: null,
      condition: 90,
      charges: null,
      fuel: null,
      curse: null,
      qualityRank: 0,
      displayName: 'Old Iron Sword',
      glyph: ')',
      color: '#c0c0c0',
      originatingHallRecordId: recordId,
    });
    const championHeirloom = snapshot('hall.a', 'item.iron-sword');
    const echoHeirloom = snapshot('hall.b', 'item.iron-sword');
    return {
      ...base,
      schemaVersion: 15,
      actors: [
        hero,
        corpse(championActorId, championPopulationId, 2),
        corpse(echoActorId, echoPopulationId, 3),
      ].sort((left: any, right: any) => (left.actorId < right.actorId ? -1 : 1)),
      items: [
        // Sorts BETWEEN the renamed piece's `item.haunt.` prefix and the legacy `item.heirloom.`
        // reward id, so the migration's re-sort is load-bearing: renaming the reward moves it from
        // after this item to before it, and skipping the sort would leave the item list out of the
        // strictly ascending order the save schema requires.
        {
          itemId: 'item.hauntling-charm',
          contentId: 'item.iron-sword',
          quantity: 1,
          condition: 100,
          enchantment: null,
          identified: true,
          charges: null,
          fuel: null,
          enabled: null,
          location: { type: 'floor', floorId: hero.floorId, x: 4, y: 1 },
        },
        {
          itemId: `item.heirloom.${championPopulationId}`,
          contentId: 'item.iron-sword',
          quantity: 1,
          condition: 90,
          enchantment: null,
          identified: true,
          charges: null,
          fuel: null,
          enabled: null,
          location: { type: 'floor', floorId: hero.floorId, x: 2, y: 1 },
          heirloom: {
            displayName: 'Old Iron Sword',
            glyph: ')',
            color: '#c0c0c0',
            originatingHallRecordId: 'hall.a',
            originatingRank: 1,
            sourceItemId: championHeirloom.sourceItemId,
          },
        },
      ],
      populations: [
        {
          populationId: championPopulationId,
          encounterId: 'fallen-champion-template.core',
          floorId: hero.floorId,
          createdAt: 0,
          model: 'champion',
          livingMemberIds: [],
          formerMemberIds: [championActorId],
          actorId: championActorId,
          hallRecordId: 'hall.a',
          rank: 1,
          defeated: true,
          rewardCreated: true,
          equipmentContentIds: [],
          abilityIds: [],
        },
        {
          populationId: echoPopulationId,
          encounterId: 'fallen-champion-template.core',
          floorId: hero.floorId,
          createdAt: 0,
          model: 'echo',
          livingMemberIds: [],
          formerMemberIds: [echoActorId],
          actorId: echoActorId,
          hallRecordId: 'hall.b',
          rank: 2,
          defeated: true,
          lootCreated: true,
          equipmentContentIds: [],
          abilityIds: [],
        },
      ].sort((left: any, right: any) => (left.populationId < right.populationId ? -1 : 1)),
      fallenHeroStandings: [
        {
          rank: 1,
          hallRecordId: 'hall.a',
          heroName: 'Kaelen',
          portraitGlyph: '@',
          classTags: ['fighter'],
          attributes: hero.attributes,
          equippedItemContentIds: ['item.iron-sword'],
          signatureAbilityIds: [],
          deathDepth: 4,
          sourceContentHash: base.contentHash,
          heirloom: championHeirloom,
        },
        {
          rank: 2,
          hallRecordId: 'hall.b',
          heroName: 'Mira',
          portraitGlyph: '@',
          classTags: ['scout'],
          attributes: hero.attributes,
          equippedItemContentIds: ['item.iron-sword'],
          signatureAbilityIds: [],
          deathDepth: 3,
          sourceContentHash: base.contentHash,
          heirloom: echoHeirloom,
        },
      ],
      fallenHeroDecisions: [
        {
          hallRecordId: 'hall.a',
          rank: 1,
          role: 'champion',
          gateRoll: null,
          retained: true,
          encountered: true,
          defeated: true,
        },
        {
          hallRecordId: 'hall.b',
          rank: 2,
          role: 'echo',
          gateRoll: 1,
          retained: true,
          encountered: true,
          defeated: true,
        },
      ],
    };
  }

  it('migrates a v15 save whose champion was already defeated, renaming its reward to a death-inventory piece', () => {
    // Decoded WITH the demo pack the fixture's contentHash names, so this covers the content-bound
    // validation tier end to end, not only the schema tier.
    const decoded = decodeActiveRun(JSON.stringify(v15WithDefeatedHaunts()), context.content);
    expect(decoded.schemaVersion).toBe(17);
    const champion = decoded.populations.find(
      (population) => population.model === 'champion',
    ) as Extract<(typeof decoded.populations)[number], { model: 'champion' }>;
    const pieceId = `item.haunt.${champion.populationId}.0000`;
    expect(decoded.items.map((item) => item.itemId)).toContain(pieceId);
    expect(decoded.items.some((item) => item.itemId.startsWith('item.heirloom.'))).toBe(false);
    expect(decoded.items.find((item) => item.itemId === pieceId)!.heirloom).toMatchObject({
      originatingHallRecordId: 'hall.a',
      originatingRank: 1,
    });
    // The re-sort is load-bearing: the renamed `item.haunt.` piece must have MOVED to before the
    // fixture's in-between `item.hauntling-charm`, keeping the whole list strictly ascending.
    const ids = decoded.items.map((item) => item.itemId);
    expect(ids.indexOf(pieceId)).toBeLessThan(ids.indexOf('item.hauntling-charm'));
    expect([...ids].sort()).toEqual(ids);
    const encoded = encodeActiveRun(decoded);
    expect(encodeActiveRun(decodeActiveRun(encoded, context.content))).toBe(encoded);
  });

  it('migrates a v15 save whose echo was already defeated and never surrendered a piece', () => {
    const decoded = decodeActiveRun(JSON.stringify(v15WithDefeatedHaunts()), context.content);
    const echo = decoded.populations.find((population) => population.model === 'echo')!;
    expect(
      decoded.items.some((item) => item.itemId.startsWith(`item.haunt.${echo.populationId}.`)),
    ).toBe(false);
    const encoded = encodeActiveRun(decoded);
    expect(encodeActiveRun(decodeActiveRun(encoded, context.content))).toBe(encoded);
  });

  it('refuses a pre-haunt reward marker that would excuse a partially deleted drop', () => {
    // The marker is the one mechanism that lets a rewarded haunt owe no pieces. It must never be
    // usable to explain away a v16 drop with items removed from it.
    const decoded = decodeActiveRun(JSON.stringify(v15WithDefeatedHaunts()));
    const champion = decoded.populations.find((population) => population.model === 'champion')!;
    const forged = {
      ...decoded,
      populations: decoded.populations.map((population) =>
        population.populationId === champion.populationId
          ? { ...population, preHauntReward: true as const }
          : population,
      ),
    };
    expect(() => encodeActiveRun(forged)).toThrow(
      /pre-haunt reward cannot coexist with death-inventory pieces/i,
    );
  });

  it('migrates every legacy entry version through the frozen pre-haunt standing schema', () => {
    for (const version of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const) {
      const decoded = decodeActiveRun(
        JSON.stringify(legacyFixtureAtVersion(version)),
        compiledContent,
      );
      expect(decoded.schemaVersion).toBe(17);
      expect(decoded.fallenHeroStandings.every((standing) => standing.cause === null)).toBe(true);
      expect(
        decoded.fallenHeroStandings.every((standing) => standing.deathInventory.length === 1),
      ).toBe(true);
      expect(decoded.fallenHeroDecisions.every((decision) => decision.appeased === false)).toBe(
        true,
      );
    }
  });

  it('round-trips a haunt standing byte-identically', () => {
    const run = withHauntStanding(baseRun(), {
      cause: { killerContentId: 'monster.bone-gnawer', depth: 7, turn: 412, worldTime: 41200 },
      deathInventory: [heirloomFixture(), secondEquippedFixture()],
    });
    const encoded = encodeActiveRun(run);
    expect(encodeActiveRun(decodeActiveRun(encoded, compiledContent))).toBe(encoded);
  });

  it('rejects an empty death inventory', () => {
    const withStanding = withRecordedHeirloom(baseRun(), heirloomFixture());
    const standing = { ...withStanding.fallenHeroStandings[0], cause: null, deathInventory: [] };
    const run = { ...withStanding, fallenHeroStandings: [standing] };
    expect(() => encodeActiveRun(run)).toThrow(/deathInventory/);
  });

  it('accepts an appeased decision whose defeated flag is false', () => {
    const run = withAppeasedDecision(baseRun());
    expect(() => decodeActiveRun(encodeActiveRun(run), compiledContent)).not.toThrow();
  });

  it('migrates a v14 save by defaulting the mode to classic', () => {
    const v14 = v14Fixture();
    const decoded = decodeActiveRun(JSON.stringify(v14));
    expect(decoded.mode).toBe('classic');
    expect(decoded.schemaVersion).toBe(17);
  });

  it('defaults the mode to classic for every legacy entry version', () => {
    const legacyFixtures: Record<number, () => Record<string, unknown>> = {
      4: v4Fixture,
      5: v5Fixture,
      6: v6Fixture,
      7: v7Fixture,
      8: v8Fixture,
      9: v9Fixture,
      10: v10Fixture,
      11: v11Fixture,
      12: v12Fixture,
      13: v13Fixture,
    };
    for (const version of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const) {
      const legacy = legacyFixtures[version]!();
      expect(decodeActiveRun(JSON.stringify(legacy)).mode).toBe('classic');
    }
  });

  it('round-trips a wanderer run byte-identically', () => {
    const run = { ...baseRun(), mode: 'wanderer' as const };
    const encoded = encodeActiveRun(run);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(decodeActiveRun(encoded).mode).toBe('wanderer');
  });

  it('rejects an unknown mode value as an invalid save', () => {
    const broken = { ...JSON.parse(encodeActiveRun(baseRun())), mode: 'ironman' };
    expect(() => decodeActiveRun(JSON.stringify(broken))).toThrow(/mode/);
  });

  it('rejects a save with no mode at the live schema version', () => {
    const broken = JSON.parse(encodeActiveRun(baseRun())) as Record<string, unknown>;
    delete broken.mode;
    expect(() => decodeActiveRun(JSON.stringify(broken))).toThrow(/mode/);
  });

  it('migrates a v13 save by defaulting the curse field to absent', () => {
    const v13 = v13Fixture();
    for (const item of v13.items as Record<string, unknown>[]) delete item.curse;
    const decoded = decodeActiveRun(JSON.stringify(v13));
    expect(decoded.items.every((item) => item.curse === undefined)).toBe(true);
    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
  });

  // A real v13 save can carry a recorded Hall standing whose heirloom predates the `curse` field
  // entirely (no key, not `curse: null`). `RecordedHeirloomSnapshot.curse` is required (unlike the
  // optional `ItemInstance.curse`), so the migration must write a default in, not merely tolerate
  // absence.
  it('migrates a v13 save with a Hall standing by defaulting the recorded heirloom curse to null', () => {
    const legacy = withRecordedHeirloom(v13Fixture(), preCurseHeirloomFixture(), { legacy: true });
    const decoded = decodeActiveRun(JSON.stringify(legacy));
    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.fallenHeroStandings[0]!.heirloom.curse).toBeNull();
    expect(decoded.fallenHeroStandings[0]!.cause).toBeNull();
    expect(decoded.fallenHeroStandings[0]!.deathInventory).toEqual([
      decoded.fallenHeroStandings[0]!.heirloom,
    ]);
    expect(decoded.fallenHeroDecisions[0]!.appeased).toBe(false);
  });

  // The same defaulting must survive the full legacy chain: a v12 save's `fallenHeroStandings`
  // reaches `migrateV13ToV14` only after parsing through every intermediate frozen schema, each of
  // which must accept a pre-curse heirloom (not just the v13 one).
  it('migrates a v12 save with a Hall standing through v14, defaulting item and heirloom curse', () => {
    const legacy = withRecordedHeirloom(v12Fixture(), preCurseHeirloomFixture(), { legacy: true });
    const decoded = decodeActiveRun(JSON.stringify(legacy));
    expect(decoded.schemaVersion).toBe(17);
    expect(decoded.mode).toBe('classic');
    expect(decoded.fallenHeroStandings[0]!.heirloom.curse).toBeNull();
    expect(decoded.items.every((item) => item.curse === undefined)).toBe(true);
    expect(decoded.fallenHeroStandings[0]!.cause).toBeNull();
    expect(decoded.fallenHeroStandings[0]!.deathInventory).toEqual([
      decoded.fallenHeroStandings[0]!.heirloom,
    ]);
    expect(decoded.fallenHeroDecisions[0]!.appeased).toBe(false);
  });

  it('round-trips a cursed item byte-identically', () => {
    const run = withCursedItem(baseRun(), { curseId: 'curse.hungering-edge', revealed: true });
    const encoded = encodeActiveRun(run);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
  });

  it('rejects a curse block naming a curse the pack does not define', () => {
    const run = withCursedItem(baseRun(), { curseId: 'curse.not-real', revealed: false });
    expect(() => validateContentBoundRun(run, compiledContent)).toThrow(/curse.not-real/);
  });

  it('preserves the curse across a recorded heirloom snapshot', () => {
    const snapshot = {
      ...heirloomFixture(),
      curse: { curseId: 'curse.leaden-weight', revealed: true },
    };
    const run = withRecordedHeirloom(baseRun(), snapshot);
    const decoded = decodeActiveRun(encodeActiveRun(run));
    expect(recordedHeirloomOf(decoded).curse).toEqual({
      curseId: 'curse.leaden-weight',
      revealed: true,
    });
  });

  it('round-trips a run carrying an offered artifact to identical stable bytes', () => {
    const withArtifacts = {
      ...createDemoRun(),
      offeredArtifact: 'artifact.b',
      artifactsUndiscovered: ['artifact.a', 'artifact.b'],
    };
    const encoded = encodeActiveRun(withArtifacts);
    const decoded = decodeActiveRun(encoded);

    expect(decoded.offeredArtifact).toBe('artifact.b');
    expect(decoded.artifactsUndiscovered).toEqual(['artifact.a', 'artifact.b']);
    expect(encodeActiveRun(decoded)).toBe(encoded);
  });

  it('rejects an offered artifact that is not undiscovered', () => {
    const invalid = {
      ...createDemoRun(),
      offeredArtifact: 'artifact.c',
      artifactsUndiscovered: ['artifact.a', 'artifact.b'],
    };

    expect(() => validateActiveRun(invalid)).toThrowError(
      /offeredArtifact.*undiscovered|undiscovered/i,
    );
  });

  it('rejects undiscovered artifacts that are unsorted or duplicated', () => {
    const unsorted = {
      ...createDemoRun(),
      offeredArtifact: null,
      artifactsUndiscovered: ['artifact.b', 'artifact.a'],
    };
    const duplicated = {
      ...createDemoRun(),
      offeredArtifact: null,
      artifactsUndiscovered: ['artifact.a', 'artifact.a'],
    };

    expect(() => validateActiveRun(unsorted)).toThrow(SaveLoadError);
    expect(() => validateActiveRun(duplicated)).toThrow(SaveLoadError);
  });

  it('derives a loot-placement stream distinct from every other stream', () => {
    const streams = deriveRngStreams([1, 2, 3, 4]);
    expect(streams['loot-placement']).toBeDefined();
    for (const name of RNG_STREAM_NAMES.filter((candidate) => candidate !== 'loot-placement'))
      expect(streams['loot-placement']).not.toEqual(streams[name]);
  });

  it('migrates v11 saves by deriving the loot-placement stream', () => {
    const current = createDemoRun();
    const encoded = stripTemperingField(JSON.parse(encodeActiveRun(current)) as any) as any;
    const { 'loot-placement': _dropped, ...v11Rng } = encoded.rng;
    const v11 = {
      ...stripModeField(stripArtifactFields(encoded)),
      schemaVersion: 11,
      rng: v11Rng,
    };
    const decoded = decodeActiveRun(JSON.stringify(v11));

    expect(decoded.rng['loot-placement']).toEqual(
      deriveRngStreams(decoded.runSeed)['loot-placement'],
    );
    expect(encodeActiveRun(decoded)).toEqual(encodeActiveRun(current));
  });

  it('round-trips current state carrying defeatedBossMonsterIds to identical stable bytes', () => {
    const withBossKills = createDemoRun();
    const decorated = {
      ...withBossKills,
      metrics: { ...withBossKills.metrics, defeatedBossMonsterIds: ['monster.ashfather'] },
    };
    const encoded = encodeActiveRun(decorated);
    expect(decodeActiveRun(encoded).metrics.defeatedBossMonsterIds).toEqual(['monster.ashfather']);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
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

  it('round-trips a recorded offer command', () => {
    const state = createDemoRun();
    const command = {
      type: 'offer' as const,
      commandId: 'command.guest-000001',
      expectedRevision: 0,
      itemId: 'item.scroll.0001',
      targetActorId: 'actor.population.fallen-echo-2.record.b.001',
    };
    const result = {
      status: 'invalid' as const,
      commandId: command.commandId,
      revision: 0,
      turn: 0,
      reason: 'offer.refused' as const,
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
    const encoded = encodeActiveRun(withHistory);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(decodeActiveRun(encoded)).toEqual(withHistory);
  });

  it('round-trips a recorded temper command', () => {
    const state = createDemoRun();
    const command = {
      type: 'temper' as const,
      commandId: 'command.temper-000001',
      expectedRevision: 0,
      attribute: 'vitality' as const,
    };
    const result = {
      status: 'invalid' as const,
      commandId: command.commandId,
      revision: 0,
      turn: 0,
      reason: 'temper.unavailable' as const,
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
    const encoded = encodeActiveRun(withHistory);
    expect(encodeActiveRun(decodeActiveRun(encoded))).toBe(encoded);
    expect(decodeActiveRun(encoded)).toEqual(withHistory);
  });

  it.each(['temper.unavailable', 'temper.capped'] as const)(
    'rejects a %s reason attached to a non-temper command',
    (reason) => {
      const state = createDemoRun();
      const command = {
        type: 'wait' as const,
        commandId: 'command.wait-temper',
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
      expect(() =>
        encodeActiveRun({
          ...state,
          recentCommands: [{ command, result, events: [invalidEvent], publicEvents: [] }],
        }),
      ).toThrow(/temper/i);
    },
  );

  it('rejects an offer.refused reason attached to a non-offer command', () => {
    const state = createDemoRun();
    const command = { type: 'wait' as const, commandId: 'command.wait-offer', expectedRevision: 0 };
    const result = {
      status: 'invalid' as const,
      commandId: command.commandId,
      revision: 0,
      turn: 0,
      reason: 'offer.refused' as const,
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
    ).toThrow(/offer/i);
  });

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
      curse: null,
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
          cause: null,
          deathInventory: [heirloom('hall.champion', 'item.iron-sword')],
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
          cause: null,
          deathInventory: [heirloom('hall.echo', 'item.short-bow')],
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
          appeased: false,
        },
        {
          hallRecordId: 'hall.echo',
          rank: 2,
          role: 'echo' as const,
          gateRoll: 123,
          retained: true,
          encountered: false,
          defeated: false,
          appeased: false,
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

  it('omits knownSpellIds from the encoded hero when the hero has no known spells (non-caster byte-identity)', () => {
    const state = createDemoRun();
    expect(state.hero.knownSpellIds).toBeUndefined();

    const encoded = encodeActiveRun(state);
    const parsed = JSON.parse(encoded);
    expect(Object.hasOwn(parsed.hero, 'knownSpellIds')).toBe(false);

    const decoded = decodeActiveRun(encoded);
    expect(decoded.hero.knownSpellIds).toBeUndefined();
    expect(encodeActiveRun(decoded)).toBe(encoded);
  });

  it('round-trips a hero with knownSpellIds present', () => {
    const state = createDemoRun();
    const withSpells = { ...state, hero: { ...state.hero, knownSpellIds: ['spell.ember-bolt'] } };

    const encoded = encodeActiveRun(withSpells);
    const parsed = JSON.parse(encoded);
    expect(parsed.hero.knownSpellIds).toEqual(['spell.ember-bolt']);

    const decoded = decodeActiveRun(encoded);
    expect(decoded.hero.knownSpellIds).toEqual(['spell.ember-bolt']);
    expect(encodeActiveRun(decoded)).toBe(encoded);
  });

  it('decodes a pre-existing (v9) save lacking knownSpellIds as absent', () => {
    const legacy = structuredClone(createDemoRun()) as any;
    expect(Object.hasOwn(legacy.hero, 'knownSpellIds')).toBe(false);

    const decoded = decodeActiveRun(JSON.stringify(legacy));
    expect(decoded.hero.knownSpellIds).toBeUndefined();
    expect(encodeActiveRun(decodeActiveRun(encodeActiveRun(decoded)))).toBe(
      encodeActiveRun(decoded),
    );
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

  it('round-trips a haunt sighting retained in command history (byte-identity)', () => {
    // The exact hole a narrower, schema-less PublicEvent shape left uncovered: `events` (the
    // authoritative domain history) keeps the FULL `champion.encountered` domain event
    // (populationId/rank included), while `publicEvents` (what a duplicate-command replay hands
    // back to the client, and what persists across reload) carries the derived, player-facing
    // `haunt.sighted` event instead -- never the raw domain shape.
    const state = createDemoRun();
    const command = {
      type: 'wait' as const,
      commandId: 'command.haunt-sighted',
      expectedRevision: 0,
    };
    const result = {
      status: 'applied' as const,
      commandId: command.commandId,
      revision: 1,
      turn: 1,
    };
    const events = [
      {
        type: 'hero.waited' as const,
        eventId: command.commandId,
        heroId: state.hero.actorId,
        x: 1,
        y: 1,
      },
      {
        type: 'champion.encountered' as const,
        eventId: command.commandId,
        populationId: 'population.champion',
        actorId: 'actor.champion',
        hallRecordId: 'hall.champion',
        rank: 1 as const,
      },
    ];
    const publicEvents = [
      {
        type: 'haunt.sighted' as const,
        eventId: command.commandId,
        actorId: 'actor.champion',
        hallRecordId: 'hall.champion',
        role: 'champion' as const,
      },
    ];
    const withHistory = {
      ...state,
      revision: 1,
      turn: 1,
      recentCommands: [{ command, result, events, publicEvents }],
    };
    const encoded = encodeActiveRun(withHistory);
    const decoded = decodeActiveRun(encoded);
    // Byte-identity: encoding the decoded run must reproduce the exact same bytes -- the
    // regression this test exists to catch is a `haunt.sighted` value that either fails to parse
    // at all (SaveLoadError out of decode) or silently loses/reshapes a field on the round trip.
    expect(encodeActiveRun(decoded)).toBe(encoded);
    expect(decoded.recentCommands[0]?.publicEvents).toEqual(publicEvents);
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

  it.each([0, 1, 2, 3, 18])(
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
    // A bare door tile is only a legal state where a vault placement slot covers it, so the door
    // case is authored the way the town's house door is: terrain plus a fixture slot, no feature.
    // That keeps the movement rejection on the terrain itself (a closed door *feature* would be
    // bumped open instead).
    const vaults =
      tile === 2
        ? [
            {
              placementId: 'placement.demo-door',
              vaultId: 'vault.demo-door',
              x: 1,
              y: 0,
              width: 1,
              height: 1,
              rotation: 0 as const,
              reflected: false,
              entrances: [],
            },
          ]
        : floor.vaults;
    const placementSlots =
      tile === 2
        ? [
            {
              slotId: 'slot.demo-door',
              vaultPlacementId: 'placement.demo-door',
              kind: 'fixture' as const,
              required: true,
              tags: ['house-door'],
              x: 1,
              y: 0,
            },
          ]
        : floor.placementSlots;
    const initial = {
      ...demo,
      floors: [
        {
          ...floor,
          tiles: floor.tiles.map((current, index) => (index === 1 ? tile : current)),
          vaults,
          placementSlots,
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
