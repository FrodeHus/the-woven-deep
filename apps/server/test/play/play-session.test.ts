import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  decodeActiveRun,
  encodeActiveRun,
  heroActor,
  isHeartBossActive,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type Uint32State,
} from '@woven-deep/engine';
import { runMigrations } from '../../src/database.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ContentHashMismatchError, ServerPlaySession } from '../../src/play/play-session.js';

const SEED = [7, 14, 21, 28] as unknown as Uint32State;
const PROFILE = 'profile-1';
const FIXED_CLOCK = () => '2026-07-22T00:00:00.000Z';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
});

function freshDatabase(): Database.Database {
  const database = new Database(':memory:');
  runMigrations(database);
  // active_runs.profile_id has a FK to profiles(id) — seed the owning profile.
  new ProfileRepository(database).create({
    id: PROFILE,
    normalizedEmail: 'profile-1@example.com',
    nowIso: FIXED_CLOCK(),
  });
  return database;
}

function newSession(
  database: Database.Database,
  input: Readonly<{ repo?: ActiveRunRepository; hallRepo?: ServerRunRecordRepository }> = {},
): ServerPlaySession {
  return new ServerPlaySession({
    pack,
    repo: input.repo ?? new ActiveRunRepository(database),
    hallRepo: input.hallRepo ?? new ServerRunRecordRepository({ database, profileId: PROFILE }),
    profileId: PROFILE,
    clock: FIXED_CLOCK,
  });
}

/** An `ActiveRun` that has already concluded (died) but not yet been finalized — the shape a
 * stored `active_runs` row would have if the server crashed exactly between the conclusion-
 * producing command and finalize, or the fixture used to directly test finalize-on-conclusion
 * without having to drive an actual lethal encounter through the real content pack. */
function concludedRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  const base = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  const hero = heroActor(base);
  return {
    ...base,
    // The save schema requires a `died` conclusion's hero actor to be at zero health.
    actors: base.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
    ),
    conclusion: {
      completionType: 'died',
      cause: {
        killerContentId: null,
        depth: base.metrics.deepestDepth,
        turn: base.turn,
        worldTime: base.worldTime,
      },
      concludedAtRevision: base.revision,
      finalized: false,
    },
    ...overrides,
  };
}

function storeConcludedRun(repo: ActiveRunRepository, overrides: Partial<ActiveRun> = {}): void {
  const run = concludedRun(overrides);
  repo.upsert({
    profileId: PROFILE,
    runBlob: encodeActiveRun(run),
    revision: run.revision,
    contentHash: pack.hash,
    updatedAt: FIXED_CLOCK(),
  });
}

describe('ServerPlaySession', () => {
  let database: Database.Database;
  let repo: ActiveRunRepository;

  beforeEach(() => {
    database = freshDatabase();
    repo = new ActiveRunRepository(database);
  });

  it('creates and immediately persists a fresh run on open', () => {
    const snapshot = newSession(database, { repo }).open({ seed: SEED });
    const stored = repo.get(PROFILE);
    expect(stored).toBeDefined();
    expect(stored!.contentHash).toBe(pack.hash);
    expect(stored!.revision).toBe(snapshot.revision);
    expect(snapshot.conclusion).toBeNull();
    expect(snapshot.pendingDecision).toBeNull();
  });

  it('reports bossActive as the authoritative, perception-free isHeartBossActive over the raw run -- not something the client can re-derive from the redacted projection', () => {
    // A fresh run at depth 1 has no heart-boss population yet -- isHeartBossActive(run) is false,
    // and `snapshot().bossActive` must agree (this is the same predicate the T9 review's fix
    // requires the client to trust instead of re-deriving from illumination-gated visible actors).
    const session = newSession(database, { repo });
    const snapshot = session.open({ seed: SEED });
    const stored = repo.get(PROFILE)!;
    const run = decodeActiveRun(stored.runBlob);
    expect(snapshot.bossActive).toBe(isHeartBossActive(run));
    expect(snapshot.bossActive).toBe(false);
  });

  it('rehydrates a stored run byte-identically on a second open', () => {
    newSession(database, { repo }).open({ seed: SEED });
    const storedBlob = repo.get(PROFILE)!.runBlob;

    const rehydrated = newSession(database, { repo }).open({ seed: SEED });
    // The stored blob decodes to the same revision the rehydrated session reports, and re-encoding
    // the decoded run is byte-identical (no drift through decode/encode).
    expect(rehydrated.revision).toBe(decodeActiveRun(storedBlob).revision);
    expect(encodeActiveRun(decodeActiveRun(storedBlob))).toBe(storedBlob);
  });

  it('persists immediately on a consequential (non-move) command', () => {
    const session = newSession(database, { repo });
    session.open({ seed: SEED });
    const outcome = session.applyIntent({
      commandId: 'cmd-1',
      expectedRevision: 0,
      intent: { type: 'wait' },
    });
    expect(outcome.kind).toBe('state');
    if (outcome.kind !== 'state') return;
    // A `wait` is not a plain move → immediate persist; the stored revision matches the new run.
    expect(repo.get(PROFILE)!.revision).toBe(outcome.snapshot.revision);
    expect(outcome.snapshot.revision).toBe(1);
  });

  it('rejects a stale-revision command without mutating the run', () => {
    const session = newSession(database, { repo });
    session.open({ seed: SEED });
    session.applyIntent({ commandId: 'cmd-1', expectedRevision: 0, intent: { type: 'wait' } });
    const rejected = session.applyIntent({
      commandId: 'cmd-2',
      expectedRevision: 0, // stale: the run is now at revision 1
      intent: { type: 'wait' },
    });
    expect(rejected.kind).toBe('rejected');
    expect(repo.get(PROFILE)!.revision).toBe(1);
  });

  it('is idempotent on a resent commandId (no double-apply)', () => {
    const session = newSession(database, { repo });
    session.open({ seed: SEED });
    const first = session.applyIntent({
      commandId: 'cmd-1',
      expectedRevision: 0,
      intent: { type: 'wait' },
    });
    // Resend the SAME commandId with the SAME original expectedRevision → engine idempotent replay
    // returns the cached result; the run must not advance a second time.
    const resent = session.applyIntent({
      commandId: 'cmd-1',
      expectedRevision: 0,
      intent: { type: 'wait' },
    });
    expect(first.kind).toBe('state');
    expect(resent.kind).toBe('state');
    if (first.kind === 'state' && resent.kind === 'state') {
      expect(resent.snapshot.revision).toBe(first.snapshot.revision);
    }
  });

  it('flush() persists the latest run', () => {
    const session = newSession(database, { repo });
    session.open({ seed: SEED });
    session.applyIntent({ commandId: 'cmd-1', expectedRevision: 0, intent: { type: 'wait' } });
    session.flush();
    const snapshot = session.getSnapshot();
    expect(repo.get(PROFILE)!.revision).toBe(snapshot.revision);
  });

  it('throws ContentHashMismatchError when a stored run predates the current pack', () => {
    repo.upsert({
      profileId: PROFILE,
      runBlob: 'irrelevant',
      revision: 3,
      contentHash: 'a-different-content-hash',
      updatedAt: FIXED_CLOCK(),
    });
    expect(() => newSession(database, { repo }).open({ seed: SEED })).toThrow(
      ContentHashMismatchError,
    );
  });

  describe('finalize-on-conclusion (Task 4)', () => {
    it('finalizes a concluded-but-unfinalized stored run on open(): writes exactly one Hall record, applies lifetime deltas, evaluates + persists unlocks, and clears the active run row', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });

      const snapshot = session.open({ seed: SEED });

      expect(hallRepo.records()).toHaveLength(1);
      expect(hallRepo.lifetime().totals).toEqual(hallRepo.records()[0]!.metrics);
      // Unlocks were (re-)evaluated and persisted -- an explicit `unlocks()` read never throws and
      // reflects the just-written state (empty here: this fixture's run never reaches the
      // hardcoded unlock thresholds).
      expect(hallRepo.unlocks()).toEqual([]);
      expect(repo.get(PROFILE)).toBeUndefined();

      expect(snapshot.conclusion).not.toBeNull();
      expect(snapshot.conclusion!.finalized).toBe(true);
      expect(snapshot.conclusion!.score).not.toBeNull();
      expect(snapshot.conclusion!.score).toEqual(hallRepo.records()[0]!.score);
      expect(snapshot.conclusion!.heirloom).toEqual(hallRepo.records()[0]!.heirloom);
    });

    it('a resent command after conclusion does not double-finalize (no second Hall record, no throw)', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });
      expect(hallRepo.records()).toHaveLength(1);

      // A stray resend (or a reconnect racing the finalize) must be a harmless no-op: it must NOT
      // re-invoke finalizeRun (which would append a colliding deterministic record ID and throw).
      expect(() =>
        session.applyIntent({
          commandId: 'cmd-after-conclusion',
          expectedRevision: 0,
          intent: { type: 'wait' },
        }),
      ).not.toThrow();
      expect(hallRepo.records()).toHaveLength(1);

      expect(() =>
        session.applyCommand({ type: 'wait', commandId: 'cmd-2', expectedRevision: 0 }),
      ).not.toThrow();
      expect(hallRepo.records()).toHaveLength(1);
    });

    it('reopening after conclusion (active run cleared) starts a fresh run rather than re-finalizing', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      newSession(database, { repo, hallRepo }).open({ seed: SEED });
      expect(hallRepo.records()).toHaveLength(1);

      // active_runs was cleared by the finalize -- a second `open()` (a fresh reconnect) finds no
      // stored run and creates a brand-new one, never touching the already-finalized Hall record.
      const secondSnapshot = newSession(database, { repo, hallRepo }).open({ seed: SEED });
      expect(secondSnapshot.conclusion).toBeNull();
      expect(hallRepo.records()).toHaveLength(1);
    });
  });
});
