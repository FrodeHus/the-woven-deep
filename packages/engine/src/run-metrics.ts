import type { CompiledContentPack } from '@woven-deep/content';
import type { ActiveRun, DomainEvent } from './model.js';

export interface RunKillsByModel {
  readonly individual: number;
  readonly group: number;
  readonly swarm: number;
  readonly boss: number;
}

export interface RunMetrics {
  readonly kills: number;
  readonly killsByModel: RunKillsByModel;
  readonly bossKills: number;
  readonly championKills: number;
  readonly echoKills: number;
  readonly threatDefeated: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly itemsCollected: number;
  readonly itemsIdentified: number;
  readonly currencyEarned: number;
  readonly currencySpent: number;
  readonly tradesCompleted: number;
  readonly floorsEntered: number;
  readonly deepestDepth: number;
  readonly discoveriesRevealed: number;
  readonly turnsElapsed: number;
  readonly restsCompleted: number;
}

export function emptyRunMetrics(): RunMetrics {
  return {
    kills: 0,
    killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
    bossKills: 0,
    championKills: 0,
    echoKills: 0,
    threatDefeated: 0,
    damageDealt: 0,
    damageTaken: 0,
    itemsCollected: 0,
    itemsIdentified: 0,
    currencyEarned: 0,
    currencySpent: 0,
    tradesCompleted: 0,
    floorsEntered: 0,
    deepestDepth: 0,
    discoveriesRevealed: 0,
    turnsElapsed: 0,
    restsCompleted: 0,
  };
}

function checkedAdd(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${label} exceeds safe integer arithmetic`);
  }
  return sum;
}

const TRACKED_POPULATION_MODELS = ['individual', 'group', 'swarm', 'boss'] as const;
type TrackedPopulationModel = (typeof TRACKED_POPULATION_MODELS)[number];

function isTrackedPopulationModel(model: string): model is TrackedPopulationModel {
  return (TRACKED_POPULATION_MODELS as readonly string[]).includes(model);
}

/**
 * Pure fold of a processed command's domain events (plus the caller's turn-advance verdict) into
 * the run's cumulative metrics. All arithmetic is checked-integer, matching the commerce style: no
 * rule ever decreases a counter, and overflow near `Number.MAX_SAFE_INTEGER` throws rather than
 * silently wrapping.
 */
export function foldRunMetrics(
  input: Readonly<{
    metrics: RunMetrics;
    state: ActiveRun;
    content: CompiledContentPack;
    events: readonly DomainEvent[];
    turnAdvanced: boolean;
  }>,
): RunMetrics {
  const { state, content, metrics } = input;
  const heroId = state.hero.actorId;
  let kills = metrics.kills;
  let killsByModel = metrics.killsByModel;
  let bossKills = metrics.bossKills;
  let championKills = metrics.championKills;
  let echoKills = metrics.echoKills;
  let threatDefeated = metrics.threatDefeated;
  let damageDealt = metrics.damageDealt;
  let damageTaken = metrics.damageTaken;
  let itemsCollected = metrics.itemsCollected;
  let itemsIdentified = metrics.itemsIdentified;
  let currencyEarned = metrics.currencyEarned;
  let currencySpent = metrics.currencySpent;
  let tradesCompleted = metrics.tradesCompleted;
  let discoveriesRevealed = metrics.discoveriesRevealed;
  let restsCompleted = metrics.restsCompleted;

  for (const event of input.events) {
    switch (event.type) {
      case 'actor.died': {
        if (event.killerActorId !== heroId) break;
        kills = checkedAdd(kills, 1, 'kills');
        const actor = state.actors.find((candidate) => candidate.actorId === event.actorId);
        const population =
          actor?.populationId === null || actor?.populationId === undefined
            ? undefined
            : state.populations.find((candidate) => candidate.populationId === actor.populationId);
        if (population && isTrackedPopulationModel(population.model)) {
          killsByModel = {
            ...killsByModel,
            [population.model]: checkedAdd(
              killsByModel[population.model],
              1,
              `killsByModel.${population.model}`,
            ),
          };
        }
        const monster = content.entries.find(
          (entry): entry is Extract<typeof entry, { kind: 'monster' }> =>
            entry.kind === 'monster' && entry.id === event.contentId,
        );
        if (monster) threatDefeated = checkedAdd(threatDefeated, monster.threat, 'threatDefeated');
        break;
      }
      case 'boss.defeated':
        bossKills = checkedAdd(bossKills, 1, 'bossKills');
        break;
      case 'champion.defeated':
        championKills = checkedAdd(championKills, 1, 'championKills');
        break;
      case 'echo.defeated':
        echoKills = checkedAdd(echoKills, 1, 'echoKills');
        break;
      case 'actor.damaged':
        if (event.sourceActorId === heroId && event.actorId !== heroId) {
          damageDealt = checkedAdd(damageDealt, event.amount, 'damageDealt');
        }
        if (event.actorId === heroId) {
          damageTaken = checkedAdd(damageTaken, event.amount, 'damageTaken');
        }
        break;
      case 'item.picked-up':
        if (event.actorId === heroId) {
          itemsCollected = checkedAdd(itemsCollected, event.quantity, 'itemsCollected');
        }
        break;
      case 'trade.bought':
        itemsCollected = checkedAdd(itemsCollected, event.quantity, 'itemsCollected');
        currencySpent = checkedAdd(currencySpent, event.total, 'currencySpent');
        break;
      case 'item.identified':
        itemsIdentified = checkedAdd(itemsIdentified, 1, 'itemsIdentified');
        break;
      case 'trade.sold':
        currencyEarned = checkedAdd(currencyEarned, event.total, 'currencyEarned');
        break;
      case 'trade.service-purchased':
        currencySpent = checkedAdd(currencySpent, event.price, 'currencySpent');
        break;
      case 'trade.closed':
        if (event.completedCommerce)
          tradesCompleted = checkedAdd(tradesCompleted, 1, 'tradesCompleted');
        break;
      case 'feature.revealed':
        if (event.actorId === heroId)
          discoveriesRevealed = checkedAdd(discoveriesRevealed, 1, 'discoveriesRevealed');
        break;
      case 'rest.completed':
        restsCompleted = checkedAdd(restsCompleted, 1, 'restsCompleted');
        break;
      default:
        break;
    }
  }

  const turnsElapsed = input.turnAdvanced
    ? checkedAdd(metrics.turnsElapsed, 1, 'turnsElapsed')
    : metrics.turnsElapsed;

  return {
    kills,
    killsByModel,
    bossKills,
    championKills,
    echoKills,
    threatDefeated,
    damageDealt,
    damageTaken,
    itemsCollected,
    itemsIdentified,
    currencyEarned,
    currencySpent,
    tradesCompleted,
    floorsEntered: metrics.floorsEntered,
    deepestDepth: metrics.deepestDepth,
    discoveriesRevealed,
    turnsElapsed,
    restsCompleted,
  };
}

/** Records a floor transition: `floorsEntered` counts every entry, `deepestDepth` is the high-water mark. */
export function recordFloorEntered(run: ActiveRun, depth: number): ActiveRun {
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new RangeError('recordFloorEntered depth must be a non-negative safe integer');
  }
  return {
    ...run,
    metrics: {
      ...run.metrics,
      floorsEntered: checkedAdd(run.metrics.floorsEntered, 1, 'floorsEntered'),
      deepestDepth: Math.max(run.metrics.deepestDepth, depth),
    },
  };
}
