import type { ActiveRun, TileId } from './model.js';
import { deriveRngStreams } from './random.js';
import { createUnknownKnowledge } from './knowledge.js';
import { refreshKnowledge } from './perception.js';
import { ENGINE_GAME_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';
import { emptyEquipment, heroPerception, type ActorState } from './actor-model.js';
import { CONTENT_SCHEMA_VERSION, type CompiledContentPack } from '@woven-deep/content';

export function createDemoContentPack(): CompiledContentPack {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    hash: 'a'.repeat(64),
    entries: [{
      kind: 'balance', id: 'balance.core-gameplay', name: 'Core gameplay', tags: ['core'],
      readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400,
      energyMinimum: -10_000, energyMaximum: 10_000, attributeMinimum: 0, attributeMaximum: 30,
      hungerMaximum: 10_000, hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 },
      starvationInterval: 500, starvationDamage: 1,
      recoveryInterval: 500, recoveryAmount: 1,
      restMaximumDuration: 5000,
      recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 },
      hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} },
      formulas: {
        maxHealth: { base: 8, vitality: 2 }, meleeAccuracy: { might: 1 }, meleeDamageBonus: { might: 1 },
        rangedAccuracy: { agility: 1 }, defense: { base: 8, agility: 1 }, search: { wits: 1 },
        disarm: { agility: 1, wits: 1 },
      },
      actionCosts: { 'action.move': 100, 'action.wait': 100 },
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
  const hero = { actorId: 'hero.demo', name: 'Ada', sightRadius: 12, backpackCapacity: 12 } as const;
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
    behaviorState: {},
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
    floors: [{ ...floor, knowledge }],
    recentCommands: [],
  };
}
