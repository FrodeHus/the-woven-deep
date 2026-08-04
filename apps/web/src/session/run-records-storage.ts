import {
  applyArtifactDeltas as foldArtifactDeltas,
  emptyArtifactLedger,
  normalizeStoredMetrics,
  reconcileArtifactLedger,
  standingsFromRecords,
  MAX_STANDINGS,
  type ArtifactDeltas,
  type ArtifactLedger,
  type DiscoveryProtectionBonus,
  type DiscoveryProtectionUpdate,
  type HeartLineageRecord,
  type LifetimeState,
  type OpaqueId,
  type RunMetrics,
  type RunRecordRepository,
  type StoredHallRecord,
} from '@woven-deep/engine';
import type { SessionStorageLike } from './storage.js';

/** Where the guest's session-scoped Hall of Records lives in storage. */
export const RECORDS_KEY = 'woven-deep.guest-hall';

/** Thrown when the blob under `RECORDS_KEY` cannot be trusted (corrupt JSON or the wrong shape).
 * The repository clears the key back to a fresh, empty Hall before throwing, so a subsequent
 * construction over the same storage always succeeds — the caller surfaces this as a notice while
 * the active run (an entirely separate storage key) survives untouched. */
export class SessionHallCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionHallCorruptError';
  }
}

/**
 * Stamps the shape of the persisted blob under `RECORDS_KEY` (and, transitively, the
 * `RunMetrics` shape `lifetime.totals` and each stored record's `metrics` were written with).
 * A legacy blob with no `version` is treated as version 0 (the oldest); either way, every
 * metrics-bearing field is normalized via the engine's `normalizeStoredMetrics` on load, so a
 * `RunMetrics` field added after this blob was written never breaks the guest's merge math —
 * future field additions only extend that (idempotent) normalizer, never a bespoke migration
 * step here.
 *
 * Bumped to 3 for `RecordedHeirloomSnapshot.curse` (engine save schema v14): unlike `RunMetrics`
 * fields, `curse` is not normalized generically, since it is required-but-nullable rather than
 * additive — every stored record's `heirloom.curse` is defaulted to `null` in
 * `migratePersistedState` below.
 *
 * Bumped to 4 for `HallRecord.deathInventory` (engine save schema v16, haunts): version-3-and-
 * earlier blobs predate the equipped-set capture entirely, so every stored record's
 * `deathInventory` is defaulted to `[heirloom]` in `migratePersistedState` below — the heirloom is
 * the one recorded item, so it becomes the whole death inventory.
 */
const HALL_STORE_VERSION = 5;

interface PersistedHallState {
  readonly version: number;
  readonly records: readonly StoredHallRecord[];
  readonly heart: HeartLineageRecord | null;
  readonly lifetime: LifetimeState;
  readonly appliedDeltaRecordIds: readonly OpaqueId[];
  readonly artifactLedger: ArtifactLedger;
  readonly appliedArtifactRecordIds: readonly OpaqueId[];
}

/** What a parsed blob is allowed to be before migration: a version-1 blob predates the artifact
 * ledger entirely and a version-4-and-earlier blob predates cross-run tablet assembly, so those
 * keys are optional on the way in and always present on the way out. */
type ParsedHallState = Omit<
  PersistedHallState,
  'artifactLedger' | 'appliedArtifactRecordIds' | 'lifetime'
> &
  Partial<Pick<PersistedHallState, 'artifactLedger' | 'appliedArtifactRecordIds'>> & {
    readonly lifetime: Omit<LifetimeState, 'collectedFragmentIds'> &
      Partial<Pick<LifetimeState, 'collectedFragmentIds'>>;
  };

function emptyLifetimeMetrics(): RunMetrics {
  return {
    kills: 0,
    killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
    bossKills: 0,
    defeatedBossMonsterIds: [],
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

function emptyPersistedState(): PersistedHallState {
  return {
    version: HALL_STORE_VERSION,
    records: [],
    heart: null,
    lifetime: {
      conqueredChampionRecordIds: [],
      grantedAchievementIds: [],
      discoveryProtection: [],
      collectedFragmentIds: [],
      totals: emptyLifetimeMetrics(),
    },
    appliedDeltaRecordIds: [],
    artifactLedger: emptyArtifactLedger(),
    appliedArtifactRecordIds: [],
  };
}

/** Migrates a just-parsed, structurally-valid `PersistedHallState` to the current `RunMetrics`
 * shape: normalizes `lifetime.totals` (the running merge base future deltas fold into) and every
 * stored record's `metrics`. A no-op for already-complete data (current writes), since
 * `normalizeStoredMetrics` is idempotent. */
function migratePersistedState(state: ParsedHallState): PersistedHallState {
  return {
    ...state,
    version: HALL_STORE_VERSION,
    artifactLedger: state.artifactLedger ?? emptyArtifactLedger(),
    appliedArtifactRecordIds: state.appliedArtifactRecordIds ?? [],
    records: state.records.map((record) => ({
      ...record,
      metrics: normalizeStoredMetrics(record.metrics),
      // Version-2-and-earlier blobs predate `curse` entirely (no key at all). Required-but-nullable
      // on the engine type, so it needs an explicit default rather than the metrics normalizer's
      // generic field-fill. Guarded against a malformed (non-object) `heirloom` — this loose
      // migration step must not be where that surfaces; it still fails loudly the first time the
      // record is actually used, same as every other malformed field this migration doesn't touch.
      heirloom:
        record.heirloom !== null && typeof record.heirloom === 'object'
          ? { ...record.heirloom, curse: record.heirloom.curse ?? null }
          : record.heirloom,
      // Version-3-and-earlier blobs predate the equipped-set capture entirely. The heirloom is the
      // one recorded item, so it becomes the whole death inventory -- the same defaulting the
      // engine's v15->v16 save migration applies to standings, kept in step deliberately.
      deathInventory: Array.isArray(record.deathInventory)
        ? record.deathInventory
        : record.heirloom !== null && typeof record.heirloom === 'object'
          ? [record.heirloom]
          : [],
    })),
    lifetime: {
      ...state.lifetime,
      // Version-4-and-earlier blobs predate banked tablet fragments (no key at all): nobody had
      // banked one before the store could hold them, which is exactly the empty list.
      collectedFragmentIds: state.lifetime.collectedFragmentIds ?? [],
      totals: normalizeStoredMetrics(state.lifetime.totals),
    },
  };
}

/**
 * Recursively deep-copies and deep-freezes a value — mirrors `deepFreezeCopy` in the engine's
 * `run-record-repository.ts` (not exported from `@woven-deep/engine`, so duplicated here rather
 * than reaching into the package's internals).
 */
function deepFreezeCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const cloned = value.map((item: unknown) => deepFreezeCopy(item)) as T;
    return Object.freeze(cloned);
  }
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

/** Mirrors the engine's `mergeMetrics` (run-record-repository.ts, not exported): additive merge
 * of this run's metrics into the lifetime totals, except `deepestDepth`, a high-water mark. */
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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergedSortedUnion(
  existing: readonly OpaqueId[],
  additions: readonly OpaqueId[],
): readonly OpaqueId[] {
  return [...new Set([...existing, ...additions])].sort(compareCodeUnits);
}

function mergedDiscoveryProtection(
  existing: readonly DiscoveryProtectionBonus[],
  updates: readonly DiscoveryProtectionUpdate[],
): readonly DiscoveryProtectionBonus[] {
  const byEncounterId = new Map(existing.map((bonus) => [bonus.encounterId, bonus.bonus]));
  for (const update of updates) {
    byEncounterId.set(update.encounterId, update.nextBonus);
  }
  return [...byEncounterId.entries()]
    .map(([encounterId, bonus]): DiscoveryProtectionBonus => ({ encounterId, bonus }))
    .sort((left, right) => compareCodeUnits(left.encounterId, right.encounterId));
}

/** Narrow, non-exhaustive shape check: enough to reject a corrupt/foreign blob without trying to
 * fully re-validate every `StoredHallRecord` field (the engine itself is the source of truth for
 * those; a malformed record that slips through fails loudly the first time it's actually used). */
function isValidPersistedState(value: unknown): value is ParsedHallState {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate['records'])) return false;
  if (candidate['heart'] !== null && typeof candidate['heart'] !== 'object') return false;
  const lifetime = candidate['lifetime'];
  if (lifetime === null || typeof lifetime !== 'object') return false;
  const lifetimeRecord = lifetime as Record<string, unknown>;
  if (!Array.isArray(lifetimeRecord['conqueredChampionRecordIds'])) return false;
  if (!Array.isArray(lifetimeRecord['grantedAchievementIds'])) return false;
  if (!Array.isArray(lifetimeRecord['discoveryProtection'])) return false;
  if (lifetimeRecord['totals'] === null || typeof lifetimeRecord['totals'] !== 'object')
    return false;
  if (!Array.isArray(candidate['appliedDeltaRecordIds'])) return false;
  // Version-1 blobs predate both keys; absent is migrated, present-but-wrong-shape is corrupt.
  if (candidate['artifactLedger'] !== undefined && !Array.isArray(candidate['artifactLedger']))
    return false;
  if (
    candidate['appliedArtifactRecordIds'] !== undefined &&
    !Array.isArray(candidate['appliedArtifactRecordIds'])
  )
    return false;
  return true;
}

/**
 * A `RunRecordRepository` backed by a keyed `SessionStorageLike`: every mutation re-serializes
 * `{ records, heart, lifetime, appliedDeltaRecordIds }` under `RECORDS_KEY` in full (this is a
 * guest session's Hall, not a growth-bound store — sizes stay small). Behaviorally mirrors
 * `createInMemoryRunRecordRepository` (append-only immutability via deep-freeze, duplicate-ID
 * rejection, delta idempotence via an applied-record-ID set) so the two can be swapped without
 * changing caller expectations; only the persistence boundary differs.
 */
export function createSessionRunRecordRepository(storage: SessionStorageLike): RunRecordRepository {
  const raw = storage.get(RECORDS_KEY);
  let state: PersistedHallState;
  if (raw === null) {
    state = emptyPersistedState();
  } else {
    let parsed: unknown;
    let valid = false;
    try {
      parsed = JSON.parse(raw);
      valid = isValidPersistedState(parsed);
    } catch {
      valid = false;
    }
    if (!valid) {
      storage.set(RECORDS_KEY, JSON.stringify(emptyPersistedState()));
      throw new SessionHallCorruptError(
        'the stored Hall of Records blob is corrupt and has been reset',
      );
    }
    state = migratePersistedState(parsed as ParsedHallState);
  }

  const hall: StoredHallRecord[] = [...state.records];
  const appliedDeltaRecordIds = new Set<OpaqueId>(state.appliedDeltaRecordIds);
  const appliedArtifactRecordIds = new Set<OpaqueId>(state.appliedArtifactRecordIds);
  let heart: HeartLineageRecord | null = state.heart;
  let lifetime: LifetimeState = state.lifetime;
  let artifactLedger: ArtifactLedger = state.artifactLedger;

  /** Mirrors the engine reference: reconcile on every event that can change standings membership
   * — a Hall append, and each applied batch of artifact deltas. */
  function reconcile(): void {
    artifactLedger = reconcileArtifactLedger({
      ledger: artifactLedger,
      standings: standingsFromRecords(hall, MAX_STANDINGS),
      lifetime,
    });
  }

  function persist(): void {
    const toPersist: PersistedHallState = {
      version: HALL_STORE_VERSION,
      records: hall,
      heart,
      lifetime,
      appliedDeltaRecordIds: [...appliedDeltaRecordIds],
      artifactLedger,
      appliedArtifactRecordIds: [...appliedArtifactRecordIds],
    };
    storage.set(RECORDS_KEY, JSON.stringify(toPersist));
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
      persist();
    },
    currentHeart() {
      return heart;
    },
    recordHeart(record) {
      heart = deepFreezeCopy(record);
      persist();
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
        collectedFragmentIds: mergedSortedUnion(
          lifetime.collectedFragmentIds,
          deltas.newlyCollectedFragmentIds,
        ),
        totals: mergeMetrics(lifetime.totals, deltas.metrics),
      };
      persist();
    },
    artifactLedger() {
      return artifactLedger;
    },
    applyArtifactDeltas(deltas: ArtifactDeltas) {
      if (appliedArtifactRecordIds.has(deltas.recordId)) return;
      // Fold before marking applied: a batch rejected by the ledger's invariant checks must not
      // burn its recordId, or a corrected retry would silently no-op.
      artifactLedger = foldArtifactDeltas(artifactLedger, deltas);
      appliedArtifactRecordIds.add(deltas.recordId);
      reconcile();
      persist();
    },
  };
}
