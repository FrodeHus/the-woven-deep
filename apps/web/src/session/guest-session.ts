import type { CompiledContentPack } from '@woven-deep/content';
import {
  createNewRun,
  decodeActiveRun,
  DEFAULT_GUEST_HERO,
  deriveHallRecordId,
  encodeActiveRun,
  finalizeRun,
  FINAL_CHAMBER_DEPTH,
  heroHoldsAllFragments,
  isHeartBossActive,
  projectDecision,
  projectGameplayState,
  projectRunConclusion,
  RECENT_COMMAND_LIMIT,
  SaveLoadError,
  type ActiveRun,
  type CommandResolution,
  type FinalChamberChoiceCommand,
  type GameCommand,
  type GameplayProjection,
  type HallRecordEnrichment,
  type NewRunHero,
  type NewRunRecordsInput,
  type PublicDecision,
  type PublicEvent,
  type RunConclusionProjection,
  type RunMode,
  type RunRecordRepository,
  type StoredHallRecord,
  type Uint32State,
} from '@woven-deep/engine';
import { dispatchCommand, dispatchIntent } from '@woven-deep/session-core';
import {
  accumulateSightings,
  insertSighting,
  loadSightings,
  newLoreReveals,
  revealLine,
  saveSightings,
  type Sightings,
} from './codex.js';
import type {
  PendingFinalChamberChoice,
  SessionNotice,
  SessionSnapshot,
} from './session-snapshot.js';
import { itemById, monsterById } from './pack-queries.js';
import { foldEventsIntoLog, LOG_CAPACITY, type LogLine } from './event-log.js';
import type { PlayerIntent } from './intents.js';
import {
  dismissHint,
  loadOnboarding,
  recordIntent,
  saveOnboarding,
  type OnboardingState,
} from './onboarding.js';
import type { RunSession } from './run-session.js';
import { randomSeed } from './seed.js';
import {
  CHECKPOINT_KEY,
  classifyStorageFailure,
  COMMAND_SEQUENCE_KEY,
  SAVE_KEY,
  type SessionStorageLike,
} from './storage.js';

/** Width of the zero-padded counter component of a command id — comfortably above what any
 * single guest session could produce, so ids stay a fixed, easy-to-scan shape. */
const COMMAND_SEQUENCE_WIDTH = 10;

export type {
  SessionNotice,
  PendingFinalChamberChoice,
  SessionSnapshot,
} from './session-snapshot.js';

/** A private, ephemeral `SessionStorageLike` fallback for the constructor's optional
 * `localStorage` field -- every pre-existing `GuestSession` caller (this session layer's own
 * extensive test suite included) constructs the session with no notion of a device-persistent
 * store at all, and requiring one outright would force touching every one of those unrelated call
 * sites. Onboarding mastery for a session built this way simply never survives past this object's
 * lifetime -- correct for a caller that never asked for persistence in the first place. */
function inMemoryLocalStorage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
  };
}

/**
 * Owns the guest's single active run: booting it from storage (or generating a fresh one),
 * turning `PlayerIntent`s into engine commands, and persisting the result after every dispatch
 * that changes the run. Framework-free — `store.ts` is the only file that touches React.
 */
export class GuestSession implements RunSession {
  private readonly pack: CompiledContentPack;
  private readonly storage: SessionStorageLike;
  private readonly hero: NewRunHero;
  private readonly records: (() => NewRunRecordsInput) | undefined;
  private readonly mode: RunMode;
  private run: ActiveRun;
  private commandSequence: number;
  private log: readonly LogLine[] = [];
  private nextLogId = 0;
  private lastEvents: readonly PublicEvent[] = [];
  private pendingDecision: PublicDecision | null = null;
  private notice: SessionNotice | null;
  private houseOpen = false;
  private sightings: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };
  private readonly localStorage: SessionStorageLike;
  private onboarding: OnboardingState;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Guards the `data-reset` notice (see `SessionNotice`) so a corrupted sighting-cache or
   * onboarding-ledger blob is announced exactly once per session, never re-fired on every
   * subsequent `publish()` -- `syncSightings` re-reads storage on every publish, and once its own
   * best-effort write below succeeds the blob is no longer corrupt on the next read anyway, but
   * these flags make that guarantee explicit rather than incidental. */
  private sightingsCorruptionNotified = false;
  private onboardingCorruptionNotified = false;
  /** Set by `freshRun` when the guest's Hall could not seed this run (see its doc comment); read
   * once by the constructor, after the boot notice is assigned, to surface the reset notice. */
  private hallCorrupted = false;

  constructor(
    input: Readonly<{
      pack: CompiledContentPack;
      storage: SessionStorageLike;
      seed?: Uint32State;
      hero?: NewRunHero;
      /** Device-persistent (`localStorage`) store for the onboarding mastery ledger only -- see
       * `inMemoryLocalStorage`'s doc comment above for why this is optional rather than required. */
      localStorage?: SessionStorageLike;
      /** When `true`, `boot()` never looks at any existing save — it always starts a brand-new run
       * from this constructor's `hero`/`seed`, exactly like an empty storage boot would. This is the
       * seam chargen's "confirm"/"new hero" flows use: without it, any live save in storage would
       * silently win over the wizard's just-confirmed hero (see App.tsx's chargen `onConfirm`).
       * "Continue" and quickstart callers must NOT set this — they rely on restore semantics. */
      startFresh?: boolean;
      /** The guest's cross-run history for any run this session creates: Hall standings (the
       * champion/Echo encounters), the artifacts still undiscovered, and the champions already
       * conquered. A THUNK, read fresh on every `freshRun` rather than snapshotted here, so a run
       * begun after this page life's own finalize inherits that finalize's record. Omitting it
       * creates history-free runs (the pre-records behaviour). */
      records?: () => NewRunRecordsInput;
      /** The run mode to create a fresh run with -- defaults to `'classic'`, threaded into every
       * `createNewRun` call inside `freshRun` (including the Hall-corruption retry, so it can't
       * silently downgrade the mode). Restored runs keep whatever mode they were created with;
       * this only affects fresh boots. */
      mode?: RunMode;
    }>,
  ) {
    this.pack = input.pack;
    this.storage = input.storage;
    this.localStorage = input.localStorage ?? inMemoryLocalStorage();
    const onboardingLoad = loadOnboarding(this.localStorage);
    this.onboarding = onboardingLoad.state;
    this.hero = input.hero ?? DEFAULT_GUEST_HERO;
    this.records = input.records;
    this.mode = input.mode ?? 'classic';
    const booted = this.boot(input.seed, input.startFresh ?? false);
    this.run = booted.run;
    // A checkpoint belongs to exactly one run. A fresh run (or a discarded/hash-mismatched save)
    // must never inherit the previous run's rewind point.
    if (booted.notice.kind !== 'restored') this.clearRiseCheckpoint();
    this.notice = booted.notice;
    this.commandSequence = booted.commandSequence;
    // Surfaced AFTER the boot notice is assigned above, so a corrupted onboarding blob's
    // dismissible reset notice wins over the (less urgent) plain fresh/restored boot notice --
    // both are one-time facts about this construction, but losing device-persistent mastery
    // progress is the more actionable one to tell the guest about.
    if (onboardingLoad.corrupted) this.markOnboardingCorrupted();
    // Same posture, one rung more urgent: this run is missing its whole cross-run history.
    if (this.hallCorrupted) this.markHallCorrupted();
    // "Accumulates ... on boot restore" -- a restored (or freshly-created) run's initial
    // projection may already show visible actors/identified items (e.g. a save restored mid-fight),
    // so the cache must sync once here too, not only after a subsequent dispatch. Reveals are
    // suppressed for this call (see `syncSightings`'s `emitReveals` param): a restored session's
    // entire pre-existing sighting set must never re-announce itself as a fresh discovery.
    this.syncSightings(false);
    this.snapshot = this.buildSnapshot();
  }

  private boot(
    seed: Uint32State | undefined,
    startFresh: boolean,
  ): Readonly<{ run: ActiveRun; notice: SessionNotice; commandSequence: number }> {
    const raw = startFresh ? null : this.storage.get(SAVE_KEY);
    if (raw === null) {
      return { run: this.freshRun(seed), notice: { kind: 'fresh' }, commandSequence: 0 };
    }
    try {
      const restored = decodeActiveRun(raw, this.pack);
      if (restored.contentHash !== this.pack.hash) {
        return {
          run: this.freshRun(seed),
          notice: { kind: 'save-discarded', reason: 'content_hash_mismatch' },
          commandSequence: 0,
        };
      }
      return {
        run: restored,
        notice: { kind: 'restored' },
        commandSequence: this.readCommandSequence(restored),
      };
    } catch (error) {
      if (error instanceof SaveLoadError) {
        return {
          run: this.freshRun(seed),
          notice: { kind: 'save-discarded', reason: error.kind },
          commandSequence: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Reads the persisted command-sequence counter beside a restored save. If it's missing or
   * corrupt — an older session saved before this counter existed, or storage tampering — it must
   * be reseeded ABOVE anything the engine's pruned `recentCommands` could still remember, or a
   * freshly-derived id could collide with a retained entry and be rejected as
   * `command_id_conflict`. `revision + RECENT_COMMAND_LIMIT + 1` is a safe floor: the engine never
   * retains more than `RECENT_COMMAND_LIMIT` recorded commands, and every one of them was recorded
   * at or before the restored revision.
   */
  private readCommandSequence(restored: ActiveRun): number {
    const raw = this.storage.get(COMMAND_SEQUENCE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    return restored.revision + RECENT_COMMAND_LIMIT + 1;
  }

  /**
   * Creates the run this session plays, seeded from the guest's cross-run history.
   *
   * The provider is called HERE, not stored at construction: the guest's Hall changes within a
   * page life (a finalize appends a record, the settings overlay can wipe the whole store), and
   * the run started right after must see the Hall as it stands now.
   *
   * That Hall lives in browser storage the player can edit, and it survives reloads — so a
   * malformed record (hand-edited, or written by a build whose record shape has since changed)
   * would otherwise throw out of run creation and leave a blank app that reloading cannot fix.
   * The mechanism is therefore attempt-with-records → retry-recordless-on-the-same-seed →
   * propagate whatever the retry itself throws (a failure with no history in play was never about
   * the Hall, so it is never swallowed). `SaveLoadError`/`RangeError` narrows the catch to the
   * shapes corrupt history actually produces; anything else propagates immediately.
   *
   * The retry cannot tell a corrupt Hall from an engine regression in the records path, and the
   * player-facing notice deliberately says "Hall" either way — so once the retry has SUCCEEDED
   * (i.e. play really is degrading), the original error is logged. Without that, a bug in (say)
   * `createFallenHeroRunDecisions` would leave no trace anywhere: every run would silently lose
   * its history and blame the player's save.
   */
  private freshRun(seed?: Uint32State): ActiveRun {
    const runSeed = seed ?? randomSeed();
    const records = this.records?.();
    if (records === undefined) {
      return createNewRun({ pack: this.pack, seed: runSeed, hero: this.hero, mode: this.mode });
    }
    let historyFailure: unknown;
    try {
      return createNewRun({
        pack: this.pack,
        seed: runSeed,
        hero: this.hero,
        mode: this.mode,
        records,
      });
    } catch (error) {
      if (!(error instanceof SaveLoadError || error instanceof RangeError)) throw error;
      historyFailure = error;
    }
    // Anything this retry throws propagates untouched and unlogged: a creation that fails with no
    // history in play was never about the Hall, so it must surface as itself.
    const run = createNewRun({ pack: this.pack, seed: runSeed, hero: this.hero, mode: this.mode });
    console.error('Hall of Records could not seed this run; starting without it:', historyFailure);
    this.hallCorrupted = true;
    return run;
  }

  private nextCommandId(): string {
    // A session-owned monotonic counter, immune to the engine's pruning of `recentCommands`
    // (reducer.ts caps it at `RECENT_COMMAND_LIMIT`). Deriving ids from `run.revision` and/or
    // `recentCommands.length` (the previous approach) breaks once that cap is reached: `length`
    // goes constant, and invalid results — which don't advance `revision` — then produce IDENTICAL
    // ids across consecutive invalid dispatches, so the next distinct command collides with one of
    // them and is rejected forever as `command_id_conflict`. This counter never repeats a value
    // for the life of the (persisted) session, applied/invalid/rejected alike.
    const id = `command.guest-${String(this.commandSequence).padStart(COMMAND_SEQUENCE_WIDTH, '0')}`;
    this.commandSequence += 1;
    try {
      this.storage.set(COMMAND_SEQUENCE_KEY, String(this.commandSequence));
    } catch {
      // Best-effort: the in-memory counter already advanced correctly for the rest of this
      // session. `persist()` below is what surfaces storage-failure notices to the player; doing
      // it again here for the same underlying failure would be redundant.
    }
    return id;
  }

  private currentProjection(): GameplayProjection {
    return projectGameplayState({ state: this.run, content: this.pack });
  }

  dispatch(intent: PlayerIntent): void {
    this.notice = null;
    // A new intent implicitly dismisses any confirm-aggression prompt left over from a prior,
    // now-stale, dispatch.
    this.pendingDecision = null;
    const commandId = this.nextCommandId();
    const outcome = dispatchIntent(this.run, intent, {
      pack: this.pack,
      commandId,
      expectedRevision: this.run.revision,
    });

    if (outcome.kind === 'rejected') {
      this.appendSystemLine(outcome.message);
      this.publish();
      return;
    }

    if (outcome.kind === 'house') {
      this.setHouseOpen(true);
      return;
    }

    if (outcome.kind === 'transition') {
      if (outcome.onboardingIntentType) this.noteOnboardingIntent(outcome.onboardingIntentType);
      // Every floor-entry path -- descend generated/stored, the Final Chamber, ascend, recall
      // return, and the recall-cast follow-on town move -- funnels through this one branch
      // (`dispatchIntent` returns `kind: 'transition'` for all six), so this is the single place a
      // Wanderer checkpoint needs to ride.
      this.applyNewState(outcome.run, outcome.events, { transition: true });
      return;
    }

    this.handleResolution(outcome.resolution, outcome.onboardingIntentType);
  }

  /**
   * The current `PendingFinalChamberChoice`, or `null` off the Chamber floor, once the run has
   * concluded, or once the weakened Heart has already broken loose (`isHeartBossActive` --
   * `reducer.ts` itself rejects every further choice once that's true, so the overlay must stop
   * offering one at the same point). Recomputed fresh on every snapshot -- there is no stored
   * "dismissed" flag, since this choice is never dismissible (see `chooseFinalChamber`'s doc comment).
   */
  private computePendingFinalChamberChoice(): PendingFinalChamberChoice | null {
    if (this.run.conclusion !== null) return null;
    const activeFloor = this.run.floors.find((floor) => floor.floorId === this.run.activeFloorId);
    if (!activeFloor || activeFloor.depth !== FINAL_CHAMBER_DEPTH) return null;
    if (isHeartBossActive(this.run)) return null;
    return { canBreakCycle: heroHoldsAllFragments(this.run, this.pack) };
  }

  /**
   * Dispatches the `final-chamber-choice` command for the given choice -- the ONLY path that ever
   * produces one; unlike `dispatch`, this never goes through `buildIntent`/`PlayerIntent` (there is
   * no intent for it), mirroring `answerDecision`'s direct `GameCommand` construction below. A
   * plain move onto/adjacent to the bound Heart's cell never reaches this method -- the choice is
   * always the overlay's own deliberate button/key action (`FinalChamberChoice.tsx`), never an
   * automatic consequence of movement.
   */
  chooseFinalChamber(choice: FinalChamberChoiceCommand['choice']): void {
    this.notice = null;
    const command: GameCommand = {
      type: 'final-chamber-choice',
      choice,
      commandId: this.nextCommandId(),
      expectedRevision: this.run.revision,
    };
    this.handleResolution(dispatchCommand(this.run, command, { pack: this.pack }));
  }

  answerDecision(confirmed: boolean): void {
    const decision = this.pendingDecision;
    if (!decision) return;
    this.notice = null;
    this.pendingDecision = null;

    if (!confirmed) {
      this.appendSystemLine('You hold back.');
      this.publish();
      return;
    }

    const command: GameCommand = {
      type: 'attack',
      targetActorId: decision.targetActorId,
      commandId: this.nextCommandId(),
      expectedRevision: this.run.revision,
    };
    this.handleResolution(dispatchCommand(this.run, command, { pack: this.pack }));
  }

  /**
   * `masteryIntentType`, when given, is folded into the onboarding ledger ONLY on the success
   * path below (`applyNewState`) -- a decision-required prompt or an outright rejection never
   * "applies" the underlying intent, so neither counts toward mastery (per the design rule: only
   * applied results teach).
   */
  private handleResolution(resolution: CommandResolution, masteryIntentType?: string | null): void {
    const { result } = resolution;
    if (result.status === 'decision_required') {
      this.pendingDecision =
        projectDecision({ state: this.run, content: this.pack, decision: result.decision }) ??
        result.decision;
      this.lastEvents = [];
      this.publish();
      return;
    }
    if (result.status === 'rejected') {
      this.appendSystemLine(
        result.reason === 'stale_revision'
          ? 'That action is out of date.'
          : 'That action was already handled.',
      );
      this.publish();
      return;
    }
    if (masteryIntentType) this.noteOnboardingIntent(masteryIntentType);
    this.applyNewState(resolution.state, resolution.events);
  }

  private applyNewState(
    state: ActiveRun,
    events: readonly PublicEvent[],
    options?: Readonly<{ transition?: boolean }>,
  ): void {
    this.run = state;
    const folded = foldEventsIntoLog(this.log, events, this.nextLogId);
    this.log = folded.log;
    this.nextLogId = folded.nextId;
    this.lastEvents = events;
    this.pendingDecision = null;
    this.persist();
    // AFTER `persist()`, so a full-storage failure surfaces on the run save (the thing the player
    // cannot lose) before the checkpoint (the thing they can).
    if (options?.transition === true) this.writeRiseCheckpoint();
    this.publish();
  }

  /**
   * Captures this run's rewind point: the full encoded state at floor entry, for a Wanderer death
   * to rise from. Called only from `applyNewState`'s transition path, and only in Wanderer -- a
   * Classic run must leave storage byte-for-byte as it is today.
   *
   * A quota failure is survivable, not fatal: the checkpoint is dropped, the player is told the
   * Deep will not promise a return, and play continues -- that death then behaves like Classic
   * without a Hall record (see `riseAgain`'s missing-checkpoint branch).
   */
  private writeRiseCheckpoint(): void {
    if (this.run.mode !== 'wanderer') return;
    try {
      this.storage.set(CHECKPOINT_KEY, encodeActiveRun(this.run));
    } catch {
      this.clearRiseCheckpoint();
      this.appendSystemNote('The Deep will not promise a return.');
    }
  }

  private clearRiseCheckpoint(): void {
    this.storage.remove?.(CHECKPOINT_KEY);
  }

  /**
   * Rewinds a concluded Wanderer run to its floor-entry checkpoint and resumes play. The whole
   * operation is host-side: the engine never sees a "resurrection", it simply receives a fully
   * self-consistent earlier state whose RNG streams, revision, turn, and worldTime all rewind
   * together (the accepted pure-rewind decision -- the floor replays byte-identically until the
   * player diverges). `finalizeRun` is never called for this death, so the Hall, the heirloom
   * roll, the lifetime, and the artifact ledger are all untouched.
   *
   * The command-sequence counter deliberately does NOT rewind: it is session state, not run
   * state, so ids keep climbing and no post-rise command can collide with one the pre-death life
   * already used.
   */
  riseAgain(): boolean {
    if (this.run.mode !== 'wanderer' || this.run.conclusion === null) return false;
    const raw = this.storage.get(CHECKPOINT_KEY);
    if (raw === null) return this.refuseRise();
    let restored: ActiveRun;
    try {
      restored = decodeActiveRun(raw, this.pack);
    } catch (error) {
      if (!(error instanceof SaveLoadError)) throw error;
      return this.refuseRise();
    }
    if (restored.contentHash !== this.pack.hash) return this.refuseRise();
    // A checkpoint belongs to exactly ONE run. A blob left by a different run of the same content
    // pack decodes perfectly and would swap the player into a run they never played -- and a
    // later accept-death would then write ITS Hall record. The run seed is the run's identity
    // (`deriveHallRecordId` is derived from it), so it is what has to match.
    if (restored.runSeed.some((word, index) => word !== this.run.runSeed[index])) {
      return this.refuseRise();
    }
    this.run = restored;
    this.pendingDecision = null;
    this.lastEvents = [];
    this.notice = null;
    this.appendSystemLine('You rise at the floor’s mouth. The Deep did not notice.');
    this.persist();
    this.publish();
    return true;
  }

  /** The shared degrade path: no usable checkpoint, so this death stands and the caller falls
   * through to Accept-death. Never throws; the concluded run is left exactly as it was. */
  private refuseRise(): boolean {
    this.clearRiseCheckpoint();
    this.appendSystemLine('The Deep offers no way back. This death stands.');
    this.publish();
    return false;
  }

  private appendSystemLine(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'system' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
    this.lastEvents = [];
  }

  /** A client-only system line (auto-explore's stop reports) on the same log the engine's events
   * fold into. Same tone as `appendSystemLine`, but -- exactly like `appendReveal` below -- it
   * never clears `lastEvents`: it is written at the tail of a walk the engine has already resolved,
   * so the effects layer (`ui/playfield/scene-state.ts` derives the hurt flash and event particles
   * from `snapshot.lastEvents`) must keep the events of the turn that stopped the walk. */
  private appendSystemNote(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'system' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
  }

  /** Appends a client-only flavor line (a lore first-reveal, `newLoreReveals`) straight onto the
   * SAME log the engine's own events fold into (`foldEventsIntoLog`) -- there is no separate
   * client-log buffer to merge in `LogPanel`; this is deliberately the least-invasive of the two
   * injection points the task considered. Unlike `appendSystemLine`, this never clears
   * `lastEvents`: it always runs from inside `syncSightings`, at the tail of a `publish()` that may
   * have just set `lastEvents` from a real dispatch (e.g. a combat event the effects layer still
   * needs), and a reveal line must never erase that. */
  private appendReveal(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'info' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
  }

  private persist(): void {
    // `encodeActiveRun` can throw a `SaveLoadError` when the run violates an engine invariant —
    // that is a bug, not a storage problem, so it must propagate loudly rather than being
    // misreported as a storage failure. Only the storage write itself is classified below.
    const encoded = encodeActiveRun(this.run);
    try {
      this.storage.set(SAVE_KEY, encoded);
    } catch (error) {
      this.notice = { kind: 'storage', failure: classifyStorageFailure(error) };
    }
  }

  /**
   * Folds the current projection's freshly-perceived content ids into the sighting cache
   * (`accumulateSightings`, `codex.ts`), then best-effort persists it. Called once at construction
   * (boot restore) and again at the top of every `publish()` -- i.e. after every dispatch, decision
   * answer, and rejected/invalid command alike, exactly the "after every publish" rule. Reads the
   * PRIOR persisted value fresh each time (not just `this.sightings`) so a sighting recorded by a
   * different tab/reload of the same guest session is never lost.
   *
   * A write failure here downgrades gracefully: `this.sightings` (in-memory) already reflects the
   * accumulation regardless of whether the write below succeeds, so the codex stays fully correct
   * for the remainder of THIS session even if storage is full/unavailable -- only cross-reload
   * persistence is lost, surfaced via the same `storage` notice `persist()` (the run save) uses.
   * Never overwrites an already-pending notice of the SAME kind (e.g. a run-save failure this same
   * turn) with a second, redundant one.
   *
   * `emitReveals` gates the lore first-reveal log lines (`newLoreReveals`, diffed against THIS
   * session's own previously-synced `this.sightings`, never the freshly-reloaded `loaded.sightings`
   * -- so a sighting some other tab already recorded still reveals here the first time this
   * session itself observes it): `false` only for the constructor's own boot-restore call, so a
   * restored session's entire pre-existing sighting set is never re-announced as a fresh discovery.
   * Every subsequent call, from `publish()`, passes `true`.
   */
  private syncSightings(emitReveals: boolean): void {
    const loaded = loadSightings(this.storage);
    if (loaded.corrupted) this.markSightingsCorrupted();
    const next = accumulateSightings(loaded.sightings, this.currentProjection());
    if (emitReveals) {
      for (const line of newLoreReveals(this.sightings, next, this.pack)) this.appendReveal(line);
    }
    this.sightings = next;
    try {
      saveSightings(this.storage, this.sightings);
    } catch (error) {
      if (this.notice === null || this.notice.kind !== 'storage') {
        this.notice = { kind: 'storage', failure: classifyStorageFailure(error) };
      }
    }
  }

  /** Surfaces the standard dismissible `data-reset` notice for a corrupted sighting-cache blob --
   * exactly once per session (see `sightingsCorruptionNotified`'s doc comment), and never over an
   * in-progress `storage` (write) failure, which is the more urgent, ongoing condition. */
  private markSightingsCorrupted(): void {
    if (this.sightingsCorruptionNotified) return;
    this.sightingsCorruptionNotified = true;
    if (this.notice !== null && this.notice.kind === 'storage') return;
    this.notice = { kind: 'data-reset', source: 'sightings' };
  }

  /** Same posture as `markSightingsCorrupted` above, for a Hall of Records that could not seed
   * this run -- the run is playable, but without its standings, champions, or artifact offer. */
  private markHallCorrupted(): void {
    if (this.notice !== null && this.notice.kind === 'storage') return;
    this.notice = { kind: 'data-reset', source: 'hall' };
  }

  /** Same posture as `markSightingsCorrupted` above, for the onboarding mastery ledger. */
  private markOnboardingCorrupted(): void {
    if (this.onboardingCorruptionNotified) return;
    this.onboardingCorruptionNotified = true;
    if (this.notice !== null && this.notice.kind === 'storage') return;
    this.notice = { kind: 'data-reset', source: 'onboarding' };
  }

  /** Folds `intentType` into the onboarding mastery ledger and best-effort persists it -- does NOT
   * publish itself (every caller already publishes right after, via `applyNewState` or its own
   * public wrapper below), so this never causes a redundant extra notification. */
  private noteOnboardingIntent(intentType: string): void {
    this.onboarding = recordIntent(this.onboarding, intentType);
    try {
      saveOnboarding(this.localStorage, this.onboarding);
    } catch {
      // Best-effort, same posture as every other cosmetic/secondary write in this session layer
      // (the sighting cache, the command-sequence counter) -- the in-memory ledger is already
      // correct for the rest of this session regardless of whether the write itself succeeds.
    }
  }

  /** Records a UI-only onboarding milestone that never goes through `dispatch` at all -- opening
   * the character-sheet or inventory overlay (`PlayScreen`'s key dispatcher calls this alongside
   * forwarding the open to `App`). Public because these events originate outside this class,
   * unlike `noteOnboardingIntent` above (folded from `dispatch`'s own applied-intent path). */
  recordOnboardingIntent(intentType: string): void {
    this.noteOnboardingIntent(intentType);
    this.publish();
  }

  /** Retires a hint for good -- the strip's dedicated dismiss key. */
  dismissOnboardingHint(hintId: string): void {
    this.onboarding = dismissHint(this.onboarding, hintId);
    try {
      saveOnboarding(this.localStorage, this.onboarding);
    } catch {
      // Best-effort, same posture as `noteOnboardingIntent` above.
    }
    this.publish();
  }

  /** A dialogue topic's `reveal-lore` consequence -- see `RunSession.revealLore`'s doc comment for
   * the full contract. Mirrors `syncSightings`'s reveal path (direct-insert, persist, one log
   * line) but reads/writes `this.sightings` directly rather than re-loading from storage: unlike a
   * perceived sighting, a narrative reveal is never raced by another tab, so there is nothing to
   * merge in from a fresh storage read. Idempotent via the plain `includes` check below -- a
   * second reveal of the same id is already present in `this.sightings`, so `insertSighting`
   * would be a no-op anyway, but skipping it outright also skips the duplicate log line. */
  revealLore(contentId: string): void {
    if (this.sightings.monsterIds.includes(contentId) || this.sightings.itemIds.includes(contentId))
      return;
    this.sightings = insertSighting(this.sightings, this.pack, contentId);
    try {
      saveSightings(this.storage, this.sightings);
    } catch (error) {
      if (this.notice === null || this.notice.kind !== 'storage') {
        this.notice = { kind: 'storage', failure: classifyStorageFailure(error) };
      }
    }
    const name = monsterById(this.pack, contentId)?.name ?? itemById(this.pack, contentId)?.name;
    if (name) this.appendReveal(revealLine(name));
    this.publish();
  }

  /** See `RunSession.noteSystemLine` -- a client-only line (auto-explore's stop reports) on the
   * same log the engine's events fold into, with no dispatch and no turn. Goes through
   * `appendSystemNote` rather than `appendSystemLine` so it never erases the `lastEvents` of the
   * turn that stopped the walk. */
  noteSystemLine(text: string): void {
    this.appendSystemNote(text);
    this.publish();
  }

  setHouseOpen(open: boolean): void {
    this.houseOpen = open;
    this.publish();
  }

  /**
   * Finalizes this session's concluded run into the guest Hall exactly once. Throws if the run
   * has not concluded. If the engine's own `conclusion.finalized` flag is already `true` — a save
   * restored from a run that was finalized in a previous page life (Continue into a dead run) —
   * this does NOT re-finalize: it looks the existing record up in `repository` by this run's
   * deterministic hall-record ID and projects from that, so a repeated call (or a reload) never
   * re-appends. If the Hall has no matching record — e.g. the guest's Hall storage was reset
   * (corrupt blob) while the save survived — this degrades to a `record: null` projection (score
   * and heirloom `null`, `finalized: false`) rather than throwing: the conclusion screen already
   * knows how to render that shape, exactly like the in-progress-run projection in
   * `buildSnapshot` below. Otherwise it runs `finalizeRun`, appends the new record (with the
   * caller-supplied `enrichment`) and lifetime deltas into `repository`, persists the now-finalized
   * run through the usual codec, folds the finalize events into the log, republishes the snapshot,
   * and returns the full projection (score, heirloom, achievement grants).
   */
  finalizeConcludedRun(
    repository: RunRecordRepository,
    enrichment: HallRecordEnrichment,
  ): RunConclusionProjection {
    const { conclusion } = this.run;
    if (conclusion === null) {
      throw new Error('finalizeConcludedRun requires a concluded run');
    }
    // This run is over for good: nothing may rise from it again, on this page life or a later
    // one. Every conclusion path funnels through here -- an accepted death, a victory, a restored
    // already-finalized run -- so this is the single place the rewind point has to be retired. A
    // rise never reaches this method (it discards the conclusion instead), and the transition it
    // resumes into rewrites the checkpoint anyway.
    this.clearRiseCheckpoint();

    if (conclusion.finalized) {
      const recordId = deriveHallRecordId(this.run.runSeed, this.run.contentHash);
      const record =
        repository.records().find((candidate) => candidate.recordId === recordId) ?? null;
      const projection = projectRunConclusion({ run: this.run, record, achievements: [] });
      if (projection === null) {
        throw new Error('internal invariant: an already-concluded run projected to null');
      }
      return projection;
    }

    const finalized = finalizeRun({
      run: this.run,
      content: this.pack,
      lifetime: repository.lifetime(),
    });
    const stored: StoredHallRecord = { ...finalized.record, enrichment };
    repository.appendRecord(stored);
    // Lifetime deltas first, artifact deltas second: applying the artifact stints runs the
    // ledger's reconcile pass, which must already see this run's newly conquered champions.
    repository.applyDeltas(finalized.deltas);
    repository.applyArtifactDeltas(finalized.artifactDeltas);
    // Becoming the Heart writes the guest's lineage slot in the same finalize: the next new run
    // reads it back as its inherited Heart, so this must happen before `this.persist()` below.
    if (finalized.record.completionType === 'became-heart') {
      repository.recordHeart({
        heroName: finalized.record.heroName,
        classTags: finalized.record.classTags,
        hallRecordId: finalized.record.recordId,
        enrichment,
      });
    }

    this.run = finalized.run;
    // `finalizeRun` only ever emits `run.finalized`/`achievement.granted` (see run-finalize.ts),
    // both members of `PublicEvent` too — but their shared static type is the broader
    // `DomainEvent`, which also covers variants `PublicEvent` excludes (e.g. `AttackMissedEvent`).
    const events = finalized.events as readonly PublicEvent[];
    const folded = foldEventsIntoLog(this.log, events, this.nextLogId);
    this.log = folded.log;
    this.nextLogId = folded.nextId;
    this.persist();

    const projection = projectRunConclusion({
      run: this.run,
      record: stored,
      achievements: finalized.deltas.achievementGrants,
    });
    if (projection === null) {
      throw new Error('internal invariant: a just-finalized run projected to null');
    }
    this.publish();
    return projection;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  private buildSnapshot(): SessionSnapshot {
    return {
      projection: this.currentProjection(),
      log: this.log,
      lastEvents: this.lastEvents,
      pendingDecision: this.pendingDecision,
      pendingFinalChamberChoice: this.computePendingFinalChamberChoice(),
      notice: this.notice,
      houseOpen: this.houseOpen,
      conclusion:
        this.run.conclusion === null
          ? null
          : projectRunConclusion({ run: this.run, record: null, achievements: [] }),
      sightings: this.sightings,
      heroClassTags: [...this.run.hero.classTags],
      onboarding: this.onboarding,
    };
  }

  private publish(): void {
    this.syncSightings(true);
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
