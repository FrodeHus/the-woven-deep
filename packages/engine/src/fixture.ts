import type { ActiveRun, TileId } from './model.js';
import { deriveRngStreams } from './random.js';
import { createUnknownKnowledge } from './knowledge.js';
import { refreshKnowledge } from './perception.js';
import { emptyRunMetrics } from './run-metrics.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';
import { emptyEquipment, heroPerception, type ActorState } from './actor-model.js';
import { CONTENT_SCHEMA_VERSION, type CompiledContentPack } from '@woven-deep/content';

export function createDemoContentPack(): CompiledContentPack {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    hash: 'a'.repeat(64),
    entries: [{
      kind: 'balance', id: 'balance.core-gameplay', name: 'Core gameplay', tags: ['core'],
      startingCurrency: 40,
      readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400,
      energyMinimum: -10_000, energyMaximum: 10_000, attributeMinimum: 0, attributeMaximum: 30,
      hungerMaximum: 10_000, hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 },
      starvationInterval: 500, starvationDamage: 1,
      recoveryInterval: 500, recoveryAmount: 1,
      restMaximumDuration: 5000,
      recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 },
      hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} },
      score: {
        depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25,
        completionBonus: { died: 0, refused: 400, 'became-heart': 800, 'broke-cycle': 1500 },
        turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200,
      },
      formulas: {
        maxHealth: { base: 8, vitality: 2 }, meleeAccuracy: { might: 1 }, meleeDamageBonus: { might: 1 },
        rangedAccuracy: { agility: 1 }, defense: { base: 8, agility: 1 }, search: { wits: 1 },
        disarm: { agility: 1, wits: 1 },
      },
      actionCosts: { 'action.move': 100, 'action.wait': 100, 'action.spawn': 100 },
      pointBuy: {
        budget: 30,
        costs: [
          { value: 0, cost: 0 }, { value: 1, cost: 1 }, { value: 2, cost: 2 }, { value: 3, cost: 3 },
          { value: 4, cost: 4 }, { value: 5, cost: 5 }, { value: 6, cost: 6 }, { value: 7, cost: 7 },
          { value: 8, cost: 8 }, { value: 9, cost: 9 }, { value: 10, cost: 10 }, { value: 11, cost: 12 },
          { value: 12, cost: 14 }, { value: 13, cost: 16 }, { value: 14, cost: 18 }, { value: 15, cost: 20 },
          { value: 16, cost: 22 }, { value: 17, cost: 24 }, { value: 18, cost: 26 }, { value: 19, cost: 28 },
          { value: 20, cost: 30 }, { value: 21, cost: 33 }, { value: 22, cost: 36 }, { value: 23, cost: 39 },
          { value: 24, cost: 42 }, { value: 25, cost: 45 }, { value: 26, cost: 48 }, { value: 27, cost: 51 },
          { value: 28, cost: 54 }, { value: 29, cost: 57 }, { value: 30, cost: 60 },
        ],
      },
    }, {
      kind: 'condition', id: 'condition.disengaged', name: 'Disengaged',
      description: 'Avoids opportunity attacks', tags: ['beneficial'], color: '#78c8dc',
      duration: { mode: 'timed', default: 100, maximum: 1000 },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
      traits: ['condition-trait.avoids-opportunity-attacks'],
    }, {
      kind: 'condition', id: 'condition.incapacitated', name: 'Incapacitated',
      description: 'Cannot act', tags: ['control'], color: '#c8b86a',
      duration: { mode: 'permanent', default: null, maximum: null },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
      traits: ['condition-trait.incapacitated'],
    }, {
      kind: 'condition', id: 'condition.reaction-suppressed', name: 'Reaction suppressed',
      description: 'Cannot react', tags: ['control'], color: '#b88870',
      duration: { mode: 'timed', default: 100, maximum: 1000 },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
      traits: ['condition-trait.suppresses-reactions'],
    }, {
      kind: 'condition', id: 'condition.swarm-decay', name: 'Swarm decay',
      description: 'The destroyed source causes this swarm member to decay.', tags: ['population'], color: '#8a7766',
      duration: { mode: 'permanent', default: null, maximum: null },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {}, traits: [],
    }, {
      kind: 'condition', id: 'condition.restless', name: 'Restless',
      description: 'Interrupts rest', tags: ['survival'], color: '#c89070',
      duration: { mode: 'timed', default: 100, maximum: 1000 },
      stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
      traits: ['condition-trait.interrupts-rest'],
    }],
    generationReport: { foundationalCategories: [] },
  };
}

const FLOOR_LINES = [
  '#######',
  '#.....#',
  '#..#..#',
  '#.....#',
  '#######',
] as const;

const tiles = FLOOR_LINES.flatMap((line) => [...line].map<TileId>((glyph) => glyph === '#' ? 0 : 1));
const seed = [1, 2, 3, 4] as const;

export function createDemoRun(): ActiveRun {
  const hero = { actorId: 'hero.demo', name: 'Ada', sightRadius: 12, backpackCapacity: 12, currency: 40 } as const;
  const heroActor: ActorState = {
    actorId: hero.actorId,
    contentId: 'hero.adventurer',
    playerControlled: true,
    floorId: 'floor.demo',
    x: 1,
    y: 1,
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    health: 20,
    maxHealth: 20,
    energy: 100,
    speed: 100,
    reactionReady: true,
    disposition: 'friendly',
    awareActorIds: [],
    conditions: [],
    equipment: emptyEquipment(),
    behaviorId: null,
    behaviorState: { intent: 'hold', goal: null, lastKnownTargets: [], investigation: null },
    populationId: null,
    populationRoleId: null,
    populationPresentation: null,
  };
  const floor = {
    floorId: 'floor.demo', seed, generatorVersion: 1 as const, width: 7, height: 5, depth: 1, tiles, entities: [],
    themeId: 'theme.demo', ambient: { color: [255, 255, 255] as const, strength: 255 },
    knowledge: createUnknownKnowledge(tiles.length), lights: [], stairUp: null, stairDown: null, vaults: [], placementSlots: [],
  };
  const knowledge = refreshKnowledge({
    floor,
    hero: heroPerception(hero, heroActor),
    actors: new Map([[heroActor.actorId, heroActor]]),
  }).knowledge;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: ENGINE_GAME_VERSION,
    contentHash: 'a'.repeat(64),
    runId: 'run.demo',
    runSeed: seed,
    rng: deriveRngStreams(seed),
    revision: 0,
    turn: 0,
    worldTime: 0,
    hero,
    reputations: [],
    activeTrade: null,
    actors: [heroActor],
    items: [],
    features: [],
    relationships: [],
    survival: {
      hungerReserve: 10_000,
      hungerStage: 'sated',
      nextStarvationAt: null,
      emittedHungerWarnings: [],
      emittedFuelWarnings: [],
    },
    identification: { appearanceByContentId: {}, knownAppearanceIds: [] },
    activeFloorId: 'floor.demo',
    activeFloorEnteredAt: 0,
    floors: [{ ...floor, knowledge }],
    recentCommands: [],
    encounterDecisions: [],
    populations: [],
    fallenHeroStandings: [],
    fallenHeroDecisions: [],
    conqueredChampionRecordIds: [],
    metrics: emptyRunMetrics(),
    conclusion: null,
  };
}
