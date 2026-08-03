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
    checkpointBlob: null,
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

  /** Teleports the hero onto the active floor's stair-down (same trick as
   * `stageOnStairs`/`onStairDown` above), writes it straight to `active_runs`, reloads it into
   * THIS session via a second `open()` (so the session's own `applyIntent` below dispatches
   * against the staged position), and descends -- one real, legal floor-entry transition without
   * walking the generated floor. */
  function descendOnce(session: ServerPlaySession): void {
    const stored = repo.get(PROFILE)!;
    const run = decodeActiveRun(stored.runBlob, pack);
    const staged = onStairDown(run);
    repo.upsert({
      profileId: PROFILE,
      runBlob: encodeActiveRun(staged),
      revision: staged.revision,
      contentHash: pack.hash,
      updatedAt: FIXED_CLOCK(),
      checkpointBlob: stored.checkpointBlob,
    });
    session.open({ seed: SEED, mode: run.mode });
    const outcome = session.applyIntent({
      commandId: `command.descend-${String(staged.revision)}`,
      expectedRevision: staged.revision,
      intent: { type: 'descend' },
    });
    if (outcome.kind !== 'state') {
      throw new Error(`expected descend to transition, got ${outcome.kind}`);
    }
  }

  function revisionOf(session: ServerPlaySession): number {
    return session.getSnapshot().revision;
  }

  /**
   * Kills the hero for real, through the engine. This pack's hunger reserve is thousands of
   * world-time units deep and no scripted walk reliably reaches a lethal encounter, so the stored
   * run is rewritten one hit from starvation and reloaded into the session (a plain rehydrating
   * `open()`, which preserves the row's checkpoint) -- the `wait` that follows is a genuine
   * `resolveCommand` death, finalize path and all.
   */
  function killHero(session: ServerPlaySession): void {
    const stored = repo.get(PROFILE)!;
    const run = decodeActiveRun(stored.runBlob, pack);
    const hero = heroActor(run);
    const doomed: ActiveRun = {
      ...run,
      actors: run.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, health: 1 } : actor,
      ),
      survival: {
        ...run.survival,
        hungerReserve: 0,
        hungerStage: 'starving',
        nextStarvationAt: run.worldTime,
      },
    };
    repo.upsert({
      profileId: PROFILE,
      runBlob: encodeActiveRun(doomed),
      revision: doomed.revision,
      contentHash: pack.hash,
      updatedAt: FIXED_CLOCK(),
      checkpointBlob: stored.checkpointBlob,
    });
    session.open({ seed: SEED, mode: run.mode });
    session.applyIntent({
      commandId: `command.kill-${String(doomed.revision)}`,
      expectedRevision: doomed.revision,
      intent: { type: 'wait' },
    });
    if (session.getSnapshot().projection.conclusion === null) {
      throw new Error('test setup failure: the hero survived the killing wait');
    }
  }

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
        checkpointBlob: null,
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

    // A real multi-floor descent through resolveCommand: comfortably under a second locally but
    // beyond vitest's 5s default on slower CI runners, hence the explicit timeout.
    it(
      'carries the seeded champion decision through a real descent and stands the champion on the death-depth floor, slot or no slot',
      { timeout: 30_000 },
      () => {
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
            (candidate) =>
              candidate.x === placed.actors[0]!.x && candidate.y === placed.actors[0]!.y,
          ),
        ).toBe(true);
      },
    );

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
      checkpointBlob: null,
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

    it('applies the lifetime deltas before the artifact deltas so conquest is visible at reconcile', () => {
      storeConcludedRun(repo);
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const calls: string[] = [];
      vi.spyOn(hallRepo, 'applyDeltas').mockImplementation((deltas) => {
        calls.push('applyDeltas');
        return ServerRunRecordRepository.prototype.applyDeltas.call(hallRepo, deltas);
      });
      vi.spyOn(hallRepo, 'applyArtifactDeltas').mockImplementation((deltas) => {
        calls.push('applyArtifactDeltas');
        return ServerRunRecordRepository.prototype.applyArtifactDeltas.call(hallRepo, deltas);
      });

      newSession(database, { repo, hallRepo }).open({ seed: SEED });

      expect(calls).toEqual(['applyDeltas', 'applyArtifactDeltas']);
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

  describe('wanderer checkpoints (Task 7)', () => {
    it('writes a checkpoint on a wanderer floor transition', { timeout: 30_000 }, () => {
      const session = newSession(database, { repo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);

      const row = repo.get(PROFILE)!;
      expect(row.checkpointBlob).toBe(row.runBlob);
    });

    it('leaves the checkpoint alone on a non-transition command', { timeout: 30_000 }, () => {
      const session = newSession(database, { repo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      const atFloorEntry = repo.get(PROFILE)!.checkpointBlob;

      session.applyIntent({
        commandId: 'c.1',
        expectedRevision: revisionOf(session),
        intent: { type: 'wait' },
      });

      const row = repo.get(PROFILE)!;
      expect(row.checkpointBlob).toBe(atFloorEntry);
      expect(row.runBlob).not.toBe(atFloorEntry);
    });

    it('never writes a checkpoint for a classic run', { timeout: 30_000 }, () => {
      const session = newSession(database, { repo });
      session.open({ seed: SEED });
      descendOnce(session);

      expect(repo.get(PROFILE)?.checkpointBlob).toBeNull();
    });

    it('opens a classic run by default', () => {
      const session = newSession(database, { repo });
      expect(session.open({ seed: SEED }).projection.mode).toBe('classic');
    });
  });

  describe('wanderer rise and accept (Task 8)', () => {
    /** A concluded Wanderer run stored straight into `active_runs`, beside the floor-entry
     * checkpoint it can rise from -- the shape a real Wanderer conclusion leaves behind, without
     * driving the run there. `withCheckpoint: false` models a conclusion whose checkpoint was
     * never written (a death before any floor entry). */
    function storeConcludedWanderer(
      completionType: 'died' | 'broke-cycle',
      options: Readonly<{ withCheckpoint?: boolean }> = {},
    ): ActiveRun {
      const base = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO, mode: 'wanderer' });
      const hero = heroActor(base);
      const concluded: ActiveRun = {
        ...base,
        actors:
          completionType === 'died'
            ? base.actors.map((actor) =>
                actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
              )
            : base.actors,
        conclusion: {
          completionType,
          cause: {
            killerContentId: null,
            depth: base.metrics.deepestDepth,
            turn: base.turn,
            worldTime: base.worldTime,
          },
          concludedAtRevision: base.revision,
          finalized: false,
        },
      };
      repo.upsert({
        profileId: PROFILE,
        runBlob: encodeActiveRun(concluded),
        revision: concluded.revision,
        contentHash: pack.hash,
        updatedAt: FIXED_CLOCK(),
        checkpointBlob: options.withCheckpoint === false ? null : encodeActiveRun(base),
      });
      return base;
    }

    it(
      'produces no record, unlocks, or achievements when a wanderer run dies',
      { timeout: 30_000 },
      () => {
        const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
        const baselineUnlocks = hallRepo.unlocks();
        const session = newSession(database, { repo, hallRepo });
        session.open({ seed: SEED, mode: 'wanderer' });
        descendOnce(session);
        killHero(session);

        session.acceptDeath();

        expect(hallRepo.records()).toEqual([]);
        expect(hallRepo.unlocks()).toEqual(baselineUnlocks);
        expect(hallRepo.achievements()).toEqual([]);
        expect(repo.get(PROFILE)).toBeUndefined();
      },
    );

    /** A single walkable neighbor of `(x, y)` on `floor`, preferring cardinal directions -- the
     * cell the hero is teleported onto to stand Chebyshev-adjacent to a real, placed champion
     * without needing to know the floor's connectivity in advance. */
    function walkableNeighbor(
      floor: FloorSnapshot,
      x: number,
      y: number,
    ): Readonly<{ x: number; y: number }> {
      const offsets = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      for (const [dx, dy] of offsets) {
        const nx = x + dx!;
        const ny = y + dy!;
        if (nx < 0 || ny < 0 || nx >= floor.width || ny >= floor.height) continue;
        if (floor.tiles[ny * floor.width + nx] === 1) return { x: nx, y: ny };
      }
      throw new Error('test setup failure: champion has no walkable neighbor');
    }

    /**
     * A real Wanderer session standing beside a genuinely placed champion haunt, holding a
     * `travel-ration` (the `wayfarer` class's favored `food` category, per the content pack's
     * `deeps-champion` appeasement block) ready to offer. Built through the SAME production path
     * `'carries the seeded champion decision through a real descent...'` above exercises --
     * `seedHallRecord` + a real multi-floor descent to the champion's death depth, so the champion
     * is a genuine placed population/actor, not a hand-rolled fixture. Only the hero's position is
     * then hand-adjusted (onto a walkable neighbor of the real champion actor), which is exactly
     * the same "teleport onto a legal cell, write it back, reopen" trick `onStairDown`/`descendOnce`
     * already use elsewhere in this file.
     */
    function wandererSessionBesideHaunt(
      hallRepo: ServerRunRecordRepository,
    ): Readonly<{ session: ServerPlaySession; itemId: string }> {
      seedHallRecord(hallRepo, CHAMPION_DEPTH);
      newSession(database, { repo, hallRepo }).open({ seed: SEED, mode: 'wanderer' });

      function currentRun(): ActiveRun {
        return decodeActiveRun(repo.get(PROFILE)!.runBlob, pack);
      }

      while (activeDepthOf(currentRun()) < CHAMPION_DEPTH) {
        const staged = onStairDown(currentRun());
        repo.upsert({
          profileId: PROFILE,
          runBlob: encodeActiveRun(staged),
          revision: staged.revision,
          contentHash: pack.hash,
          updatedAt: FIXED_CLOCK(),
          checkpointBlob: repo.get(PROFILE)!.checkpointBlob,
        });
        const stepSession = newSession(database, { repo, hallRepo });
        stepSession.open({ seed: SEED, mode: 'wanderer' });
        const outcome = stepSession.applyIntent({
          commandId: `command.descend-${String(staged.revision)}`,
          expectedRevision: staged.revision,
          intent: { type: 'descend' },
        });
        if (outcome.kind !== 'state') {
          throw new Error(`expected descend to transition, got ${outcome.kind}`);
        }
      }

      const atDepth = currentRun();
      const champion = atDepth.populations.find((population) => population.model === 'champion');
      if (!champion) throw new Error('test setup failure: no champion placed at CHAMPION_DEPTH');
      const championActor = atDepth.actors.find((actor) => actor.actorId === champion.actorId);
      if (!championActor) throw new Error('test setup failure: champion actor is missing');
      const hero = heroActor(atDepth);
      const item = atDepth.items.find(
        (candidate) =>
          candidate.contentId === 'item.travel-ration' && candidate.location.type === 'backpack',
      );
      if (!item) throw new Error('test setup failure: hero has no travel ration to offer');
      const beside = walkableNeighbor(activeFloorOf(atDepth), championActor.x, championActor.y);
      const besideHaunt: ActiveRun = {
        ...atDepth,
        actors: atDepth.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, x: beside.x, y: beside.y } : actor,
        ),
      };
      repo.upsert({
        profileId: PROFILE,
        runBlob: encodeActiveRun(besideHaunt),
        revision: besideHaunt.revision,
        contentHash: pack.hash,
        updatedAt: FIXED_CLOCK(),
        checkpointBlob: repo.get(PROFILE)!.checkpointBlob,
      });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      // The teleport above only rewrites position -- `GameplayProjection.haunts` gates on
      // `decision.encountered` (Task 9's tightened gate: a placed-but-never-SEEN haunt must stay
      // invisible), and `encountered` only flips true inside a real world-step's
      // `observeEncounters` pass. One harmless `wait` lets that pass run for real, exactly the way
      // a hero who genuinely walked up to the champion would have triggered it on the move that
      // brought them adjacent.
      const looked = session.applyIntent({
        commandId: `command.look-${String(besideHaunt.revision)}`,
        expectedRevision: revisionOf(session),
        intent: { type: 'wait' },
      });
      if (
        looked.kind !== 'state' ||
        !looked.snapshot.projection.haunts.some((haunt) => haunt.encountered)
      ) {
        throw new Error(
          'test setup failure: the haunt was never encountered after teleporting adjacent',
        );
      }
      return { session, itemId: item.itemId };
    }

    it(
      'writes nothing to the hall when a wanderer run appeases a haunt',
      { timeout: 30_000 },
      () => {
        const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
        const { session, itemId } = wandererSessionBesideHaunt(hallRepo);
        // `wandererSessionBesideHaunt` already seeded one CLASSIC Hall record (`seedHallRecord`,
        // the champion's own death) before the Wanderer run under test even opened -- the
        // invariant here is that the WANDERER run's own death adds nothing on top of it.
        const recordsBeforeWandererDeath = hallRepo.records();
        expect(recordsBeforeWandererDeath).toHaveLength(1);

        const offered = session.applyIntent({
          commandId: 'command.offer-1',
          expectedRevision: revisionOf(session),
          intent: { type: 'offer', itemId },
        });
        expect(offered.kind).toBe('state');
        if (offered.kind === 'state') {
          expect(offered.snapshot.projection.haunts.some((haunt) => haunt.appeased)).toBe(true);
        }

        killHero(session);
        session.acceptDeath();

        expect(hallRepo.records()).toEqual(recordsBeforeWandererDeath);
      },
    );

    it('produces no record when a wanderer run WINS', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      storeConcludedWanderer('broke-cycle');

      const snapshot = newSession(database, { repo, hallRepo }).open({ seed: SEED });

      // A victory is not the player's to reconsider: it clears the run row (checkpoint included)
      // on sight, and still writes nothing to the Hall.
      expect(hallRepo.records()).toEqual([]);
      expect(hallRepo.achievements()).toEqual([]);
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(snapshot.conclusion?.finalized).toBe(false);
      expect(snapshot.conclusion?.score).toBeNull();
    });

    it('still records a classic death', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });
      descendOnce(session);
      killHero(session);

      expect(hallRepo.records()).toHaveLength(1);
      expect(repo.get(PROFILE)).toBeUndefined();
    });

    it('rises again and pushes the floor-entry snapshot', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      const atFloorEntry = repo.get(PROFILE)!.runBlob;
      const revisionAtEntry = revisionOf(session);
      killHero(session);

      const outcome = session.riseAgain();

      expect(outcome.kind).toBe('state');
      expect(outcome.snapshot.projection.conclusion).toBeNull();
      expect(outcome.snapshot.revision).toBe(revisionAtEntry);
      expect(repo.get(PROFILE)!.runBlob).toBe(atFloorEntry);
      // The rewind point survives the rise, so dying again on this floor can rise again.
      expect(repo.get(PROFILE)!.checkpointBlob).toBe(atFloorEntry);
      expect(hallRepo.records()).toEqual([]);
    });

    it('accepts death when the stored checkpoint is corrupt', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      const row = repo.get(PROFILE)!;
      repo.upsert({ ...row, checkpointBlob: '{"schemaVersion":15,"nonsense":true}' });
      killHero(session);

      const outcome = session.riseAgain();

      expect(outcome.kind).toBe('state');
      expect(outcome.snapshot.projection.conclusion?.completionType).toBe('died');
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(hallRepo.records()).toEqual([]);
    });

    it('accepts death when no checkpoint was ever written', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      storeConcludedWanderer('died', { withCheckpoint: false });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });

      const outcome = session.riseAgain();

      expect(outcome.snapshot.projection.conclusion?.completionType).toBe('died');
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(hallRepo.records()).toEqual([]);
    });

    it('refuses a checkpoint belonging to a different run', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      storeConcludedWanderer('died');
      const row = repo.get(PROFILE)!;
      // Decodes cleanly, same pack, same mode -- but another run's seed. Swapping it in would
      // hand the profile a run it never played.
      repo.upsert({
        ...row,
        checkpointBlob: encodeActiveRun(
          createNewRun({
            pack,
            seed: [1, 2, 3, 4] as unknown as Uint32State,
            hero: DEFAULT_GUEST_HERO,
            mode: 'wanderer',
          }),
        ),
      });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });

      const outcome = session.riseAgain();

      expect(outcome.snapshot.projection.conclusion?.completionType).toBe('died');
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(hallRepo.records()).toEqual([]);
    });

    it('refuses to rise a classic run', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });
      descendOnce(session);
      killHero(session);

      expect(session.riseAgain().snapshot.projection.conclusion?.completionType).toBe('died');
      // The classic death was finalized on sight, exactly as before.
      expect(hallRepo.records()).toHaveLength(1);
    });

    it('leaves a wanderer death undecided until the client answers', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      killHero(session);

      // Nothing is cleared and nothing is written while the choice is still open -- otherwise
      // `riseAgain` could never find the checkpoint it exists to restore.
      const row = repo.get(PROFILE);
      expect(row).toBeDefined();
      expect(row!.checkpointBlob).not.toBeNull();
      expect(hallRepo.records()).toEqual([]);
    });

    /**
     * Rewrites the stored run so the NEXT floor transition kills the hero on arrival: an always-
     * firing `on-floor-enter` curse (`curse.gnawing-want`, chanceBps 10000) on an equipped item,
     * with the hero at 1 health. Curses made floor transitions lethal, so a transition can now
     * conclude the run -- the case the rewind point (and the finalize path) has to handle.
     */
    function armLethalFloorEntry(): void {
      const stored = repo.get(PROFILE)!;
      const run = decodeActiveRun(stored.runBlob, pack);
      const hero = heroActor(run);
      const equipped = run.items.find(
        (item) => item.location.type === 'equipped' && item.location.actorId === hero.actorId,
      )!;
      const armed: ActiveRun = {
        ...run,
        items: run.items.map((item) =>
          item.itemId === equipped.itemId
            ? { ...item, curse: { curseId: 'curse.gnawing-want', revealed: true } }
            : item,
        ),
        actors: run.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, health: 1 } : actor,
        ),
      };
      repo.upsert({
        profileId: PROFILE,
        runBlob: encodeActiveRun(armed),
        revision: armed.revision,
        contentHash: pack.hash,
        updatedAt: FIXED_CLOCK(),
        checkpointBlob: stored.checkpointBlob,
      });
    }

    /** Ascends from a depth-1 stair-up arrival tile back into town -- one real transition, which
     * the curse above turns lethal on arrival. */
    function ascendInto(session: ServerPlaySession, mode: 'classic' | 'wanderer'): void {
      session.open({ seed: SEED, mode });
      session.applyIntent({
        commandId: 'command.lethal-ascend',
        expectedRevision: revisionOf(session),
        intent: { type: 'ascend' },
      });
    }

    it('a transition death keeps the previous floor-entry checkpoint', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      const atDepth1Entry = repo.get(PROFILE)!.checkpointBlob;
      armLethalFloorEntry();

      ascendInto(session, 'wanderer');
      expect(session.getSnapshot().projection.conclusion?.completionType).toBe('died');

      // The concluded arrival must never become the rewind point: it would rise straight back into
      // the same death, forever.
      expect(repo.get(PROFILE)!.checkpointBlob).toBe(atDepth1Entry);

      const outcome = session.riseAgain();
      expect(outcome.snapshot.projection.conclusion).toBeNull();
      expect(repo.get(PROFILE)!.runBlob).toBe(atDepth1Entry);
      expect(hallRepo.records()).toEqual([]);
    });

    it('refuses a checkpoint that is itself concluded', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      killHero(session);
      // Defense in depth: whatever wrote it, a concluded blob can only rise into the same death.
      const row = repo.get(PROFILE)!;
      repo.upsert({ ...row, checkpointBlob: row.runBlob });

      const outcome = session.riseAgain();

      expect(outcome.snapshot.projection.conclusion?.completionType).toBe('died');
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(hallRepo.records()).toEqual([]);
    });

    it('finalizes a CLASSIC transition death into the Hall', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });
      descendOnce(session);
      armLethalFloorEntry();

      ascendInto(session, 'classic');

      expect(session.getSnapshot().projection.conclusion?.completionType).toBe('died');
      // A death is a death whichever code path produced it -- the transition path must finalize
      // exactly like a command death does.
      expect(hallRepo.records()).toHaveLength(1);
      expect(repo.get(PROFILE)).toBeUndefined();
      expect(session.getSnapshot().conclusion?.finalized).toBe(true);
    });

    it('leaves a WANDERER transition death undecided', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);
      armLethalFloorEntry();

      ascendInto(session, 'wanderer');

      expect(hallRepo.records()).toEqual([]);
      expect(repo.get(PROFILE)).toBeDefined();
      expect(session.getSnapshot().conclusion?.finalized).toBe(false);
    });

    it(
      'refuses to rise a non-death conclusion even with a live checkpoint row',
      { timeout: 30_000 },
      () => {
        const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
        const base = storeConcludedWanderer('broke-cycle');
        const session = newSession(database, { repo, hallRepo });
        session.open({ seed: SEED });
        // The finalize gate cleared the row on open, which used to make this test vacuous: rise
        // refused because there was nothing to restore, not because a win is unrisable. Re-seed a
        // perfectly restorable checkpoint so the ONLY thing standing between this victory and a
        // rewind is the completion-type guard itself.
        repo.upsert({
          profileId: PROFILE,
          runBlob: encodeActiveRun(base),
          revision: base.revision,
          contentHash: pack.hash,
          updatedAt: FIXED_CLOCK(),
          checkpointBlob: encodeActiveRun(base),
        });

        const outcome = session.riseAgain();

        expect(outcome.snapshot.projection.conclusion?.completionType).toBe('broke-cycle');
        // Refused at the guard, before the repo was consulted: the row survives untouched.
        expect(repo.get(PROFILE)).toBeDefined();
        expect(hallRepo.records()).toEqual([]);
      },
    );

    it('acceptDeath is a no-op on a LIVE wanderer run', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED, mode: 'wanderer' });
      descendOnce(session);

      // `accept-death` is client-sendable at any moment, and it deletes the active-run row. Past
      // the mode check, `conclusion !== null` is the ONLY thing standing between a stray message
      // and a live run being destroyed.
      const outcome = session.acceptDeath();

      expect(outcome.kind).toBe('state');
      expect(outcome.snapshot.projection.conclusion).toBeNull();
      expect(repo.get(PROFILE)).toBeDefined();
      // Still playable: the run took the very next command.
      const after = session.applyIntent({
        commandId: 'c.after-accept',
        expectedRevision: revisionOf(session),
        intent: { type: 'wait' },
      });
      expect(after.kind).toBe('state');
      expect(after.snapshot.revision).toBeGreaterThan(0);
      expect(repo.get(PROFILE)).toBeDefined();
    });

    it(
      'a stray accept-death after a rise leaves the restored run alive',
      { timeout: 30_000 },
      () => {
        const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
        const session = newSession(database, { repo, hallRepo });
        session.open({ seed: SEED, mode: 'wanderer' });
        descendOnce(session);
        killHero(session);
        expect(session.riseAgain().snapshot.projection.conclusion).toBeNull();

        // The rise already answered the death; a duplicate/late `accept-death` must not then delete
        // the run the player is playing again.
        const outcome = session.acceptDeath();

        expect(outcome.snapshot.projection.conclusion).toBeNull();
        expect(repo.get(PROFILE)).toBeDefined();
        expect(repo.get(PROFILE)!.checkpointBlob).not.toBeNull();
        expect(hallRepo.records()).toEqual([]);
      },
    );

    it('acceptDeath is a no-op for a classic run', { timeout: 30_000 }, () => {
      const hallRepo = new ServerRunRecordRepository({ database, profileId: PROFILE });
      const session = newSession(database, { repo, hallRepo });
      session.open({ seed: SEED });

      const outcome = session.acceptDeath();

      expect(outcome.kind).toBe('state');
      expect(outcome.snapshot.projection.conclusion).toBeNull();
      expect(repo.get(PROFILE)).toBeDefined();
    });
  });
});
