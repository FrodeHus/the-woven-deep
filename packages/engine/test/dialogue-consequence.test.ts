import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  type CompiledContentPack,
  type DialogueContentEntry,
  type MerchantEncounterContentEntry,
  type NpcContentEntry,
  type NpcFactionContentEntry,
} from '@woven-deep/content/compiler';
import {
  allocateIdentificationMap,
  createDemoRun,
  factionReputation,
  materializeMerchant,
  resolveCommand,
  stableJson,
  validateActiveRun,
  type ActiveRun,
  type GameCommand,
  type MerchantPopulation,
} from '../src/index.js';
import { merchantPopulation as merchantPopulationSchema } from '../src/save-schema/merchant.js';

let baseContent: CompiledContentPack;
let content: CompiledContentPack;
let encounter: MerchantEncounterContentEntry;
let faction: NpcFactionContentEntry;
let npc: NpcContentEntry;

const POPULATION_ID = 'population.dialogue-demo';
const MERCHANT_ACTOR_ID = `actor.${POPULATION_ID}.001`;
const HERO_ID = 'hero.demo';
const DIALOGUE_ID = 'dialogue.test-lampwright';
const REPUTATION_TOPIC_ID = 'topic.reputation';
const TRADE_TOPIC_ID = 'topic.trade';
const LORE_TOPIC_ID = 'topic.lore';
const REPUTATION_DELTA = 15;

beforeAll(async () => {
  baseContent = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  // Permanent (town) merchants are never materialized through population placement, so this
  // suite exercises a non-permanent, dungeon-wandering merchant encounter, mirroring
  // merchant-trade.test.ts's fixture.
  encounter = baseContent.entries.find(
    (entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent,
  )!;
  faction = baseContent.entries.find(
    (entry): entry is NpcFactionContentEntry => entry.kind === 'npc-faction',
  )!;
  const authoredNpc = baseContent.entries.find(
    (entry): entry is NpcContentEntry =>
      entry.kind === 'npc' && entry.id === encounter.definition.npcId,
  )!;
  npc = { ...authoredNpc, dialogueId: DIALOGUE_ID };
  const dialogue: DialogueContentEntry = {
    id: DIALOGUE_ID,
    kind: 'dialogue',
    name: 'Test Lampwright Dialogue',
    tags: [],
    greeting: 'Greetings, traveller.',
    topics: [
      {
        id: REPUTATION_TOPIC_ID,
        prompt: 'Tell me about the roads.',
        response: 'Watch your step out there.',
        consequence: { kind: 'reputation', factionId: faction.id, amount: REPUTATION_DELTA },
      },
      {
        id: TRADE_TOPIC_ID,
        prompt: 'Show me your wares.',
        response: 'Take a look.',
        consequence: { kind: 'open-trade' },
      },
      {
        id: LORE_TOPIC_ID,
        prompt: 'What is this place?',
        response: 'An old tale...',
        consequence: { kind: 'reveal-lore', contentId: 'item.iron-sword' },
      },
    ],
  };
  content = {
    ...baseContent,
    entries: [...baseContent.entries.map((entry) => (entry.id === npc.id ? npc : entry)), dialogue],
  };
});

interface FixtureOptions {
  readonly position?: Readonly<{ x: number; y: number }>;
  readonly reputation?: number;
  readonly relationship?: 'hostile';
}

function merchantRun(options: FixtureOptions = {}): ActiveRun {
  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content, rng: base.rng });
  const run: ActiveRun = {
    ...base,
    contentHash: content.hash,
    identification: identified.identification,
    rng: identified.rng,
    reputations:
      options.reputation === undefined
        ? []
        : [{ factionId: faction.id, value: options.reputation }],
    encounterDecisions: content.entries
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
        instancesCreated: entry.id === encounter.id ? 1 : 0,
      })),
  };
  const materialized = materializeMerchant({
    run,
    content,
    encounter,
    populationId: POPULATION_ID,
    floorId: 'floor.demo',
    position: options.position ?? { x: 2, y: 1 },
  });
  const relationships =
    options.relationship === undefined
      ? run.relationships
      : [
          ...run.relationships,
          {
            leftActorId: MERCHANT_ACTOR_ID < HERO_ID ? MERCHANT_ACTOR_ID : HERO_ID,
            rightActorId: MERCHANT_ACTOR_ID < HERO_ID ? HERO_ID : MERCHANT_ACTOR_ID,
            relationship: options.relationship,
          },
        ];
  return {
    ...run,
    rng: { ...run.rng, 'merchant-stock': materialized.nextMerchantStockState },
    actors: [...run.actors, materialized.actor].sort((left, right) =>
      left.actorId < right.actorId ? -1 : 1,
    ),
    items: [...run.items, ...materialized.items].sort((left, right) =>
      left.itemId < right.itemId ? -1 : 1,
    ),
    populations: [materialized.population],
    relationships,
  };
}

const context = () => ({ content });

function merchantPopulationOf(run: ActiveRun): MerchantPopulation {
  return run.populations.find(
    (population): population is MerchantPopulation => population.model === 'merchant',
  )!;
}

function dialogueCommand(overrides: Partial<GameCommand> = {}): GameCommand {
  return {
    type: 'dialogue-consequence',
    commandId: 'command.dialogue-1',
    expectedRevision: 0,
    npcActorId: MERCHANT_ACTOR_ID,
    topicId: REPUTATION_TOPIC_ID,
    ...overrides,
  } as GameCommand;
}

describe('dialogue-consequence command', () => {
  it('applies the reputation consequence once, advancing only the revision', () => {
    const run = merchantRun();
    const resolved = resolveCommand(run, dialogueCommand(), context());
    expect(resolved.result.status).toBe('applied');
    expect(resolved.result.revision).toBe(run.revision + 1);
    expect(resolved.result.turn).toBe(run.turn);
    expect(factionReputation(resolved.state, faction)).toBe(
      faction.startingReputation + REPUTATION_DELTA,
    );
    const reputationEvent = resolved.events.find((event) => event.type === 'reputation.changed');
    expect(reputationEvent).toMatchObject({
      type: 'reputation.changed',
      factionId: faction.id,
      delta: REPUTATION_DELTA,
      reason: 'dialogue',
    });
    expect(merchantPopulationOf(resolved.state).dialogueConsequencesApplied).toEqual([
      REPUTATION_TOPIC_ID,
    ]);
  });

  it('rejects a repeat of the same topic (one-time guard) without changing reputation', () => {
    const run = merchantRun();
    const first = resolveCommand(run, dialogueCommand(), context());
    if (first.result.status !== 'applied') throw new Error('fixture setup failed');
    const second = resolveCommand(
      first.state,
      dialogueCommand({ commandId: 'command.dialogue-2', expectedRevision: first.state.revision }),
      context(),
    );
    expect(second.result.status).toBe('invalid');
    expect(second.result).toMatchObject({ reason: 'dialogue.invalid-topic' });
    expect(factionReputation(second.state, faction)).toBe(factionReputation(first.state, faction));
  });

  it('rejects a non-adjacent NPC', () => {
    const run = merchantRun({ position: { x: 8, y: 8 } });
    const resolved = resolveCommand(run, dialogueCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.out-of-range' });
  });

  it('rejects a hostile NPC', () => {
    const run = merchantRun({ relationship: 'hostile' });
    const resolved = resolveCommand(run, dialogueCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.out-of-range' });
  });

  it('rejects an unperceived NPC (outside the hero sight radius / illumination)', () => {
    const run = merchantRun();
    const dimmed: ActiveRun = { ...run, hero: { ...run.hero, sightRadius: 0 } };
    const resolved = resolveCommand(dimmed, dialogueCommand(), context());
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.out-of-range' });
  });

  it('rejects a topicId absent from the dialogue (anti-cheat)', () => {
    const run = merchantRun();
    const resolved = resolveCommand(
      run,
      dialogueCommand({ topicId: 'topic.does-not-exist' }),
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.invalid-topic' });
  });

  it('rejects a topic whose consequence is open-trade (anti-cheat)', () => {
    const run = merchantRun();
    const resolved = resolveCommand(run, dialogueCommand({ topicId: TRADE_TOPIC_ID }), context());
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.invalid-topic' });
  });

  it('rejects a topic whose consequence is reveal-lore (anti-cheat)', () => {
    const run = merchantRun();
    const resolved = resolveCommand(run, dialogueCommand({ topicId: LORE_TOPIC_ID }), context());
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'dialogue.invalid-topic' });
  });

  it('never trusts a client-supplied faction or amount: the command carries only npcActorId + topicId', () => {
    const command = dialogueCommand();
    expect(Object.keys(command).sort()).toEqual(
      ['commandId', 'expectedRevision', 'npcActorId', 'topicId', 'type'].sort(),
    );
  });
});

describe('MerchantPopulation.dialogueConsequencesApplied save round-trip', () => {
  function basePopulation(): MerchantPopulation {
    const run = merchantRun();
    return merchantPopulationOf(run);
  }

  it('decodes and re-encodes byte-identically without the optional field', () => {
    const population = basePopulation();
    expect(population.dialogueConsequencesApplied).toBeUndefined();
    const parsed = merchantPopulationSchema.parse(population);
    expect(stableJson(parsed)).toBe(stableJson(population));
    expect('dialogueConsequencesApplied' in parsed).toBe(false);
  });

  it('round-trips with a populated dialogueConsequencesApplied', () => {
    const population: MerchantPopulation = {
      ...basePopulation(),
      dialogueConsequencesApplied: [REPUTATION_TOPIC_ID],
    };
    const parsed = merchantPopulationSchema.parse(population);
    expect(stableJson(parsed)).toBe(stableJson(population));
    expect(parsed.dialogueConsequencesApplied).toEqual([REPUTATION_TOPIC_ID]);
  });

  it('validates a full run containing the new field without a save-schema-version bump', () => {
    const run = merchantRun();
    const resolved = resolveCommand(run, dialogueCommand(), context());
    if (resolved.result.status !== 'applied') throw new Error('fixture setup failed');
    expect(() => validateActiveRun(resolved.state)).not.toThrow();
  });
});
