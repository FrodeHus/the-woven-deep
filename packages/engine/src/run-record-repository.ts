import type { CompiledContentPack } from '@woven-deep/content';
import {
  applyArtifactDeltas as foldArtifactDeltas,
  emptyArtifactLedger,
  reconcileArtifactLedger,
  undiscoveredArtifactIds,
  type ArtifactDeltas,
  type ArtifactLedger,
} from './artifact-ledger.js';
import { artifactItemIds } from './commerce.js';
import type { OpaqueId } from './model.js';
import type { NewRunRecordsInput } from './new-run.js';
import type { DiscoveryProtectionBonus } from './population-gates.js';
import type { FallenHeroStandingSnapshot } from './population-model.js';
import type {
  HeartLineageRecord,
  LifetimeDeltas,
  LifetimeState,
  StoredHallRecord,
} from './run-records-model.js';
import { emptyRunMetrics, type RunMetrics } from './run-metrics.js';
import { compareHallRecords } from './score-run.js';
import { compareCodeUnits } from './stable-json.js';

/**
 * The most Hall standings anything may carry: `standingsFromRecords` caps its output here, and
 * `createNewRun`/`validateActiveRun` reject a run seeded with more. Exported so every host — the
 * server's SQLite Hall, the guest's session-storage Hall — caps against this one definition
 * instead of its own copy.
 */
export const MAX_STANDINGS = 10;

/**
 * Recursively deep-copies and deep-freezes a value. Arrays and plain objects are cloned
 * recursively; primitives are returned as-is. No special handling for functions or non-plain objects.
 */
function deepFreezeCopy<T>(value: T): T {
  // Primitives: return as-is
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Arrays: clone and recursively deep-freeze each element
  if (Array.isArray(value)) {
    const cloned = value.map((item: unknown) => deepFreezeCopy(item)) as T;
    return Object.freeze(cloned);
  }

  // Plain objects: clone properties and recursively deep-freeze each value
  const cloned = {} as T;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      (cloned as Record<string, unknown>)[key] = deepFreezeCopy(value[key]);
    }
  }
  return Object.freeze(cloned);
}

function checkedAdd(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${label} exceeds safe integer arithmetic`);
  }
  return sum;
}

/**
 * Merges this run's metrics into the lifetime totals additively (checked-integer arithmetic),
 * except `deepestDepth`, which is a high-water mark across every applied run.
 */
function mergeMetrics(totals: RunMetrics, delta: RunMetrics): RunMetrics {
  return {
    kills: checkedAdd(totals.kills, delta.kills, 'kills'),
    killsByModel: {
      individual: checkedAdd(
        totals.killsByModel.individual,
        delta.killsByModel.individual,
        'killsByModel.individual',
      ),
      group: checkedAdd(totals.killsByModel.group, delta.killsByModel.group, 'killsByModel.group'),
      swarm: checkedAdd(totals.killsByModel.swarm, delta.killsByModel.swarm, 'killsByModel.swarm'),
      boss: checkedAdd(totals.killsByModel.boss, delta.killsByModel.boss, 'killsByModel.boss'),
    },
    bossKills: checkedAdd(totals.bossKills, delta.bossKills, 'bossKills'),
    defeatedBossMonsterIds: mergedSortedUnion(
      totals.defeatedBossMonsterIds,
      delta.defeatedBossMonsterIds,
    ),
    championKills: checkedAdd(totals.championKills, delta.championKills, 'championKills'),
    echoKills: checkedAdd(totals.echoKills, delta.echoKills, 'echoKills'),
    threatDefeated: checkedAdd(totals.threatDefeated, delta.threatDefeated, 'threatDefeated'),
    damageDealt: checkedAdd(totals.damageDealt, delta.damageDealt, 'damageDealt'),
    damageTaken: checkedAdd(totals.damageTaken, delta.damageTaken, 'damageTaken'),
    itemsCollected: checkedAdd(totals.itemsCollected, delta.itemsCollected, 'itemsCollected'),
    itemsIdentified: checkedAdd(totals.itemsIdentified, delta.itemsIdentified, 'itemsIdentified'),
    currencyEarned: checkedAdd(totals.currencyEarned, delta.currencyEarned, 'currencyEarned'),
    currencySpent: checkedAdd(totals.currencySpent, delta.currencySpent, 'currencySpent'),
    tradesCompleted: checkedAdd(totals.tradesCompleted, delta.tradesCompleted, 'tradesCompleted'),
    floorsEntered: checkedAdd(totals.floorsEntered, delta.floorsEntered, 'floorsEntered'),
    deepestDepth: Math.max(totals.deepestDepth, delta.deepestDepth),
    discoveriesRevealed: checkedAdd(
      totals.discoveriesRevealed,
      delta.discoveriesRevealed,
      'discoveriesRevealed',
    ),
    turnsElapsed: checkedAdd(totals.turnsElapsed, delta.turnsElapsed, 'turnsElapsed'),
    restsCompleted: checkedAdd(totals.restsCompleted, delta.restsCompleted, 'restsCompleted'),
  };
}

function mergedSortedUnion(
  existing: readonly OpaqueId[],
  additions: readonly OpaqueId[],
): readonly OpaqueId[] {
  return [...new Set([...existing, ...additions])].sort(compareCodeUnits);
}

function mergedDiscoveryProtection(
  existing: readonly DiscoveryProtectionBonus[],
  updates: LifetimeDeltas['discoveryProtectionUpdates'],
): readonly DiscoveryProtectionBonus[] {
  const byEncounterId = new Map(existing.map((bonus) => [bonus.encounterId, bonus.bonus]));
  for (const update of updates) {
    byEncounterId.set(update.encounterId, update.nextBonus);
  }
  return [...byEncounterId.entries()]
    .map(([encounterId, bonus]): DiscoveryProtectionBonus => ({ encounterId, bonus }))
    .sort((left, right) => compareCodeUnits(left.encounterId, right.encounterId));
}

/**
 * Ranks only `died` records with a positive death depth by `compareHallRecords`, caps the result
 * at `Math.min(limit, 10)`, and assigns contiguous ranks from 1. Conquered (non-`died`) records
 * never enter the standings, regardless of score — promotion into the Hall of the Fallen is
 * decided at run creation (4B1), not here.
 */
export function standingsFromRecords(
  records: readonly StoredHallRecord[],
  limit: number,
): readonly FallenHeroStandingSnapshot[] {
  const eligible = records.filter(
    (record) => record.completionType === 'died' && record.cause.depth >= 1,
  );
  const sorted = [...eligible].sort(compareHallRecords);
  const capped = sorted.slice(0, Math.max(0, Math.min(limit, MAX_STANDINGS)));
  return capped.map((record, index): FallenHeroStandingSnapshot => ({
    rank: index + 1,
    hallRecordId: record.recordId,
    heroName: record.heroName,
    portraitGlyph: record.enrichment.portraitGlyph,
    classTags: record.classTags,
    attributes: record.build.attributes,
    equippedItemContentIds: record.build.equippedItemContentIds,
    signatureAbilityIds: record.build.signatureAbilityIds,
    deathDepth: record.cause.depth,
    sourceContentHash: record.contentHash,
    heirloom: record.heirloom,
  }));
}

export interface RunRecordRepository {
  standings(limit: number): readonly FallenHeroStandingSnapshot[];
  records(): readonly StoredHallRecord[];
  appendRecord(stored: StoredHallRecord): void;
  currentHeart(): HeartLineageRecord | null;
  recordHeart(record: HeartLineageRecord): void;
  lifetime(): LifetimeState;
  applyDeltas(deltas: LifetimeDeltas): void;
  /** The profile's artifact ledger, already reconciled against the current standings. */
  artifactLedger(): ArtifactLedger;
  /**
   * Folds one run's artifact stints onto the ledger — idempotent by `deltas.recordId` — and then
   * reconciles, so an artifact whose holder just fell out of the Hall is released in the same
   * call. Deltas must be applied BEFORE reconciling (see `reconcileArtifactLedger`), which is
   * why this is a single repository operation rather than two.
   */
  applyArtifactDeltas(deltas: ArtifactDeltas): void;
}

/**
 * In-memory `RunRecordRepository`: the Hall is immutable append-only (frozen copies, duplicate
 * record IDs rejected — including a mutated re-append of an existing ID), the Heart is a single
 * most-recent-wins slot, and `applyDeltas` is idempotent via an applied-`recordId` set. This
 * module is engine-adjacent pure TypeScript with no Node-only APIs and no clocks, so the browser
 * boundary stays intact. Milestones 5–6 (guest and profile persistence) replace this
 * implementation behind the same interface; the server never accepts records or scores from the
 * browser.
 */
export function createInMemoryRunRecordRepository(): RunRecordRepository {
  const hall: StoredHallRecord[] = [];
  const appliedDeltaRecordIds = new Set<OpaqueId>();
  const appliedArtifactRecordIds = new Set<OpaqueId>();
  let heart: HeartLineageRecord | null = null;
  let artifactLedger: ArtifactLedger = emptyArtifactLedger();
  let lifetime: LifetimeState = {
    conqueredChampionRecordIds: [],
    grantedAchievementIds: [],
    discoveryProtection: [],
    totals: emptyRunMetrics(),
  };

  /** Standings membership is what decides whether a lost artifact is released, so reconcile runs
   * on every event that can change it: a Hall append, and each applied batch of artifact deltas. */
  function reconcile(): void {
    artifactLedger = reconcileArtifactLedger({
      ledger: artifactLedger,
      standings: standingsFromRecords(hall, MAX_STANDINGS),
      lifetime,
    });
  }

  return {
    standings(limit) {
      return standingsFromRecords(hall, limit);
    },
    records() {
      return Object.freeze([...hall]);
    },
    appendRecord(stored) {
      if (hall.some((existing) => existing.recordId === stored.recordId)) {
        throw new Error(
          `the immutable append-only Hall already contains record ${stored.recordId}`,
        );
      }
      hall.push(deepFreezeCopy(stored));
      reconcile();
    },
    currentHeart() {
      return heart;
    },
    recordHeart(record) {
      heart = deepFreezeCopy(record);
    },
    lifetime() {
      return lifetime;
    },
    applyDeltas(deltas) {
      if (appliedDeltaRecordIds.has(deltas.recordId)) return;
      appliedDeltaRecordIds.add(deltas.recordId);
      lifetime = {
        conqueredChampionRecordIds: mergedSortedUnion(
          lifetime.conqueredChampionRecordIds,
          deltas.newlyConqueredChampionRecordIds,
        ),
        grantedAchievementIds: mergedSortedUnion(
          lifetime.grantedAchievementIds,
          deltas.achievementGrants.map((grant) => grant.achievementId),
        ),
        discoveryProtection: mergedDiscoveryProtection(
          lifetime.discoveryProtection,
          deltas.discoveryProtectionUpdates,
        ),
        totals: mergeMetrics(lifetime.totals, deltas.metrics),
      };
    },
    artifactLedger() {
      return artifactLedger;
    },
    applyArtifactDeltas(deltas) {
      if (appliedArtifactRecordIds.has(deltas.recordId)) return;
      // Fold before marking applied: a batch rejected by the ledger's invariant checks must not
      // burn its recordId, or a corrected retry would silently no-op.
      artifactLedger = foldArtifactDeltas(artifactLedger, deltas);
      appliedArtifactRecordIds.add(deltas.recordId);
      reconcile();
    },
  };
}

/**
 * The player's cross-run history in the exact shape `createNewRun` takes, read off any
 * `RunRecordRepository`: the Hall standings that become this run's champion/Echo encounters, the
 * artifacts still unsecured (the vault-offer pool), and the champions already conquered.
 *
 * The ONE builder both hosts use (the server's SQLite Hall and the guest's session-storage Hall
 * both implement `RunRecordRepository`), so the two can never drift apart on the standings cap or
 * on which ledger entries count as offerable. Cheap and side-effect-free: call it per run
 * creation rather than caching, so a run started after a finalize sees that finalize's record.
 */
export function newRunRecords(
  repository: RunRecordRepository,
  content: CompiledContentPack,
): NewRunRecordsInput {
  return {
    standings: repository.standings(MAX_STANDINGS),
    undiscoveredArtifactIds: undiscoveredArtifactIds(
      repository.artifactLedger(),
      artifactItemIds(content),
    ),
    conqueredChampionRecordIds: repository.lifetime().conqueredChampionRecordIds,
  };
}
