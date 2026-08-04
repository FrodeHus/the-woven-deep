import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { decodeActiveRun, DEFAULT_GUEST_HERO, type Uint32State } from '@woven-deep/engine';
import { TRAVEL_BATCH_CAP } from '@woven-deep/session-core';
import { runMigrations } from '../../src/database.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ServerPlaySession } from '../../src/play/play-session.js';

const SEED = [7, 14, 21, 28] as unknown as Uint32State;
const PROFILE = 'profile-travel';
const CLOCK = () => '2026-07-22T00:00:00.000Z';

let pack: CompiledContentPack;
let database: Database.Database;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
});

beforeEach(() => {
  database = new Database(':memory:');
  runMigrations(database);
  new ProfileRepository(database).create({
    id: PROFILE,
    normalizedEmail: 'travel@example.com',
    nowIso: CLOCK(),
  });
});

function openSession(): ServerPlaySession {
  const session = new ServerPlaySession({
    pack,
    repo: new ActiveRunRepository(database),
    hallRepo: new ServerRunRecordRepository({ database, profileId: PROFILE }),
    database,
    profileId: PROFILE,
    clock: CLOCK,
  });
  session.open({ seed: SEED, hero: DEFAULT_GUEST_HERO });
  return session;
}

const exploreRequest = {
  mode: 'explore',
  steps: [],
  onArrive: null,
  autoPickup: { allowConsumables: true },
  offeredItemIds: [],
} as const;

describe('ServerPlaySession.applyTravel', () => {
  it('applies a whole batch of steps in one call and reports one snapshot each', () => {
    const session = openSession();
    const before = session.getSnapshot().revision;
    const applied = session.applyTravel({
      commandId: 'command.profile-0000000001',
      expectedRevision: before,
      request: exploreRequest,
    });

    expect(applied.stepsTaken).toBe(TRAVEL_BATCH_CAP);
    expect(applied.snapshots).toHaveLength(TRAVEL_BATCH_CAP);
    // null: capped, not finished -- the client should ask for the next batch.
    expect(applied.reason).toBeNull();
    // One turn per snapshot, in order, so the client can animate rather than snap.
    const revisions = applied.snapshots.map((snapshot) => snapshot.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(revisions.at(-1)).toBeGreaterThan(before);
  });

  it('persists a batched walk under ids the save schema accepts', () => {
    const session = openSession();
    session.applyTravel({
      commandId: 'command.profile-0000000001',
      expectedRevision: session.getSnapshot().revision,
      request: exploreRequest,
    });
    session.flush();

    // The per-step id separator has to stay inside the save schema's id pattern; a `/` throws on
    // persist, which surfaced only as a dead connection rather than a clear error.
    const stored = new ActiveRunRepository(database).get(PROFILE);
    expect(stored).toBeDefined();
    const run = decodeActiveRun(stored!.runBlob, pack);
    const batched = run.recentCommands.filter((entry) =>
      entry.command.commandId.startsWith('command.profile-0000000001'),
    );
    expect(batched.length).toBeGreaterThan(0);
    for (const entry of batched) {
      expect(entry.command.commandId).toMatch(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
    }
  });

  it('leaves the command-sequence seeding untouched', () => {
    const session = openSession();
    session.applyTravel({
      commandId: 'command.profile-0000000007',
      expectedRevision: session.getSnapshot().revision,
      request: exploreRequest,
    });
    // Suffixed per-step ids must not be read as profile command sequences: the seeding pattern is
    // anchored and digits-only, so a batch must not advance the counter past its own id.
    expect(session.getSnapshot().nextCommandSequence).toBe(0);
  });

  it('refuses to walk a stale batch, applying nothing', () => {
    const session = openSession();
    const applied = session.applyTravel({
      commandId: 'command.profile-0000000002',
      expectedRevision: session.getSnapshot().revision + 99,
      request: exploreRequest,
    });
    expect(applied.stepsTaken).toBe(0);
    expect(applied.reason).toBe('action-invalid');
    expect(applied.snapshots).toHaveLength(1);
  });

  it('reports an empty click-travel plan as arrived without burning a turn', () => {
    const session = openSession();
    const before = session.getSnapshot().revision;
    const applied = session.applyTravel({
      commandId: 'command.profile-0000000003',
      expectedRevision: before,
      request: { mode: 'travel', steps: [], onArrive: null, autoPickup: null, offeredItemIds: [] },
    });
    expect(applied.stepsTaken).toBe(0);
    expect(applied.reason).toBe('arrived');
    expect(session.getSnapshot().revision).toBe(before);
  });
});
