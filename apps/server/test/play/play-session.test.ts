import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { decodeActiveRun, encodeActiveRun, type Uint32State } from '@woven-deep/engine';
import { runMigrations } from '../../src/database.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
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

function freshRepo(): ActiveRunRepository {
  const database = new Database(':memory:');
  runMigrations(database);
  // active_runs.profile_id has a FK to profiles(id) — seed the owning profile.
  new ProfileRepository(database).create({
    id: PROFILE,
    normalizedEmail: 'profile-1@example.com',
    nowIso: FIXED_CLOCK(),
  });
  return new ActiveRunRepository(database);
}

function newSession(repo: ActiveRunRepository): ServerPlaySession {
  return new ServerPlaySession({ pack, repo, profileId: PROFILE, clock: FIXED_CLOCK });
}

describe('ServerPlaySession', () => {
  let repo: ActiveRunRepository;

  beforeEach(() => {
    repo = freshRepo();
  });

  it('creates and immediately persists a fresh run on open', () => {
    const snapshot = newSession(repo).open({ seed: SEED });
    const stored = repo.get(PROFILE);
    expect(stored).toBeDefined();
    expect(stored!.contentHash).toBe(pack.hash);
    expect(stored!.revision).toBe(snapshot.revision);
    expect(snapshot.conclusion).toBeNull();
    expect(snapshot.pendingDecision).toBeNull();
  });

  it('rehydrates a stored run byte-identically on a second open', () => {
    newSession(repo).open({ seed: SEED });
    const storedBlob = repo.get(PROFILE)!.runBlob;

    const rehydrated = newSession(repo).open({ seed: SEED });
    // The stored blob decodes to the same revision the rehydrated session reports, and re-encoding
    // the decoded run is byte-identical (no drift through decode/encode).
    expect(rehydrated.revision).toBe(decodeActiveRun(storedBlob).revision);
    expect(encodeActiveRun(decodeActiveRun(storedBlob))).toBe(storedBlob);
  });

  it('persists immediately on a consequential (non-move) command', () => {
    const session = newSession(repo);
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
    const session = newSession(repo);
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
    const session = newSession(repo);
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
    const session = newSession(repo);
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
    expect(() => newSession(repo).open({ seed: SEED })).toThrow(ContentHashMismatchError);
  });
});
