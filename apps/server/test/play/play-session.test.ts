import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  artifactItemIds,
  createNewRun,
  decodeActiveRun,
  descendToNextFloor,
  encodeActiveRun,
  finalizeRun,
  heroActor,
  isHeartBossActive,
  placeFallenHeroEncounters,
  undiscoveredArtifactIds,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type FloorSnapshot,
  type StoredHallRecord,
  type Uint32State,
} from '@woven-deep/engine';
import { runMigrations } from '../../src/database.js';
import { ActiveRunRepository } from '../../src/db/active-run-repository.js';
import { ServerRunRecordRepository } from '../../src/db/hall-repository.js';
import { ProfileRepository } from '../../src/db/profile-repository.js';
import {
  CONSEQUENTIAL_EVENT_TYPES,
  ContentHashMismatchError,
  LockedClassError,
  ServerPlaySession,
} from '../../src/play/play-session.js';

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
    database,
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

/** The depth the seeded Hall record died at — the depth its champion must then appear on. Kept
 * shallow so the test walks only three real floor transitions to reach it, and picked because this
 * seed's depth-3 floor carries a vault placement (the champion slot below needs one). */
const CHAMPION_DEPTH = 3;

/** Moves the hero onto the active floor's stair-down (so the transition below is legal) — the
 * standard test shortcut for reaching a depth without walking the whole floor. */
function onStairDown(run: ActiveRun): ActiveRun {
  const floor = run.floors.find((candidate) => candidate.floorId === run.activeFloorId)!;
  const hero = heroActor(run);
  return {
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId
        ? { ...actor, x: floor.stairDown!.x, y: floor.stairDown!.y }
        : actor,
    ),
  };
}

function activeFloorOf(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

function activeDepthOf(run: ActiveRun): number {
  return activeFloorOf(run).depth;
}

/** Adds an optional `fallen-hero` monster slot on an open walkable tile inside an existing vault
 * placement, so the slot-preferred half of champion placement can be exercised on a floor whose
 * rolled vaults happen not to author one. */
function withFallenHeroSlot(floor: FloorSnapshot): FloorSnapshot {
  const vault = floor.vaults[0];
  if (vault === undefined) throw new Error('test setup failure: floor has no vault placement');
  const occupied = new Set(floor.entities.map((entity) => `${entity.x},${entity.y}`));
  const inVault = (x: number, y: number): boolean =>
    x >= vault.x && x < vault.x + vault.width && y >= vault.y && y < vault.y + vault.height;
  for (let y = 1; y < floor.height - 1; y += 1) {
    for (let x = 1; x < floor.width - 1; x += 1) {
      if (!inVault(x, y) || floor.tiles[y * floor.width + x] !== 1) continue;
      if (occupied.has(`${x},${y}`)) continue;
      return {
        ...floor,
        placementSlots: [
          ...floor.placementSlots,
          {
            slotId: 'slot.test.fallen-hero',
            vaultPlacementId: vault.placementId,
            kind: 'monster',
            required: false,
            tags: ['fallen-hero'],
            x,
            y,
          },
        ],
      };
    }
  }
  throw new Error('test setup failure: no free walkable vault tile for a fallen-hero slot');
}

/** Appends one authentic Hall record (built through the engine's own `finalizeRun`, exactly like
 * the production finalize path) for a run that really descended to `depth` and died there, so
 * `standings()` reports a `deathDepth` an actual floor can host its champion on. */
function seedHallRecord(
  hallRepo: ServerRunRecordRepository,
  depth: number,
  seed: Uint32State = SEED,
): StoredHallRecord {
  let base = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
  while (activeDepthOf(base) < depth) {
    base = descendToNextFloor(onStairDown(base), { content: pack }).state;
  }
  const hero = heroActor(base);
  const run: ActiveRun = {
    ...base,
    actors: base.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
    ),
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth, turn: base.turn, worldTime: base.worldTime },
      concludedAtRevision: base.revision,
      finalized: false,
    },
  };
  const finalized = finalizeRun({ run, content: pack, lifetime: hallRepo.lifetime() });
  const stored: StoredHallRecord = {
    ...finalized.record,
    enrichment: { achievedAt: FIXED_CLOCK(), portraitGlyph: '@' },
  };
  hallRepo.appendRecord(stored);
  hallRepo.applyDeltas(finalized.deltas);
  return stored;
}

describe('ServerPlaySession', () => {
  let database: Database.Database;
  let repo: ActiveRunRepository;

  beforeEach(() => {
    database = freshDatabase();
    repo = new ActiveRunRepository(database);
  });

  describe('hall records seeding', () => {
    /** Teleports the hero onto the active floor's stair-down and writes the run back to
     * `active_runs`, so the next session's descend intent is legal without walking the floor. */
    function stageOnStairs(run: ActiveRun): ActiveRun {
      const staged = onStairDown(run);
      repo.upsert({
        profileId: PROFILE,
        runBlob: encodeActiveRun(staged),
        revision: staged.revision,
        contentHash: pack.hash,
        updatedAt: FIXED_CLOCK(),
      });
      return staged;
    }

    function storedRun(): ActiveRun {
      return decodeActiveRun(repo.get(PROFILE)!.runBlob, pack);
    }

    it('seeds a fresh run with the profile standings, conquered champions, and undiscovered artifacts', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const record = seedHallRecord(hallRepo, CHAMPION_DEPTH);

      newSession(database, { repo, hallRepo }).open({ seed: SEED });

      const run = storedRun();
      expect(run.fallenHeroStandings.map((standing) => standing.hallRecordId)).toEqual([
        record.recordId,
      ]);
      expect(run.fallenHeroStandings[0]!.deathDepth).toBe(CHAMPION_DEPTH);
      expect(run.fallenHeroDecisions[0]).toMatchObject({
        hallRecordId: record.recordId,
        role: 'champion',
        retained: true,
      });
      expect(run.conqueredChampionRecordIds).toEqual(
        hallRepo.lifetime().conqueredChampionRecordIds,
      );
      // An empty ledger means every artifact the pack defines is still undiscovered.
      expect(run.artifactsUndiscovered).toEqual(
        undiscoveredArtifactIds(hallRepo.artifactLedger(), artifactItemIds(pack)),
      );
      expect(run.artifactsUndiscovered.length).toBeGreaterThan(0);
    });

    it('carries the seeded champion decision through a real descent and stands the champion on the death-depth floor, slot or no slot', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const record = seedHallRecord(hallRepo, CHAMPION_DEPTH);
      newSession(database, { repo, hallRepo }).open({ seed: SEED });

      while (activeDepthOf(storedRun()) < CHAMPION_DEPTH) {
        const staged = stageOnStairs(storedRun());
        const session = newSession(database, { repo, hallRepo });
        session.open({ seed: SEED });
        const outcome = session.applyIntent({
          commandId: `command.descend-${String(staged.revision)}`,
          expectedRevision: staged.revision,
          intent: { type: 'descend' },
        });
        expect(outcome.kind).toBe('state');
      }

      const run = storedRun();
      expect(activeDepthOf(run)).toBe(CHAMPION_DEPTH);
      // The descent ran the real placement pass on every generated floor. Whether or not the
      // death-depth floor happened to roll a vault authoring a fallen-hero slot, the open-cell
      // fallback guarantees the champion is standing there -- this is the production-shaped
      // proof, with nothing injected.
      const standing = run.populations.find((population) => population.model === 'champion');
      expect(standing).toBeDefined();
      expect(standing!.hallRecordId).toBe(record.recordId);
      const championActor = run.actors.find((actor) => actor.actorId === standing!.actorId);
      expect(championActor).toBeDefined();
      expect(championActor!.floorId).toBe(activeFloorOf(run).floorId);
      // Not yet met: the decision is spent only on the encounter, not on placement.
      expect(run.fallenHeroDecisions[0]).toMatchObject({ retained: true, encountered: false });

      // Slot-preferred: replaying the same pass against a floor that DOES author a fallen-hero
      // slot stands the champion on that slot rather than on a fallback cell.
      const slotted = withFallenHeroSlot(activeFloorOf(run));
      const arenaSlots = slotted.placementSlots.filter(
        (candidate) =>
          candidate.kind === 'monster' &&
          !candidate.required &&
          candidate.tags.some(
            (tag) => tag === 'side-arena' || tag === 'fallen-hero' || tag === 'champion',
          ),
      );
      const placed = placeFallenHeroEncounters({
        run: {
          ...run,
          populations: [],
          actors: run.actors.filter((actor) => actor.playerControlled),
        },
        floor: slotted,
        content: pack,
      });
      const champion = placed.populations.find((population) => population.model === 'champion');
      expect(champion).toBeDefined();
      expect(champion!.hallRecordId).toBe(record.recordId);
      expect(
        arenaSlots.some(
          (candidate) => candidate.x === placed.actors[0]!.x && candidate.y === placed.actors[0]!.y,
        ),
      ).toBe(true);
    });

    it('creates a history-free run for a profile with an empty Hall', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      newSession(database, { repo, hallRepo }).open({ seed: SEED });

      const run = storedRun();
      expect(run.fallenHeroStandings).toEqual([]);
      expect(run.fallenHeroDecisions).toEqual([]);
      expect(run.artifactsUndiscovered.length).toBeGreaterThan(0);
    });
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

  it('treats every hero health-loss event as consequential, whatever the attacker visibility', () => {
    // `hero.damaged` is the projection of a hero-targeted `actor.damaged` — it is what the hero
    // sees whether or not the attacker is visible. A move that costs the hero health must persist
    // immediately; leaving it checkpoint-eligible would risk MOVEMENT_CHECKPOINT_INTERVAL moves of
    // unsaved HP loss.
    for (const type of ['actor.damaged', 'hero.damaged', 'actor.died'])
      expect(CONSEQUENTIAL_EVENT_TYPES.has(type), type).toBe(true);
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

  describe('run-start class re-validation (Task 5)', () => {
    it('rejects a fresh run started with an unearned locked-class hero', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      const wardenHero = { ...DEFAULT_GUEST_HERO, classTags: ['warden'] };

      expect(() => session.open({ hero: wardenHero, seed: SEED })).toThrow(LockedClassError);
      // Nothing was persisted -- the rejected run never reaches createNewRun/persist.
      expect(repo.get(PROFILE)).toBeUndefined();
    });

    it('allows a fresh run started with a locked-class hero the profile has unlocked', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      hallRepo.setUnlocks(['class.warden']);
      const session = newSession(database, { repo, hallRepo });
      const wardenHero = { ...DEFAULT_GUEST_HERO, classTags: ['warden'] };

      const snapshot = session.open({ hero: wardenHero, seed: SEED });
      expect(snapshot.heroClassTags).toEqual(['warden']);
      expect(repo.get(PROFILE)).toBeDefined();
    });

    it('allows a fresh run started with the default (playable) guest hero regardless of unlocks', () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });

      const snapshot = session.open({ hero: DEFAULT_GUEST_HERO, seed: SEED });
      expect(snapshot.conclusion).toBeNull();
    });
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

    it('crash-atomicity: a throw mid-finalize rolls back the WHOLE write sequence -- no Hall record, active_runs left untouched -- so a later open() finalizes cleanly', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      // Simulate a crash (or any thrown error) partway through the write sequence, after the Hall
      // append would have happened but before the sequence completes.
      const appendAchievementsSpy = vi
        .spyOn(hallRepo, 'appendAchievements')
        .mockImplementation(() => {
          throw new Error('simulated crash mid-finalize');
        });

      expect(() => newSession(database, { repo, hallRepo }).open({ seed: SEED })).toThrow(
        'simulated crash mid-finalize',
      );

      // The transaction rolled back entirely: no Hall record was committed, and the active_runs row
      // still holds its pre-finalize (finalized: false) blob -- exactly as if the crash had never
      // reached the write sequence at all.
      expect(hallRepo.records()).toHaveLength(0);
      const stillStored = repo.get(PROFILE);
      expect(stillStored).toBeDefined();
      expect(decodeActiveRun(stillStored!.runBlob).conclusion?.finalized).toBe(false);

      appendAchievementsSpy.mockRestore();

      // A later open() (e.g. the process restarting, or a reconnect) re-finalizes cleanly: exactly
      // one Hall record, and the active_runs row is cleared -- the crash left no lingering damage.
      const snapshot = newSession(database, { repo, hallRepo }).open({ seed: SEED });
      expect(hallRepo.records()).toHaveLength(1);
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(snapshot.conclusion?.finalized).toBe(true);
    });

    it('self-heals a manually-corrupted stale active_runs blob that coexists with an already-committed Hall record, instead of throwing on the colliding recordId', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      newSession(database, { repo, hallRepo }).open({ seed: SEED });
      expect(hallRepo.records()).toHaveLength(1);
      expect(repo.get(PROFILE)).toBeUndefined();

      // Manually reconstruct the impossible-after-fix state the old bug relied on: a stale
      // pre-finalize (finalized: false) active_runs row re-appears alongside an already-committed
      // Hall record (e.g. hand-edited/restored from a pre-fix backup). This must self-heal rather
      // than re-invoke finalizeRun and throw on the now-duplicate deterministic recordId.
      storeConcludedRun(repo);
      expect(repo.get(PROFILE)).toBeDefined();

      const snapshot = newSession(database, { repo, hallRepo }).open({ seed: SEED });

      // Still exactly one Hall record (no duplicate append attempted), the stale row is cleared
      // again, and the reopened session reports the existing record as finalized.
      expect(hallRepo.records()).toHaveLength(1);
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(snapshot.conclusion?.finalized).toBe(true);
      expect(snapshot.conclusion?.score).toEqual(hallRepo.records()[0]!.score);
    });
  });
});
