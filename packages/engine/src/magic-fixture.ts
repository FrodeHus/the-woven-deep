import type {
  CompiledContentPack,
  EncounterContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, heroPerception, type ActorState } from './actor-model.js';
import { validateContentBoundRun } from './content-bound-validation.js';
import { entryById } from './content-index.js';
import { createDemoRun } from './fixture.js';
import { recallReturn, recallToTown } from './floor-transition.js';
import { allocateIdentificationMap } from './identification.js';
import type { ItemInstance } from './item-model.js';
import { createUnknownKnowledge } from './knowledge.js';
import type {
  ActiveRun,
  CommandResult,
  DomainEvent,
  FloorSnapshot,
  GameCommand,
  Point,
  PublicEvent,
  TileId,
} from './model.js';
import { refreshKnowledge } from './perception.js';
import { projectGameplayState, type GameplayProjection } from './projection.js';
import { resolveCommand } from './reducer.js';
import { compareCodeUnits, stableJson } from './stable-json.js';
import { generateTownFloor } from './town-floor.js';
import { validateActiveRun } from './save-schema.js';

const WIDTH = 19;
const HEIGHT = 13;
const FLOOR_ID = 'floor.magic-demo';
const DEPTH = 3;
const TOME_ITEM_ID = 'item.magic-demo.frost-shard-tome.1';
const MONSTER_MAX_HEALTH = 60;

const HERO_POINT: Point = { x: 9, y: 6 };
const STAIR_DOWN_POINT: Point = { x: 17, y: 11 };
const SINGLE_TARGET_POINT: Point = { x: 9, y: 5 };
const BURST_AIM_POINT: Point = { x: 13, y: 6 };
const BURST_A_POINT: Point = { x: 13, y: 6 };
const BURST_B_POINT: Point = { x: 14, y: 6 };
const LINE_AIM_POINT: Point = { x: 3, y: 6 };
const LINE_A_POINT: Point = { x: 7, y: 6 };
const LINE_B_POINT: Point = { x: 5, y: 6 };
const CONE_AIM_POINT: Point = { x: 9, y: 9 };
const CONE_A_POINT: Point = { x: 9, y: 8 };
const CONE_B_POINT: Point = { x: 8, y: 8 };

const SINGLE_TARGET_ACTOR_ID = 'monster.magic-demo.single';
const BURST_A_ACTOR_ID = 'monster.magic-demo.burst-a';
const BURST_B_ACTOR_ID = 'monster.magic-demo.burst-b';
const LINE_A_ACTOR_ID = 'monster.magic-demo.line-a';
const LINE_B_ACTOR_ID = 'monster.magic-demo.line-b';
const CONE_A_ACTOR_ID = 'monster.magic-demo.cone-a';
const CONE_B_ACTOR_ID = 'monster.magic-demo.cone-b';

export const MAGIC_DEMO_BOUNDARIES = [
  'after-learn',
  'after-single',
  'after-shield',
  'after-burst',
  'after-burn-tick',
  'after-line',
  'after-cone',
  'after-recall',
  'after-return',
] as const;

export type MagicDemoBoundary = (typeof MAGIC_DEMO_BOUNDARIES)[number];

export interface MagicDemoRecord {
  readonly boundary: MagicDemoBoundary;
  /** `null` only for `after-return`, which is a pure town-return-portal transition (no command). */
  readonly command: GameCommand | null;
  readonly commandResult: CommandResult | null;
  readonly authoritativeEvents: readonly DomainEvent[];
  readonly publicEvents: readonly PublicEvent[];
  readonly projection: GameplayProjection;
}

export interface MagicDemoResult {
  readonly initial: ActiveRun;
  readonly state: ActiveRun;
  readonly records: readonly MagicDemoRecord[];
}

/**
 * A fixed, walled, fully-open room floor (mirrors `run-records-fixture.ts`'s `demoFloor`), large
 * enough that every AoE shape used by the demo (fireball's radius-2 burst, arc-lance's radius-6
 * line, cinder-breath's radius-3 cone) resolves entirely within it, unobstructed.
 */
function demoFloor(run: ActiveRun, floorId: string, depth: number): FloorSnapshot {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index): TileId => {
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    if (x === STAIR_DOWN_POINT.x && y === STAIR_DOWN_POINT.y) return 5; // terrain.stair (down)
    return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 0 : 1;
  });
  const base: FloorSnapshot = {
    ...run.floors[0]!,
    floorId,
    width: WIDTH,
    height: HEIGHT,
    depth,
    tiles,
    entities: [],
    stairUp: null,
    stairDown: STAIR_DOWN_POINT,
    vaults: [],
    placementSlots: [],
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
  };
  const hero = run.actors[0]!;
  const actor = { ...hero, floorId, ...HERO_POINT };
  return {
    ...base,
    knowledge: refreshKnowledge({
      floor: base,
      hero: heroPerception(run.hero, actor),
      actors: new Map([[actor.actorId, actor]]),
    }).knowledge,
  };
}

/** A stationary hostile monster (`behaviorId: null`, so it never takes a turn): its exact cell is
 * the whole point of the demo (each AoE shape must land on a fixed, known cluster), and the world-
 * step scheduler never selects a `behaviorId: null` actor to act. */
function monsterActor(definition: MonsterContentEntry, actorId: string, point: Point): ActorState {
  return {
    actorId,
    contentId: definition.id,
    playerControlled: false,
    floorId: FLOOR_ID,
    ...point,
    attributes: definition.attributes,
    health: MONSTER_MAX_HEALTH,
    maxHealth: MONSTER_MAX_HEALTH,
    weave: 0,
    maxWeave: 0,
    energy: 0,
    speed: definition.speed,
    reactionReady: false,
    disposition: 'hostile',
    awareActorIds: [],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: null,
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };
}

function tomeInstance(actorId: string): ItemInstance {
  return {
    itemId: TOME_ITEM_ID,
    contentId: 'item.frost-shard-tome',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId },
  };
}

/** Magic-demo milestone save invariants, checked after every fixture transition. */
export function validateMagicDemoInvariants(run: ActiveRun, pack: CompiledContentPack): void {
  validateActiveRun(run);
  validateContentBoundRun(run, pack);
}

/**
 * Builds the magic-engine milestone exit fixture: a Loomcaller hero on a fixed, open dungeon floor
 * (depth 3), carrying an unread tome, standing at a fixed cell with six clustered monsters placed
 * so every AoE shape the demo casts (single-target, burst, line, cone) lands on a real target, plus
 * a town floor alongside it so a recall round-trip has somewhere to land. All monsters carry
 * `behaviorId: null`: they never act, so their cells (and therefore each cast's targeting) stay
 * fixed for the whole scripted replay.
 */
export function createMagicDemoRun(pack: CompiledContentPack): ActiveRun {
  const ratDefinition = entryById(pack, 'monster.cave-rat');
  const beetleDefinition = entryById(pack, 'monster.training-beetle');
  if (!ratDefinition || ratDefinition.kind !== 'monster')
    throw new Error('magic-demo fixture requires monster.cave-rat');
  if (!beetleDefinition || beetleDefinition.kind !== 'monster')
    throw new Error('magic-demo fixture requires monster.training-beetle');

  const base = createDemoRun();
  const identified = allocateIdentificationMap({ content: pack, rng: base.rng });
  const home = demoFloor(base, FLOOR_ID, DEPTH);
  const town = generateTownFloor(pack).floor;
  const heroActor = base.actors[0]!;
  const heroId = heroActor.actorId;

  const monsters: ActorState[] = [
    monsterActor(ratDefinition, SINGLE_TARGET_ACTOR_ID, SINGLE_TARGET_POINT),
    monsterActor(ratDefinition, BURST_A_ACTOR_ID, BURST_A_POINT),
    monsterActor(beetleDefinition, BURST_B_ACTOR_ID, BURST_B_POINT),
    monsterActor(beetleDefinition, LINE_A_ACTOR_ID, LINE_A_POINT),
    monsterActor(ratDefinition, LINE_B_ACTOR_ID, LINE_B_POINT),
    monsterActor(beetleDefinition, CONE_A_ACTOR_ID, CONE_A_POINT),
    monsterActor(ratDefinition, CONE_B_ACTOR_ID, CONE_B_POINT),
  ];

  const run: ActiveRun = {
    ...base,
    contentHash: pack.hash,
    runId: 'run.magic-demo',
    identification: identified.identification,
    rng: identified.rng,
    activeFloorId: FLOOR_ID,
    hero: { ...base.hero, classTags: ['loomcaller'] },
    actors: [
      { ...heroActor, floorId: FLOOR_ID, ...HERO_POINT, weave: 200, maxWeave: 200, energy: 100 },
      ...monsters,
    ].sort((left, right) => compareCodeUnits(left.actorId, right.actorId)),
    items: [tomeInstance(heroId)],
    floors: [home, town].sort((left, right) => compareCodeUnits(left.floorId, right.floorId)),
    encounterDecisions: pack.entries
      .filter((entry): entry is EncounterContentEntry => entry.kind === 'encounter')
      .sort((left, right) => compareCodeUnits(left.id, right.id))
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
  };
  validateMagicDemoInvariants(run, pack);
  return run;
}

/** Sets the hero's energy back to a fully-ready value before every scripted command -- defense in
 * depth mirroring `run-records-fixture.ts`'s `prepareHeroAttack`, since the demo drives many
 * sequential actions and must never stall on an unready actor. */
function readyHero(state: ActiveRun): ActiveRun {
  return {
    ...state,
    actors: state.actors.map((actor) =>
      actor.actorId === state.hero.actorId ? { ...actor, energy: 100 } : actor,
    ),
  };
}

/**
 * Runs the automated magic-engine exit demonstration: learn a spell from a tome, cast a
 * single-target spell, a self-buff, a burst, a line, and a cone (each AoE landing on a real,
 * clustered target), tick a burn DoT applied by the burst, then recall to town and return to the
 * anchored dungeon floor. Captures a per-boundary record (command, authoritative/public events,
 * projection) at every step, and asserts internally that the burn DoT actually ticked damage and
 * that the return-portal reaches the anchored floor.
 */
export function runMagicDemo(pack: CompiledContentPack): MagicDemoResult {
  const initial = createMagicDemoRun(pack);
  let state = initial;
  let counter = 0;
  const records: MagicDemoRecord[] = [];

  function nextCommandId(): string {
    counter += 1;
    return `command.magic-demo-${String(counter).padStart(2, '0')}`;
  }

  function apply(boundary: MagicDemoBoundary, command: GameCommand): void {
    const prepared = readyHero(state);
    const resolution = resolveCommand(prepared, command, { content: pack });
    if (resolution.result.status !== 'applied') {
      throw new Error(
        `magic demo command ${command.commandId} was rejected: ${stableJson(resolution.result)}`,
      );
    }
    const recorded = resolution.state.recentCommands.find(
      (entry) => entry.command.commandId === command.commandId,
    );
    if (!recorded) throw new Error(`magic demo command ${command.commandId} was not persisted`);
    state = resolution.state;
    validateMagicDemoInvariants(state, pack);
    records.push({
      boundary,
      command,
      commandResult: resolution.result,
      authoritativeEvents: recorded.events,
      publicEvents: resolution.events,
      projection: projectGameplayState({ state, content: pack }),
    });
  }

  apply('after-learn', {
    type: 'use-item',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    itemId: TOME_ITEM_ID,
    target: null,
  });

  apply('after-single', {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    spellId: 'spell.ember-bolt',
    target: SINGLE_TARGET_POINT,
  });

  apply('after-shield', {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    spellId: 'spell.weave-shield',
    target: null,
  });

  apply('after-burst', {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    spellId: 'spell.fireball',
    target: BURST_AIM_POINT,
  });
  const healthAfterBurst = state.actors.find((actor) => actor.actorId === BURST_A_ACTOR_ID)!.health;

  // The burn DoT (fireball's second effect) ticks on the very next world-step: a bare `wait`
  // immediately after the burst, before any other cast, so this boundary's own event log carries
  // the tick's self-inflicted `attack.hit`/`actor.damaged` pair directly (not just a cumulative
  // health delta observed later).
  apply('after-burn-tick', {
    type: 'wait',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
  });
  const healthAfterTick = state.actors.find((actor) => actor.actorId === BURST_A_ACTOR_ID)!.health;
  if (!(healthAfterTick < healthAfterBurst)) {
    throw new Error(
      'magic demo invariant: the burn DoT never ticked damage between after-burst and after-burn-tick',
    );
  }

  apply('after-line', {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    spellId: 'spell.arc-lance',
    target: LINE_AIM_POINT,
  });

  apply('after-cone', {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: state.revision,
    spellId: 'spell.cinder-breath',
    target: CONE_AIM_POINT,
  });

  const dungeonFloorId = state.activeFloorId;
  const preparedForRecall = readyHero(state);
  const recallCommand: GameCommand = {
    type: 'cast',
    commandId: nextCommandId(),
    expectedRevision: preparedForRecall.revision,
    spellId: 'spell.recall',
    target: null,
  };
  const recallResolution = resolveCommand(preparedForRecall, recallCommand, { content: pack });
  if (recallResolution.result.status !== 'applied') {
    throw new Error(`magic demo recall cast was rejected: ${stableJson(recallResolution.result)}`);
  }
  const recallRecorded = recallResolution.state.recentCommands.find(
    (entry) => entry.command.commandId === recallCommand.commandId,
  );
  if (!recallRecorded) throw new Error('magic demo recall command was not persisted');
  const townMove = recallToTown(recallResolution.state, { content: pack });
  state = townMove.state;
  validateMagicDemoInvariants(state, pack);
  records.push({
    boundary: 'after-recall',
    command: recallCommand,
    commandResult: recallResolution.result,
    authoritativeEvents: recallRecorded.events,
    publicEvents: recallResolution.events,
    projection: projectGameplayState({ state, content: pack }),
  });

  const returned = recallReturn(state, { content: pack });
  state = returned.state;
  validateMagicDemoInvariants(state, pack);
  records.push({
    boundary: 'after-return',
    command: null,
    commandResult: null,
    authoritativeEvents: returned.events,
    publicEvents: [],
    projection: projectGameplayState({ state, content: pack }),
  });

  if (state.activeFloorId !== dungeonFloorId) {
    throw new Error('magic demo invariant: the return portal did not reach the anchored floor');
  }

  return { initial, state, records };
}
