import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  encodeActiveRun,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type Uint32State,
} from '@woven-deep/engine';
import { dispatchIntent, type PlayerIntent } from '@woven-deep/session-core';
import { runMigrations } from '../../src/database.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import { ServerPlaySession } from '../../src/play/play-session.js';

/**
 * Task 11: proves "the server runs the exact same engine as the client" by driving the SAME
 * intent sequence through two independent orchestration paths -- the client-side
 * `dispatchIntent` loop (no storage, no React -- what `GuestSession.dispatch` does, purely) and
 * `ServerPlaySession.applyIntent` (over an in-memory SQLite `ActiveRunRepository`, exactly the
 * server's real play path) -- and asserting `encodeActiveRun` is byte-identical after EVERY
 * step, not just at the end. Any divergence here means the client and server engines have
 * silently drifted, which is precisely the failure mode server-authoritative runs exists to
 * rule out.
 */

const SEED = [7, 14, 21, 28] as unknown as Uint32State;
const PROFILE = 'parity-profile';
const FIXED_CLOCK = () => '2026-07-22T00:00:00.000Z';

/** A fixed, non-trivial sequence: a mix of moves in different directions (at least one of which
 * may reject on a wall -- itself a valid parity assertion, since both sides must reject
 * identically), a rest, and a wait. Kept intentionally layout-robust: nothing here depends on
 * what tile the hero happens to stand on. */
const INTENT_SEQUENCE: readonly PlayerIntent[] = [
  { type: 'wait' },
  { type: 'move', direction: 'north' },
  { type: 'move', direction: 'east' },
  { type: 'move', direction: 'south' },
  { type: 'move', direction: 'west' },
  { type: 'wait' },
  { type: 'move', direction: 'northeast' },
  { type: 'move', direction: 'southwest' },
  { type: 'rest' },
  { type: 'wait' },
  { type: 'move', direction: 'south' },
  { type: 'move', direction: 'north' },
];

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
});

/** Threads a run + a monotonic commandId counter through `dispatchIntent`, mirroring
 * `GuestSession.dispatch`'s loop purely (no storage, no notices, no projection bookkeeping) --
 * this IS the client core side of the parity claim. Returns the resulting run for every
 * dispatch outcome kind: `command` yields `resolution.state` when applied (or the unchanged
 * `run` when invalid/rejected/decision-required), `transition` yields `outcome.run`, and
 * `rejected`/`house` both carry the (unchanged) `run` straight through. */
function driveClientCore(
  initialRun: ActiveRun,
  intents: readonly PlayerIntent[],
): readonly ActiveRun[] {
  let run = initialRun;
  let commandSequence = 0;
  const runsAfterEachIntent: ActiveRun[] = [];

  for (const intent of intents) {
    const commandId = `command.parity-${String(commandSequence).padStart(6, '0')}`;
    commandSequence += 1;
    const outcome = dispatchIntent(run, intent, {
      pack,
      commandId,
      expectedRevision: run.revision,
    });

    if (outcome.kind === 'rejected' || outcome.kind === 'house') {
      // Neither mutates the run -- `run` is already correct.
    } else if (outcome.kind === 'transition') {
      run = outcome.run;
    } else {
      // outcome.kind === 'command'
      const { result } = outcome.resolution;
      if (result.status === 'applied') {
        run = outcome.resolution.state;
      }
      // invalid / rejected / decision_required: none of them mutate the run.
    }

    runsAfterEachIntent.push(run);
  }

  return runsAfterEachIntent;
}

/** Drives the SAME intent sequence through `ServerPlaySession.applyIntent`, flushing after each
 * one so the repo blob is the authoritative persisted encoding at every step (per the brief:
 * "use the repo blob after a flush() so it's the authoritative persisted form"). Returns the
 * repo's `runBlob` after each intent. */
function driveServerSide(
  session: ServerPlaySession,
  repo: ActiveRunRepository,
  intents: readonly PlayerIntent[],
): readonly string[] {
  let commandSequence = 0;
  const blobsAfterEachIntent: string[] = [];

  for (const intent of intents) {
    const commandId = `command.parity-${String(commandSequence).padStart(6, '0')}`;
    commandSequence += 1;
    const expectedRevision = session.getSnapshot().revision;
    session.applyIntent({ commandId, expectedRevision, intent });
    session.flush();
    blobsAfterEachIntent.push(repo.get(PROFILE)!.runBlob);
  }

  return blobsAfterEachIntent;
}

function freshRepos(): {
  database: Database.Database;
  repo: ActiveRunRepository;
  hallRepo: ServerRunRecordRepository;
} {
  const database = new Database(':memory:');
  runMigrations(database);
  new ProfileRepository(database).create({
    id: PROFILE,
    normalizedEmail: 'parity-profile@example.com',
    nowIso: FIXED_CLOCK(),
  });
  return {
    database,
    repo: new ActiveRunRepository(database),
    hallRepo: new ServerRunRecordRepository({ database, profileId: PROFILE }),
  };
}

describe('cross-process determinism parity (client core vs. server play path)', () => {
  it('produces byte-identical encodeActiveRun after every intent, and at the end', () => {
    // Client core side: the same seed/hero/pack, driven purely through dispatchIntent.
    const clientInitialRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const clientRunsAfterEachIntent = driveClientCore(clientInitialRun, INTENT_SEQUENCE);
    const clientBlobsAfterEachIntent = clientRunsAfterEachIntent.map((run) => encodeActiveRun(run));

    // Server side: the same seed/hero/pack, driven through ServerPlaySession.applyIntent over an
    // in-memory SQLite repo -- the server's real play path.
    const { database, repo, hallRepo } = freshRepos();
    const session = new ServerPlaySession({
      pack,
      repo,
      hallRepo,
      database,
      profileId: PROFILE,
      clock: FIXED_CLOCK,
    });
    session.open({ seed: SEED, hero: DEFAULT_GUEST_HERO });
    const serverBlobsAfterEachIntent = driveServerSide(session, repo, INTENT_SEQUENCE);

    expect(serverBlobsAfterEachIntent).toHaveLength(clientBlobsAfterEachIntent.length);
    for (let step = 0; step < INTENT_SEQUENCE.length; step += 1) {
      expect(
        serverBlobsAfterEachIntent[step],
        `encodeActiveRun diverged after intent #${step} (${JSON.stringify(INTENT_SEQUENCE[step])})`,
      ).toBe(clientBlobsAfterEachIntent[step]);
    }

    // Belt-and-suspenders: the final encoded runs are equal too.
    expect(serverBlobsAfterEachIntent.at(-1)).toBe(clientBlobsAfterEachIntent.at(-1));
  });
});
