import type { CompiledContentPack, MerchantEncounterContentEntry } from '@woven-deep/content';
import { heroPerception } from './actor-model.js';
import type { ActiveRun, CommandResult, DomainEvent, GameCommand, PublicEvent } from './model.js';
import type { MerchantPopulation } from './merchant-model.js';
import { validateMerchantInvariants } from './merchant-fixture.js';
import { refreshKnowledge } from './perception.js';
import {
  createPopulationDemoRun,
  populationDemoCommands,
  populationDemoScenario,
  resolvePopulationDemoCommand,
  validatePopulationInvariants,
  type PopulationDemoInput,
  type PopulationDemoScenario,
} from './population-fixture.js';
import { placePopulation } from './population-placement.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { replayCommands } from './replay.js';
import { decodeActiveRun, encodeActiveRun } from './save-codec.js';
import { compareCodeUnits, stableJson } from './stable-json.js';
import { movementBlockReason } from './terrain.js';

export const COMBINED_POPULATION_REPLAY_BOUNDARIES = [
  'before-group-relay',
  'before-trade-open',
  'before-trade-buy',
  'before-trade-close',
  'before-source-spawn',
  'before-leader-death',
  'before-boss-threshold',
  'before-boss-re-entry',
  'before-champion-encounter',
  'before-champion-defeat',
  'before-echo-defeat',
  'before-reward-creation',
] as const;

export interface CombinedPopulationDemoRecord {
  readonly boundary: (typeof COMBINED_POPULATION_REPLAY_BOUNDARIES)[number];
  readonly command: GameCommand;
  readonly commandResult: CommandResult;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface CombinedPopulationDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly CombinedPopulationDemoRecord[];
}

export type CombinedDemoInput =
  | Readonly<{
      kind: 'population';
      boundary: (typeof COMBINED_POPULATION_REPLAY_BOUNDARIES)[number];
      input: PopulationDemoInput;
    }>
  | Readonly<{
      kind: 'merchant';
      boundary: (typeof COMBINED_POPULATION_REPLAY_BOUNDARIES)[number];
      command: GameCommand;
    }>;

function adjacentFreeCell(
  run: ActiveRun,
  floorId: string,
  target: Readonly<{ x: number; y: number }>,
  excludedActorId: string,
): Readonly<{ x: number; y: number }> {
  const floor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const occupied = new Set(
    run.actors
      .filter(
        (actor) =>
          actor.actorId !== excludedActorId && actor.floorId === floorId && actor.health > 0,
      )
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error(`combined population fixture cannot stand adjacent to ${target.x}:${target.y}`);
}

/**
 * Builds the combined milestone-exit fixture: the full boss+swarm+group+champion+echo
 * `createPopulationDemoRun` world, plus one production, non-permanent merchant placement
 * materialized onto the same non-arena floor as the group and swarm, standing next to the hero.
 */
export function createCombinedPopulationDemoRun(
  pack: CompiledContentPack,
  scenarioSeed = 0,
): ActiveRun {
  let run = createPopulationDemoRun(pack, scenarioSeed);
  const merchantEncounter = pack.entries.find(
    (entry): entry is MerchantEncounterContentEntry =>
      entry.kind === 'encounter' && entry.model === 'merchant' && !entry.definition.permanent,
  );
  if (!merchantEncounter)
    throw new Error('combined population fixture requires a non-permanent merchant encounter');
  const groupPopulation = run.populations.find((population) => population.model === 'group')!;
  const floorId = groupPopulation.floorId;
  const floor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const placement = placePopulation({
    run,
    floor,
    content: pack,
    forcedEncounterId: merchantEncounter.id,
  });
  if (placement.status !== 'placed') {
    throw new Error(
      `combined population fixture could not place ${merchantEncounter.id}: ${placement.reason}`,
    );
  }
  run = {
    ...run,
    actors: [...run.actors, ...placement.createdActors].sort((left, right) =>
      compareCodeUnits(left.actorId, right.actorId),
    ),
    populations: [...run.populations, placement.population].sort((left, right) =>
      compareCodeUnits(left.populationId, right.populationId),
    ),
    items: [...run.items, ...placement.createdItems].sort((left, right) =>
      compareCodeUnits(left.itemId, right.itemId),
    ),
    features: [...run.features, ...placement.createdFeatures].sort((left, right) =>
      compareCodeUnits(left.featureId, right.featureId),
    ),
    floors: run.floors.map((candidate) =>
      candidate.floorId === placement.floor.floorId ? placement.floor : candidate,
    ),
    encounterDecisions: placement.encounterDecisions,
    rng: {
      ...run.rng,
      encounters: placement.nextEncounterState,
      ...(placement.nextMerchantStockState === null
        ? {}
        : { 'merchant-stock': placement.nextMerchantStockState }),
    },
  };
  const merchantPopulation = run.populations.find(
    (population): population is MerchantPopulation => population.model === 'merchant',
  )!;
  const heroId = run.hero.actorId;
  const hero = run.actors.find((actor) => actor.actorId === heroId)!;
  const merchantActor = run.actors.find((actor) => actor.actorId === merchantPopulation.actorId)!;
  const cell = adjacentFreeCell(run, floorId, hero, merchantActor.actorId);
  run = {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === merchantActor.actorId ? { ...actor, ...cell } : actor,
    ),
    floors: run.floors.map((candidate) =>
      candidate.floorId !== floorId
        ? candidate
        : {
            ...candidate,
            entities: candidate.entities.map((entity) =>
              entity.entityId === merchantActor.actorId ? { ...entity, ...cell } : entity,
            ),
          },
    ),
  };
  const refreshedFloor = run.floors.find((candidate) => candidate.floorId === floorId)!;
  const refreshedHero = run.actors.find((actor) => actor.actorId === heroId)!;
  const knowledge = refreshKnowledge({
    floor: refreshedFloor,
    hero: heroPerception(run.hero, refreshedHero),
    actors: new Map(
      run.actors
        .filter((actor) => actor.floorId === floorId)
        .map((actor) => [actor.actorId, actor] as const),
    ),
  }).knowledge;
  run = {
    ...run,
    floors: run.floors.map((candidate) =>
      candidate.floorId === floorId ? { ...candidate, knowledge } : candidate,
    ),
  };
  validatePopulationInvariants(run, pack);
  validateMerchantInvariants(run, pack);
  return run;
}

/**
 * Interleaves the nine `population-fixture` boundaries with three trade boundaries (open, buy,
 * close) against the merchant materialized in `createCombinedPopulationDemoRun`, renumbering
 * command ids and expected revisions into one continuous twelve-command sequence.
 */
export function combinedPopulationDemoCommands(
  initial: ActiveRun,
  scenario: PopulationDemoScenario,
): readonly CombinedDemoInput[] {
  const merchant = initial.populations.find(
    (population): population is MerchantPopulation => population.model === 'merchant',
  )!;
  const buyItemId = merchant.stockItemIds[0];
  if (buyItemId === undefined)
    throw new Error('combined population fixture requires merchant stock to buy');
  const populationInputs = populationDemoCommands(initial, scenario);
  let expectedRevision = initial.revision;
  let sequence = 0;
  const nextCommandId = () => `command.combined-demo-${String(++sequence).padStart(2, '0')}`;
  const pushPopulation = (input: PopulationDemoInput): CombinedDemoInput => {
    const command = { ...input.command, commandId: nextCommandId(), expectedRevision };
    expectedRevision += 1;
    return { kind: 'population', boundary: input.boundary, input: { ...input, command } };
  };
  const pushMerchant = (
    boundary: (typeof COMBINED_POPULATION_REPLAY_BOUNDARIES)[number],
    command: GameCommand,
  ): CombinedDemoInput => {
    const built = { ...command, commandId: nextCommandId(), expectedRevision };
    expectedRevision += 1;
    return { kind: 'merchant', boundary, command: built };
  };
  const result: CombinedDemoInput[] = [];
  result.push(pushPopulation(populationInputs[0]!)); // before-group-relay
  result.push(
    pushMerchant('before-trade-open', {
      type: 'trade-open',
      merchantActorId: merchant.actorId,
      commandId: '',
      expectedRevision: 0,
    }),
  );
  result.push(
    pushMerchant('before-trade-buy', {
      type: 'trade-buy',
      merchantPopulationId: merchant.populationId,
      itemId: buyItemId,
      quantity: 1,
      commandId: '',
      expectedRevision: 0,
    }),
  );
  result.push(
    pushMerchant('before-trade-close', {
      type: 'trade-close',
      merchantPopulationId: merchant.populationId,
      commandId: '',
      expectedRevision: 0,
    }),
  );
  for (const input of populationInputs.slice(1)) result.push(pushPopulation(input));
  return result;
}

function resolveCombinedMerchantCommand(
  state: ActiveRun,
  command: GameCommand,
  pack: CompiledContentPack,
): Readonly<{
  state: ActiveRun;
  result: CommandResult;
  authoritativeEvents: readonly DomainEvent[];
  publicEvents: readonly PublicEvent[];
  projection: GameplayProjection;
}> {
  const replay = replayCommands(state, [command], { content: pack });
  const step = replay.steps[0]!;
  const recorded = replay.state.recentCommands.find(
    (entry) => entry.command.commandId === command.commandId,
  );
  if (step.result.status === 'applied' && !recorded) {
    throw new Error(`combined population demo command ${command.commandId} was not persisted`);
  }
  if (replay.state.worldTime < state.worldTime)
    throw new Error(`combined population fixture time reversed at ${command.commandId}`);
  validatePopulationInvariants(replay.state, pack);
  validateMerchantInvariants(replay.state, pack);
  return {
    state: replay.state,
    result: step.result,
    authoritativeEvents: recorded?.events ?? [],
    publicEvents: step.events,
    projection: projectGameplayState({ state: replay.state, content: pack }),
  };
}

/** Dispatches a combined-fixture input to the population or merchant boundary resolver. */
export function resolveCombinedPopulationDemoCommand(
  state: ActiveRun,
  input: CombinedDemoInput,
  pack: CompiledContentPack,
): Readonly<{
  state: ActiveRun;
  result: CommandResult;
  authoritativeEvents: readonly DomainEvent[];
  publicEvents: readonly PublicEvent[];
  projection: GameplayProjection;
}> {
  return input.kind === 'population'
    ? resolvePopulationDemoCommand(state, input.input, pack)
    : resolveCombinedMerchantCommand(state, input.command, pack);
}

export function runCombinedPopulationDemo(
  pack: CompiledContentPack,
  reloadBefore: ReadonlySet<number> = new Set(),
  scenario: PopulationDemoScenario = populationDemoScenario(0),
): CombinedPopulationDemoResult {
  const initial = createCombinedPopulationDemoRun(pack, scenario.seed);
  let state = initial;
  const records: CombinedPopulationDemoRecord[] = [];
  for (const [index, input] of combinedPopulationDemoCommands(initial, scenario).entries()) {
    if (reloadBefore.has(index)) state = decodeActiveRun(encodeActiveRun(state));
    const resolved = resolveCombinedPopulationDemoCommand(state, input, pack);
    state = resolved.state;
    if (resolved.result.status !== 'applied') {
      throw new Error(
        `combined population demo command was rejected: ${stableJson(resolved.result)}`,
      );
    }
    records.push({
      boundary: input.boundary,
      command: input.kind === 'population' ? input.input.command : input.command,
      commandResult: resolved.result,
      authoritativeEvents: resolved.authoritativeEvents,
      publicEvents: resolved.publicEvents,
      projection: resolved.projection,
    });
  }
  return { initial, state, records };
}

export function combinedPopulationDemoEquivalent(
  left: CombinedPopulationDemoResult,
  right: CombinedPopulationDemoResult,
): boolean {
  return (
    encodeActiveRun(left.state) === encodeActiveRun(right.state) &&
    stableJson(left.records) === stableJson(right.records)
  );
}
