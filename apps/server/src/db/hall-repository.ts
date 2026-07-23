import type Database from 'better-sqlite3';
import {
  createInMemoryRunRecordRepository,
  standingsFromRecords,
  type AchievementGrant,
  type FallenHeroStandingSnapshot,
  type HeartLineageRecord,
  type LifetimeDeltas,
  type LifetimeState,
  type RunRecordRepository,
  type StoredHallRecord,
} from '@woven-deep/engine';

interface HallRecordRow {
  profile_id: string;
  record_id: string;
  seq: number;
  record_json: string;
  achieved_at: string;
}

interface HallStateRow {
  profile_id: string;
  lifetime_json: string;
  heart_json: string | null;
  unlocks_json: string;
  achievements_json: string;
  updated_at: string;
}

/**
 * `hall_state.lifetime_json` stores the full applied-deltas history rather than the
 * derived `LifetimeState` directly: idempotency + the merge math both stay owned by the
 * engine's `createInMemoryRunRecordRepository`, which is replayed to derive `lifetime()`
 * and to decide whether an incoming delta's `recordId` has already been applied. This
 * mirrors the in-memory reference's `appliedDeltaRecordIds` set without re-implementing
 * `mergeMetrics`/`mergedSortedUnion` server-side.
 */
interface LifetimeEnvelope {
  readonly appliedDeltas: readonly LifetimeDeltas[];
}

const EMPTY_LIFETIME_ENVELOPE: LifetimeEnvelope = { appliedDeltas: [] };

function deriveLifetime(envelope: LifetimeEnvelope): LifetimeState {
  const repo = createInMemoryRunRecordRepository();
  for (const delta of envelope.appliedDeltas) {
    repo.applyDeltas(delta);
  }
  return repo.lifetime();
}

export interface ServerRunRecordRepositoryOptions {
  readonly database: Database.Database;
  readonly profileId: string;
  readonly clock?: () => string;
}

/**
 * SQLite-backed `RunRecordRepository`, scoped to a single profile. Faithfully matches the
 * semantics of the engine's `createInMemoryRunRecordRepository` (the reference the guest
 * client uses): the Hall is append-only with duplicate `record_id` rejected using the exact
 * same error message, standings reuse the engine's `standingsFromRecords`, and
 * `applyDeltas` is idempotent by replaying the persisted delta history through the engine's
 * in-memory repository (see `LifetimeEnvelope` above) rather than re-implementing the merge.
 */
export class ServerRunRecordRepository implements RunRecordRepository {
  private readonly profileId: string;
  private readonly clock: () => string;
  private readonly selectRecordsStatement;
  private readonly selectRecordByIdStatement;
  private readonly maxSeqStatement;
  private readonly insertRecordStatement;
  private readonly selectStateStatement;
  private readonly upsertStateStatement;

  constructor(options: ServerRunRecordRepositoryOptions) {
    this.profileId = options.profileId;
    this.clock = options.clock ?? (() => new Date().toISOString());
    const database = options.database;

    this.selectRecordsStatement = database.prepare(
      'select * from hall_records where profile_id = ? order by seq asc',
    );
    this.selectRecordByIdStatement = database.prepare(
      'select * from hall_records where profile_id = ? and record_id = ?',
    );
    this.maxSeqStatement = database.prepare(
      'select max(seq) as maxSeq from hall_records where profile_id = ?',
    );
    this.insertRecordStatement = database.prepare(`
      insert into hall_records(profile_id, record_id, seq, record_json, achieved_at)
      values (?, ?, ?, ?, ?)
    `);
    this.selectStateStatement = database.prepare('select * from hall_state where profile_id = ?');
    this.upsertStateStatement = database.prepare(`
      insert into hall_state(profile_id, lifetime_json, heart_json, unlocks_json, achievements_json, updated_at)
      values (@profileId, @lifetimeJson, @heartJson, @unlocksJson, @achievementsJson, @updatedAt)
      on conflict(profile_id) do update set
        lifetime_json = excluded.lifetime_json,
        heart_json = excluded.heart_json,
        unlocks_json = excluded.unlocks_json,
        achievements_json = excluded.achievements_json,
        updated_at = excluded.updated_at
    `);
  }

  private readAllRecords(): readonly StoredHallRecord[] {
    const rows = this.selectRecordsStatement.all(this.profileId) as HallRecordRow[];
    return rows.map((row) => JSON.parse(row.record_json) as StoredHallRecord);
  }

  private readState(): HallStateRow | undefined {
    return this.selectStateStatement.get(this.profileId) as HallStateRow | undefined;
  }

  private writeState(
    partial: Partial<{
      lifetimeEnvelope: LifetimeEnvelope;
      heart: HeartLineageRecord | null;
      unlocksJson: string;
      achievementsJson: string;
    }>,
  ): void {
    const existing = this.readState();
    const lifetimeJson = partial.lifetimeEnvelope
      ? JSON.stringify(partial.lifetimeEnvelope)
      : (existing?.lifetime_json ?? JSON.stringify(EMPTY_LIFETIME_ENVELOPE));
    const heartJson =
      partial.heart !== undefined
        ? partial.heart === null
          ? null
          : JSON.stringify(partial.heart)
        : (existing?.heart_json ?? null);
    const unlocksJson = partial.unlocksJson ?? existing?.unlocks_json ?? '[]';
    const achievementsJson = partial.achievementsJson ?? existing?.achievements_json ?? '[]';

    this.upsertStateStatement.run({
      profileId: this.profileId,
      lifetimeJson,
      heartJson,
      unlocksJson,
      achievementsJson,
      updatedAt: this.clock(),
    });
  }

  standings(limit: number): readonly FallenHeroStandingSnapshot[] {
    return standingsFromRecords(this.readAllRecords(), limit);
  }

  records(): readonly StoredHallRecord[] {
    return Object.freeze(this.readAllRecords());
  }

  appendRecord(stored: StoredHallRecord): void {
    const duplicate = this.selectRecordByIdStatement.get(this.profileId, stored.recordId);
    if (duplicate) {
      throw new Error(`the immutable append-only Hall already contains record ${stored.recordId}`);
    }
    const maxSeqRow = this.maxSeqStatement.get(this.profileId) as { maxSeq: number | null };
    const nextSeq = (maxSeqRow.maxSeq ?? 0) + 1;
    this.insertRecordStatement.run(
      this.profileId,
      stored.recordId,
      nextSeq,
      JSON.stringify(stored),
      stored.enrichment.achievedAt,
    );
  }

  currentHeart(): HeartLineageRecord | null {
    const state = this.readState();
    if (!state?.heart_json) return null;
    return JSON.parse(state.heart_json) as HeartLineageRecord;
  }

  recordHeart(record: HeartLineageRecord): void {
    this.writeState({ heart: record });
  }

  lifetime(): LifetimeState {
    const state = this.readState();
    const envelope: LifetimeEnvelope = state
      ? (JSON.parse(state.lifetime_json) as LifetimeEnvelope)
      : EMPTY_LIFETIME_ENVELOPE;
    return deriveLifetime(envelope);
  }

  applyDeltas(deltas: LifetimeDeltas): void {
    const state = this.readState();
    const envelope: LifetimeEnvelope = state
      ? (JSON.parse(state.lifetime_json) as LifetimeEnvelope)
      : EMPTY_LIFETIME_ENVELOPE;

    if (envelope.appliedDeltas.some((applied) => applied.recordId === deltas.recordId)) {
      return;
    }

    const nextEnvelope: LifetimeEnvelope = {
      appliedDeltas: [...envelope.appliedDeltas, deltas],
    };
    this.writeState({ lifetimeEnvelope: nextEnvelope });
  }

  /** The profile's currently unlocked (content-locked-by-default) class ids, as last evaluated by
   * `evaluateUnlocks` — a full replacement each call, never merged, since the caller always
   * recomputes the complete set from the profile's full Hall records + lifetime state. */
  unlocks(): readonly string[] {
    const state = this.readState();
    return state ? (JSON.parse(state.unlocks_json) as string[]) : [];
  }

  setUnlocks(unlocks: readonly string[]): void {
    this.writeState({ unlocksJson: JSON.stringify(unlocks) });
  }

  /** The profile's lifetime-accumulated achievement grants (richer than
   * `lifetime().grantedAchievementIds` — carries the display name + criteria alongside the id). */
  achievements(): readonly AchievementGrant[] {
    const state = this.readState();
    return state ? (JSON.parse(state.achievements_json) as AchievementGrant[]) : [];
  }

  /** Merges newly-granted achievements into the persisted lifetime set, deduplicated by
   * `achievementId` and sorted for a stable, deterministic on-disk representation. A no-op when
   * every grant is already present (e.g. a re-finalize guarded elsewhere never reaches here, but
   * this stays safe to call defensively). */
  appendAchievements(grants: readonly AchievementGrant[]): void {
    if (grants.length === 0) return;
    const existing = this.achievements();
    const existingIds = new Set(existing.map((grant) => grant.achievementId));
    const additions = grants.filter((grant) => !existingIds.has(grant.achievementId));
    if (additions.length === 0) return;
    const merged = [...existing, ...additions].sort((left, right) =>
      left.achievementId < right.achievementId
        ? -1
        : left.achievementId > right.achievementId
          ? 1
          : 0,
    );
    this.writeState({ achievementsJson: JSON.stringify(merged) });
  }
}
