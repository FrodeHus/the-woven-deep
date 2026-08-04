import type Database from 'better-sqlite3';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  createNewRun,
  decodeActiveRun,
  encodeActiveRun,
  finalizeRun,
  heroFromChoices,
  canAssembleTablet,
  isHeartBossActive,
  projectGameplayState,
  newRunRecords,
  projectRunConclusion,
  SaveLoadError,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type HeroChoices,
  type AchievementGrant,
  type GameCommand,
  type NewRunHero,
  type PublicDecision,
  type PublicEvent,
  type RunMode,
  type StoredHallRecord,
  type Uint32State,
} from '@woven-deep/engine';
import {
  canStartClass,
  classEntryForHeroTags,
  dispatchCommand,
  dispatchIntent,
  evaluateUnlocks,
  runTravelBatch,
  type PlayerIntent,
  type ServerRunSnapshot,
  type TravelBatchRequest,
  type TravelBatchResult,
} from '@woven-deep/session-core';
import type { ActiveRunRepository } from '../db/active-run-repository.js';
import type { ServerRunRecordRepository } from '../db/hall-repository.js';

/**
 * How many consecutive pure-movement commands may apply before the server checkpoints the run to
 * SQLite, per the 6B "consequential-immediate + movement-checkpoint" save cadence. A hard crash
 * can thus lose at most this many moves — the tiny, accepted window. Any consequential command
 * (see {@link CONSEQUENTIAL_EVENT_TYPES}), floor transition, or conclusion always persists
 * immediately and resets the counter.
 */
export const MOVEMENT_CHECKPOINT_INTERVAL = 10;

/**
 * Event kinds that make a command "consequential" — worth persisting immediately. Everything NOT
 * in this set (pure locomotion, per-turn bookkeeping like `hero.moved`/`actor.turn.*`/`fuel.warning`/
 * routine condition ticks) is checkpoint-eligible, but ONLY when the dispatched intent was a plain
 * `move` (deliberate non-move actions always persist immediately). Erring toward over-saving is
 * safe; the only cost of a false "consequential" is a redundant WAL write.
 */
export const CONSEQUENTIAL_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'attack.missed',
  'attack.hit',
  'actor.damaged',
  'hero.damaged',
  'actor.died',
  'actor.healed',
  'loot.dropped',
  'item.picked-up',
  'currency.collected',
  'item.dropped',
  'item.stack-split',
  'item.consumed',
  'item.thrown',
  'item.used',
  'item.equipped',
  'item.unequipped',
  'item.light-toggled',
  'item.refueled',
  'item.identified',
  'item.damaged',
  'item.light-extinguished',
  'identification.appearance-revealed',
  'hunger.stage-changed',
  'hunger.restored',
  'door.opened',
  'door.closed',
  'door.unlocked',
  'feature.revealed',
  'feature.searched',
  'trap.triggered',
  'trap.disarmed',
  'trap.disarm-failed',
  'lock.picked',
  'lock.pick-failed',
  'chest.jammed',
  'population.encountered',
  'group.leader-created',
  'group.leader-defeated',
  'group.outcome-applied',
  'swarm.members-created',
  'swarm.source-destroyed',
]);

/** The `ServerRunSnapshot` shape now lives in `@woven-deep/session-core` (shared with
 * `apps/web`) -- re-exported here so existing local importers keep working unchanged. */
export type { ServerRunSnapshot };

/** Matches a command id minted by `ProfileSession.nextCommandId` (`command.profile-` + a
 * zero-padded counter), capturing the counter. Deliberately anchored and digits-only so nothing
 * else in the retained window -- the `command.profile-start-N` ids of the chargen handshake, or a
 * guest-minted `command.guest-...` id in a blob that somehow crossed over -- can be read as one. */
const PROFILE_COMMAND_ID_PATTERN = /^command\.profile-(\d+)$/;

/**
 * One past the highest profile-minted command sequence still held in `recentCommands` -- the floor
 * a reconnecting client must start its counter at so no freshly-minted id collides with one the
 * reducer still remembers (see `ServerRunSnapshot.nextCommandSequence` for the full rationale).
 * Returns 0 for a run whose window holds no profile-minted ids at all (a brand-new run, or one
 * whose window has rolled over entirely to other id shapes).
 */
export function nextCommandSequenceFor(run: ActiveRun): number {
  let highest = -1;
  for (const entry of run.recentCommands) {
    const match = PROFILE_COMMAND_ID_PATTERN.exec(entry.command.commandId);
    if (match === null) continue;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence) && sequence > highest) highest = sequence;
  }
  return highest + 1;
}

/** What one batched travel walk produced: a snapshot per applied step, why it ended, and the
 * offered-item record grown by it. `reason: null` means only the batch cap was reached, so the
 * walk is still viable and the client should ask for the next batch. */
export interface TravelApplication {
  readonly snapshots: readonly ServerRunSnapshot[];
  /** Steps the walk actually APPLIED. Not `snapshots.length`: a walk with nothing to do still
   * carries one snapshot so the client has something to settle against, having applied nothing. */
  readonly stepsTaken: number;
  readonly reason: TravelBatchResult['reason'];
  readonly offeredItemIds: readonly string[];
}

export type ApplyOutcome =
  | { readonly kind: 'state'; readonly snapshot: ServerRunSnapshot }
  | {
      readonly kind: 'decision-required';
      readonly decision: PublicDecision;
      readonly snapshot: ServerRunSnapshot;
    }
  | { readonly kind: 'rejected'; readonly reason: string; readonly snapshot: ServerRunSnapshot };

/** Thrown by {@link ServerPlaySession.open} when a stored run's content hash does not match the
 * server's current pack — the client and server engines/content have diverged and must not
 * silently continue. The WS layer maps this to a version/content `error`. */
export class ContentHashMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`active run content hash ${actual} does not match server pack ${expected}`);
    this.name = 'ContentHashMismatchError';
  }
}

/** Thrown by {@link ServerPlaySession.open} when a supplied `hero` was built from a
 * `playable: false` class the profile has not earned (i.e. `classId` is absent from the
 * profile's persisted `unlocks()`) — the run-start anti-cheat guard. The WS layer maps this to a
 * rejection/error rather than silently starting the run. */
export class LockedClassError extends Error {
  constructor(readonly classId: string) {
    super(`class ${classId} is locked and has not been unlocked for this profile`);
    this.name = 'LockedClassError';
  }
}

type Clock = () => string;

/**
 * Holds one authoritative `ActiveRun` for a profile in memory, applies intents/commands through the
 * shared `@woven-deep/session-core` orchestration (the exact same engine the guest runs locally),
 * and persists to SQLite per the 6B save cadence. Transport-free (no WebSocket/Fastify) so it unit-
 * tests directly; the server owns the seed, command resolution, and persistence.
 */
export class ServerPlaySession {
  private readonly pack: CompiledContentPack;
  private readonly repo: ActiveRunRepository;
  private readonly hallRepo: ServerRunRecordRepository;
  private readonly database: Database.Database;
  private readonly profileId: string;
  private readonly clock: Clock;
  private readonly portraitGlyph: string;
  private run!: ActiveRun;
  private houseOpen = false;
  private lastEvents: readonly PublicEvent[] = [];
  private pendingDecision: PublicDecision | null = null;
  private movesSinceCheckpoint = 0;
  private dirty = false;
  /** The Wanderer rewind blob this session will write on its next persist -- rehydrated from the
   * stored row on `open()`, refreshed at every floor transition, and always `null` for a Classic
   * run. Held here rather than re-read per persist so the single-row upsert stays one statement.
   * Distinct from `checkpoint()` below, which is the unrelated movement dirty-counter. */
  private checkpointBlob: string | null = null;
  // Set exactly once, by `maybeFinalize()`, the run this conclusion belongs to -- carried here
  // (rather than re-derived) so `snapshot()` can project the real score/heirloom/achievements
  // without re-touching the Hall repository on every snapshot.
  private finalizedRecord: StoredHallRecord | null = null;
  private finalizedAchievements: readonly AchievementGrant[] = [];

  constructor(
    input: Readonly<{
      pack: CompiledContentPack;
      repo: ActiveRunRepository;
      hallRepo: ServerRunRecordRepository;
      database: Database.Database;
      profileId: string;
      clock?: Clock;
      portraitGlyph?: string;
    }>,
  ) {
    this.pack = input.pack;
    this.repo = input.repo;
    this.hallRepo = input.hallRepo;
    this.database = input.database;
    this.profileId = input.profileId;
    this.clock = input.clock ?? (() => new Date().toISOString());
    this.portraitGlyph = input.portraitGlyph ?? '@';
  }

  /**
   * Loads the profile's run — rehydrating a stored one (guarding its content hash) or creating a
   * fresh one. The SERVER supplies the seed (anti-cheat: a client-provided seed is never trusted);
   * `hero` is the profile's chosen hero (defaults to the guest hero until the start-run flow lands).
   * A freshly-created run is persisted immediately so a reconnect finds it.
   */
  open(
    input: Readonly<{ hero?: NewRunHero; seed: Uint32State; mode?: RunMode }>,
  ): ServerRunSnapshot {
    const stored = this.repo.get(this.profileId);
    if (stored !== undefined) {
      if (stored.contentHash !== this.pack.hash) {
        throw new ContentHashMismatchError(this.pack.hash, stored.contentHash);
      }
      this.run = decodeActiveRun(stored.runBlob, this.pack);
      this.checkpointBlob = stored.checkpointBlob;
    } else {
      const hero = input.hero ?? DEFAULT_GUEST_HERO;
      // Anti-cheat run-start guard: until profile hero-customization (chargen go-live) lands, a
      // supplied `hero` is always `DEFAULT_GUEST_HERO` (a `playable: true` class), so this branch
      // never fires today -- it exists so that once a client can supply its own chosen class, a
      // profile can never start a run as a `playable: false` class it has not earned, even if the
      // client bypasses the chargen UI's own checks (`heroFromChoices`'s `requireClass`, which
      // rejects locked classes unconditionally but has no notion of a profile's *earned* unlocks).
      if (input.hero !== undefined) {
        const classEntry = classEntryForHeroTags(this.pack, input.hero.classTags);
        if (
          classEntry !== undefined &&
          !canStartClass({
            classId: classEntry.id,
            unlockedClassIds: this.hallRepo.unlocks(),
            content: this.pack,
          })
        ) {
          throw new LockedClassError(classEntry.id);
        }
      }
      this.run = createNewRun({
        pack: this.pack,
        seed: input.seed,
        hero,
        mode: input.mode ?? 'classic',
        // The profile's cross-run history, through the same builder the guest host uses: Hall
        // standings become this run's champion/Echo encounters, the ledger's still-unsecured
        // artifacts become its vault-artifact pool, and the lifetime's conquered champions stay
        // conquered. A Hall this corrupt is a server-side bug, not survivable input (the guest's
        // browser-storage Hall degrades instead) -- so a throw here propagates.
        records: newRunRecords(this.hallRepo, this.pack),
      });
      this.persist();
    }
    // A reconnect may load a run that concluded but never finished finalizing (e.g. a crash
    // between the conclusion-producing command and the finalize step below) -- catch it up here.
    this.maybeFinalize();
    return this.snapshot();
  }

  /** Whether this session holds a run at all — false only for a fresh session whose profile had no
   * stored row and has not answered the `no-run` push with `start-run` yet. */
  hasRun(): boolean {
    return this.run !== undefined;
  }

  /**
   * Answers a `no-run` push: builds the hero from the wizard's CHOICES through the engine's own
   * `heroFromChoices` (which validates class/kit/background/traits/attributes/name and throws on
   * anything illegal — the wire layer only shape-checked), then opens a fresh run with the given
   * mode. The caller supplies the seed (server-rolled, exactly like the connect-time path). The
   * class-unlock guard is `open()`'s existing one. Throws exactly what `heroFromChoices`/`open`
   * throw; a run already in progress is answered with its current snapshot instead of a second
   * run.
   */
  startRun(
    input: Readonly<{ choices: HeroChoices; mode: RunMode; seed: Uint32State }>,
  ): ServerRunSnapshot {
    if (this.hasRun()) return this.snapshot();
    const hero = heroFromChoices({ pack: this.pack, choices: input.choices });
    return this.open({ seed: input.seed, hero, mode: input.mode });
  }

  /** Applies a dispatched player intent, mutating + persisting the authoritative run. */
  applyIntent(
    input: Readonly<{ commandId: string; expectedRevision: number; intent: PlayerIntent }>,
  ): ApplyOutcome {
    // Once finalized, the run is over: any further command (a stray resend, a reconnect that
    // raced the finalize, etc.) is a no-op rather than being dispatched -- dispatching would risk
    // replaying a *cached* pre-finalize resolution (see `dispatchIntent`'s idempotency cache) and
    // re-entering `maybeFinalize()`, whose Hall-record append would then collide on the
    // deterministic record ID.
    if (this.isFinalized()) {
      return { kind: 'state', snapshot: this.snapshot() };
    }
    const outcome = dispatchIntent(this.run, input.intent, {
      pack: this.pack,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (outcome.kind === 'rejected') {
      return { kind: 'rejected', reason: outcome.message, snapshot: this.snapshot() };
    }
    if (outcome.kind === 'house') {
      this.houseOpen = true;
      this.lastEvents = [];
      return { kind: 'state', snapshot: this.snapshot() };
    }
    if (outcome.kind === 'transition') {
      // A floor change is always consequential — persist immediately. In Wanderer the same write
      // carries the run's new rewind point: `outcome.run` IS the floor-entry state, so the two
      // blobs are identical here and diverge from the next command onward.
      //
      // Unless the transition itself concluded the run: an `on-floor-enter` curse can kill the
      // hero on arrival, and storing that arrival as the rewind point would make every rise land
      // back in the same death. The previous floor's checkpoint is kept instead.
      this.run = outcome.run;
      this.lastEvents = outcome.events;
      this.pendingDecision = null;
      if (this.run.mode === 'wanderer' && this.run.conclusion === null) {
        this.checkpointBlob = encodeActiveRun(this.run);
      }
      this.persist();
      // A transition can conclude the run (the lethal-arrival case above), and a conclusion has to
      // finalize wherever it happens -- otherwise a Classic transition death silently misses the
      // Hall and every later command is rejected before finalize is ever reached. Mode-gated
      // inside, so a Wanderer death still stays undecided here.
      this.maybeFinalize();
      return { kind: 'state', snapshot: this.snapshot() };
    }
    // outcome.kind === 'command'
    return this.applyResolution(outcome.resolution, input.intent.type === 'move');
  }

  /**
   * Walks a batched travel intent, applying up to `TRAVEL_BATCH_CAP` steps.
   *
   * Every step goes through {@link applyIntent}, so floor transitions, Wanderer checkpoints, the
   * persistence cadence and finalize-on-conclusion all behave exactly as they do for a single
   * dispatched move. The only thing batching removes is the round trip between steps.
   *
   * Returns one snapshot per applied step — including the snapshot of a step that ENDED the batch —
   * so the client can render each turn in order rather than watching every other actor jump forward
   * at once.
   */
  applyTravel(
    input: Readonly<{
      commandId: string;
      expectedRevision: number;
      request: TravelBatchRequest;
    }>,
  ): TravelApplication {
    if (this.isFinalized()) {
      return { snapshots: [this.snapshot()], stepsTaken: 0, reason: 'blocked', offeredItemIds: [] };
    }

    const snapshots: ServerRunSnapshot[] = [];
    // Set when a step came back as anything other than a plain `state`. A rejection is a genuine
    // "the way is blocked"; a decision-required is not an error at all -- the modal the snapshot
    // opens explains itself, and the client suppresses travel while one is up -- so it ends the
    // walk silently rather than logging a stop that would read as a fault.
    let interrupted: 'rejected' | 'decision-required' | null = null;

    const result = runTravelBatch({
      run: this.run,
      pack: this.pack,
      request: input.request,
      apply: (intent, index) => {
        const outcome = this.applyIntent({
          // Per-step ids derived from the batch's own, so the reducer's existing `recentCommands`
          // dedup works unchanged and a replayed batch is idempotent step-for-step. The separator
          // must stay within the save schema's id pattern (`[a-z0-9._:-]`) -- a `/` is rejected on
          // persist. `nextCommandSequenceFor`'s pattern is anchored and digits-only, so these
          // suffixed ids are ignored by it and the command-sequence seeding is unaffected.
          commandId: `${input.commandId}:${index}`,
          // Only the FIRST step is checked against what the client observed; the rest are
          // sequential by construction and must follow the run this batch is building.
          expectedRevision: index === 0 ? input.expectedRevision : this.run.revision,
          intent,
        });
        snapshots.push(outcome.snapshot);
        if (outcome.kind !== 'state') {
          interrupted = outcome.kind;
          return null;
        }
        return { run: this.run, events: this.lastEvents };
      },
    });

    // `snapshots` is empty when the walk had nothing to do at all (an already-explored floor, an
    // empty plan). The client still needs a snapshot to settle against.
    if (snapshots.length === 0) snapshots.push(this.snapshot());

    return {
      snapshots,
      stepsTaken: result.steps.length,
      reason:
        interrupted === 'decision-required'
          ? 'blocked'
          : interrupted
            ? 'action-invalid'
            : result.reason,
      offeredItemIds: result.offeredItemIds,
    };
  }

  /** Applies a raw engine command (the decision / final-chamber paths that bypass `buildIntent`). */
  applyCommand(command: GameCommand): ApplyOutcome {
    if (this.isFinalized()) {
      return { kind: 'state', snapshot: this.snapshot() };
    }
    return this.applyResolution(dispatchCommand(this.run, command, { pack: this.pack }), false);
  }

  /** Whether this session's run has already been finalized into the Hall -- once true, the run is
   * permanently over and no further command may mutate it (see the guards in `applyIntent` /
   * `applyCommand` above). */
  private isFinalized(): boolean {
    return this.run.conclusion !== null && this.run.conclusion.finalized;
  }

  /**
   * The "no" branch of a `confirm-aggression` prompt — mirrors the guest's
   * `answerDecision(false)`: clears the pending decision without ever building or resolving an
   * engine command (there is nothing to apply; the hero simply holds back). A no-op, returning the
   * current snapshot, when no decision is pending.
   */
  declineDecision(): ApplyOutcome {
    this.pendingDecision = null;
    return { kind: 'state', snapshot: this.snapshot() };
  }

  private applyResolution(
    resolution: ReturnType<typeof dispatchCommand>,
    isMoveIntent: boolean,
  ): ApplyOutcome {
    const { result } = resolution;
    if (result.status === 'decision_required') {
      this.pendingDecision = result.decision;
      return { kind: 'decision-required', decision: result.decision, snapshot: this.snapshot() };
    }
    if (result.status === 'invalid' || result.status === 'rejected') {
      return { kind: 'rejected', reason: result.reason, snapshot: this.snapshot() };
    }
    // applied
    this.run = resolution.state;
    this.lastEvents = resolution.events;
    this.pendingDecision = null;

    const consequential =
      !isMoveIntent ||
      this.run.conclusion !== null ||
      resolution.events.some((event) => CONSEQUENTIAL_EVENT_TYPES.has(event.type));
    if (consequential) {
      this.persist();
    } else {
      this.checkpoint();
    }
    // The run has just (possibly) concluded -- finalize it into the Hall before snapshotting, so
    // the conclusion the caller sees is already the real, scored one.
    this.maybeFinalize();
    return { kind: 'state', snapshot: this.snapshot() };
  }

  /**
   * Rewinds a concluded Wanderer run to its floor-entry checkpoint. The client's cached
   * `revision` is HIGHER than the restored run's, so the returned `state` message is treated as
   * an authoritative snapshot push (identical in shape to the reconnect push) and the client
   * re-syncs from it -- the client's own command-sequence counter keeps climbing, so no
   * post-rise `commandId` can collide with one the pre-death life already used.
   *
   * `finalizeRun` is never called for this death: no record, no heirloom roll, no lifetime or
   * artifact deltas, no unlocks, no achievements. Any checkpoint that cannot be trusted -- absent,
   * corrupt, from another content pack, or from another RUN -- falls through to `acceptDeath()`,
   * so the death simply stands. The rewind point itself is left in place: it belongs to the floor,
   * not to one death, so a second death on the same floor can rise from it again.
   */
  riseAgain(): ApplyOutcome {
    // Only a DEATH is a Wanderer's to undo. A victory (or any other completion) is the run's real
    // ending; it is cleared by the finalize gate, never rewound.
    if (
      this.run.mode !== 'wanderer' ||
      this.run.conclusion?.completionType !== 'died' ||
      this.isFinalized()
    ) {
      return { kind: 'state', snapshot: this.snapshot() };
    }
    const stored = this.repo.get(this.profileId);
    const blob = stored?.checkpointBlob ?? null;
    if (blob === null) return this.acceptDeath();
    let restored: ActiveRun;
    try {
      restored = decodeActiveRun(blob, this.pack);
    } catch (error) {
      if (!(error instanceof SaveLoadError)) throw error;
      return this.acceptDeath();
    }
    if (restored.contentHash !== this.pack.hash) return this.acceptDeath();
    // Defense in depth against ever storing a concluded arrival (see the transition branch in
    // `applyIntent`): a checkpoint that is itself concluded can only rise back into that ending.
    if (restored.conclusion !== null) return this.acceptDeath();
    // A checkpoint belongs to exactly ONE run. A blob from a different run of the same pack
    // decodes perfectly and would hand this profile a run it never played (its Hall identity,
    // `deriveHallRecordId`, is derived from the run seed), so the seed is what has to match.
    if (restored.runSeed.some((word, index) => word !== this.run.runSeed[index])) {
      return this.acceptDeath();
    }
    this.run = restored;
    this.pendingDecision = null;
    this.lastEvents = [];
    this.checkpointBlob = blob;
    this.persist();
    return { kind: 'state', snapshot: this.snapshot() };
  }

  /**
   * Ends a concluded Wanderer run with no Hall write at all: the active-run row (and with it the
   * checkpoint) is cleared in one transaction, and the concluded run stays in memory only so the
   * client can render its conclusion screen. A no-op returning the current snapshot for a Classic
   * or unconcluded run.
   */
  acceptDeath(): ApplyOutcome {
    if (this.run.mode !== 'wanderer' || this.run.conclusion === null) {
      return { kind: 'state', snapshot: this.snapshot() };
    }
    this.database.transaction(() => {
      this.repo.clear(this.profileId);
    })();
    this.checkpointBlob = null;
    this.dirty = false;
    return { kind: 'state', snapshot: this.snapshot() };
  }

  /**
   * Finalizes this session's concluded run into the profile's Hall exactly once, mirroring the
   * guest's `finalizeConcludedRun` (see `apps/web/src/session/guest-session.ts`): `finalizeRun`
   * (pure, unchanged engine code) produces the Hall record + lifetime deltas from the server's
   * authoritative run; only the enrichment (`achievedAt`/`portraitGlyph`) is host-supplied. The
   * record is appended, the deltas applied, unlocks re-evaluated over the full updated Hall +
   * lifetime and persisted, this run's achievement grants folded into the lifetime-accumulated
   * set, and the now-finished active run row cleared so the profile can start a new one. A no-op
   * when the run has not concluded, or has already been finalized -- the double-finalize guard
   * that keeps a resend/reconnect from appending a second, colliding Hall record. Everything
   * described here is CLASSIC-only; a Wanderer conclusion never reaches the Hall at all (see the
   * mode gate at the top of the body).
   *
   * Crash-atomicity: every WRITE below (the Hall append, the lifetime/unlocks/achievements
   * updates, and clearing the `active_runs` row) runs inside a single better-sqlite3 transaction
   * on the shared `database` connection (the Hall repo and the active-run repo are both backed by
   * it). A crash or thrown error anywhere inside rolls the whole sequence back atomically: either
   * `active_runs` is cleared and the Hall has the new record (fully committed), or `active_runs`
   * still holds its pre-finalize blob and the Hall has NO record (fully rolled back) -- there is
   * no window where a stale `finalized: false` active-run row can coexist with an already-appended
   * Hall record, which is what previously let a reconnect re-run `finalizeRun` and crash on a
   * colliding, already-taken `recordId`. `finalizeRun` itself stays a pure computation outside the
   * transaction; `this.run`/`finalizedRecord`/`finalizedAchievements` are only updated after the
   * transaction commits, so an aborted transaction never leaves the in-memory session believing a
   * run is finalized when the DB rolled it back.
   *
   * Defensive self-heal: if the Hall already contains a record with this run's (deterministic)
   * `recordId` -- which should now be unreachable in normal operation given the transaction above,
   * but could still occur from manually-corrupted state or a pre-fix on-disk row -- this treats the
   * run as already finalized rather than re-appending (which would throw): it skips the Hall
   * writes, just clears the stale active-run row, and projects the existing record.
   */
  private maybeFinalize(): void {
    if (this.run.conclusion === null || this.run.conclusion.finalized) return;
    // The Hall is 100% Classic (spec §5). A Wanderer conclusion -- death or victory -- writes
    // NOTHING: no record, no lifetime/artifact deltas, no unlock re-evaluation, no achievements,
    // and no heirloom roll (so the `run-records` stream is never advanced). `finalizeRun` is not
    // called, so `conclusion.finalized` stays false and the snapshot projects a record-null
    // conclusion, which is what the client renders.
    //
    // A Wanderer DEATH additionally stays UNDECIDED here: clearing the row would take its
    // checkpoint with it, and `riseAgain` would then have nothing left to restore. The row (and
    // its rewind point) survives until the client answers with `rise-again` or `accept-death` --
    // a reconnect in between re-offers the same choice. Every other Wanderer conclusion is final
    // the moment it happens, so it clears immediately.
    if (this.run.mode === 'wanderer') {
      if (this.run.conclusion.completionType !== 'died') this.acceptDeath();
      return;
    }

    const finalized = finalizeRun({
      run: this.run,
      content: this.pack,
      lifetime: this.hallRepo.lifetime(),
    });

    const existingRecord = this.hallRepo
      .records()
      .find((record) => record.recordId === finalized.record.recordId);

    if (existingRecord !== undefined) {
      this.database.transaction(() => {
        this.repo.clear(this.profileId);
      })();
      this.run = finalized.run;
      this.finalizedRecord = existingRecord;
      this.finalizedAchievements = finalized.deltas.achievementGrants;
      return;
    }

    const stored: StoredHallRecord = {
      ...finalized.record,
      enrichment: { achievedAt: this.clock(), portraitGlyph: this.portraitGlyph },
    };

    this.database.transaction(() => {
      this.hallRepo.appendRecord(stored);
      // Lifetime deltas first, artifact deltas second: applying the artifact stints runs the
      // ledger's reconcile pass, which must already see this run's newly conquered champions.
      this.hallRepo.applyDeltas(finalized.deltas);
      this.hallRepo.applyArtifactDeltas(finalized.artifactDeltas);

      const unlocks = evaluateUnlocks({
        records: this.hallRepo.records(),
        lifetime: this.hallRepo.lifetime(),
        content: this.pack,
      });
      this.hallRepo.setUnlocks(unlocks);
      this.hallRepo.appendAchievements(finalized.deltas.achievementGrants);

      // The run is over -- clear the active run row so the profile's next open() starts fresh.
      this.repo.clear(this.profileId);
    })();

    this.run = finalized.run;
    this.finalizedRecord = stored;
    this.finalizedAchievements = finalized.deltas.achievementGrants;
  }

  /** Persists the latest run state (called on disconnect and any time an unwritten checkpoint is
   * pending). Idempotent: a no-op when nothing has changed since the last write. */
  flush(): void {
    if (this.dirty) this.persist();
  }

  getSnapshot(): ServerRunSnapshot {
    return this.snapshot();
  }

  private checkpoint(): void {
    this.dirty = true;
    this.movesSinceCheckpoint += 1;
    if (this.movesSinceCheckpoint >= MOVEMENT_CHECKPOINT_INTERVAL) this.persist();
  }

  private persist(): void {
    this.repo.upsert({
      profileId: this.profileId,
      runBlob: encodeActiveRun(this.run),
      revision: this.run.revision,
      contentHash: this.pack.hash,
      updatedAt: this.clock(),
      checkpointBlob: this.checkpointBlob,
    });
    this.movesSinceCheckpoint = 0;
    this.dirty = false;
  }

  private snapshot(): ServerRunSnapshot {
    return {
      projection: projectGameplayState({ state: this.run, content: this.pack }),
      lastEvents: this.lastEvents,
      revision: this.run.revision,
      pendingDecision: this.pendingDecision,
      conclusion:
        this.run.conclusion !== null
          ? projectRunConclusion({
              run: this.run,
              record: this.finalizedRecord,
              achievements: this.finalizedAchievements,
            })
          : null,
      houseOpen: this.houseOpen,
      heroClassTags: this.run.hero.classTags,
      bossActive: isHeartBossActive(this.run),
      canBreakCycle: canAssembleTablet(this.run, this.pack),
      nextCommandSequence: nextCommandSequenceFor(this.run),
    };
  }
}
