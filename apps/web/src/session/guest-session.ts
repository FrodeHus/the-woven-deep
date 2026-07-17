import type { CompiledContentPack } from '@woven-deep/content';
import {
  ascendToPreviousFloor, createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, deriveHallRecordId,
  descendToNextFloor, encodeActiveRun,
  finalizeRun, projectDecision, projectDomainEvents, projectGameplayState, projectRunConclusion,
  RECENT_COMMAND_LIMIT, resolveCommand, SaveLoadError,
  type ActiveRun, type CommandResolution, type GameCommand, type GameplayProjection, type HallRecordEnrichment,
  type NewRunHero, type PublicDecision, type PublicEvent, type RunConclusionProjection, type RunRecordRepository,
  type StoredHallRecord, type Uint32State,
} from '@woven-deep/engine';
import { buildIntent } from './command-builder.js';
import { foldEventsIntoLog, LOG_CAPACITY, type LogLine } from './event-log.js';
import type { PlayerIntent } from './intents.js';
import {
  classifyStorageFailure, COMMAND_SEQUENCE_KEY, SAVE_KEY, type SessionStorageLike, type StorageFailure,
} from './storage.js';

/** Width of the zero-padded counter component of a command id — comfortably above what any
 * single guest session could produce, so ids stay a fixed, easy-to-scan shape. */
const COMMAND_SEQUENCE_WIDTH = 10;

export type SessionNotice =
  | { readonly kind: 'restored' }
  | { readonly kind: 'fresh' }
  | { readonly kind: 'save-discarded'; readonly reason: string }
  | { readonly kind: 'storage'; readonly failure: StorageFailure };

export interface SessionSnapshot {
  readonly projection: GameplayProjection;
  readonly log: readonly LogLine[];
  /** Public events from the most recent dispatch, for the effects layer. Cleared on next dispatch. */
  readonly lastEvents: readonly PublicEvent[];
  readonly pendingDecision: PublicDecision | null;
  readonly notice: SessionNotice | null;
  readonly houseOpen: boolean;
  /** Cheap, pure projection of the run's ending once `run.conclusion !== null`: completion facts
   * and metrics are always safe to expose, but this is computed with `record: null` and
   * `achievements: []`, so `finalized` is always `false` here regardless of the engine's own
   * `conclusion.finalized` flag — the full score/heirloom/achievements only ever come from
   * `finalizeConcludedRun`. `null` while the run is still in progress. */
  readonly conclusion: RunConclusionProjection | null;
}

function randomSeed(): Uint32State {
  // Client-only ambient randomness for the seed of a fresh guest run; the engine itself never
  // touches non-deterministic sources.
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  if (words.every((word) => word === 0)) words[0] = 1;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

/**
 * Owns the guest's single active run: booting it from storage (or generating a fresh one),
 * turning `PlayerIntent`s into engine commands, and persisting the result after every dispatch
 * that changes the run. Framework-free — `store.ts` is the only file that touches React.
 */
export class GuestSession {
  private readonly pack: CompiledContentPack;
  private readonly storage: SessionStorageLike;
  private readonly hero: NewRunHero;
  private run: ActiveRun;
  private commandSequence: number;
  private log: readonly LogLine[] = [];
  private nextLogId = 0;
  private lastEvents: readonly PublicEvent[] = [];
  private pendingDecision: PublicDecision | null = null;
  private notice: SessionNotice | null;
  private houseOpen = false;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    input: Readonly<{
      pack: CompiledContentPack; storage: SessionStorageLike; seed?: Uint32State; hero?: NewRunHero;
      /** When `true`, `boot()` never looks at any existing save — it always starts a brand-new run
       * from this constructor's `hero`/`seed`, exactly like an empty storage boot would. This is the
       * seam chargen's "confirm"/"new hero" flows use: without it, any live save in storage would
       * silently win over the wizard's just-confirmed hero (see App.tsx's chargen `onConfirm`).
       * "Continue" and quickstart callers must NOT set this — they rely on restore semantics. */
      startFresh?: boolean;
    }>,
  ) {
    this.pack = input.pack;
    this.storage = input.storage;
    this.hero = input.hero ?? DEFAULT_GUEST_HERO;
    const booted = this.boot(input.seed, input.startFresh ?? false);
    this.run = booted.run;
    this.notice = booted.notice;
    this.commandSequence = booted.commandSequence;
    this.snapshot = this.buildSnapshot();
  }

  private boot(
    seed: Uint32State | undefined, startFresh: boolean,
  ): Readonly<{ run: ActiveRun; notice: SessionNotice; commandSequence: number }> {
    const raw = startFresh ? null : this.storage.get(SAVE_KEY);
    if (raw === null) {
      return { run: this.freshRun(seed), notice: { kind: 'fresh' }, commandSequence: 0 };
    }
    try {
      const restored = decodeActiveRun(raw);
      if (restored.contentHash !== this.pack.hash) {
        return {
          run: this.freshRun(seed), notice: { kind: 'save-discarded', reason: 'content_hash_mismatch' },
          commandSequence: 0,
        };
      }
      return { run: restored, notice: { kind: 'restored' }, commandSequence: this.readCommandSequence(restored) };
    } catch (error) {
      if (error instanceof SaveLoadError) {
        return { run: this.freshRun(seed), notice: { kind: 'save-discarded', reason: error.kind }, commandSequence: 0 };
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

  private freshRun(seed?: Uint32State): ActiveRun {
    return createNewRun({ pack: this.pack, seed: seed ?? randomSeed(), hero: this.hero });
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
    const projection = this.currentProjection();
    const commandId = this.nextCommandId();
    const built = buildIntent({
      intent, projection, commandId, expectedRevision: this.run.revision, pack: this.pack,
    });

    if (built.kind === 'rejected') {
      this.appendSystemLine(built.message);
      this.publish();
      return;
    }

    if (built.kind === 'descend') {
      const transition = descendToNextFloor(this.run, { content: this.pack });
      const events = projectDomainEvents({
        state: transition.state, content: this.pack, heroId: transition.state.hero.actorId, events: transition.events,
      });
      this.applyNewState(transition.state, events);
      return;
    }

    if (built.kind === 'ascend') {
      // Mirrors the descend branch above exactly: a session-level transition (not a reducer
      // command), so it goes through `projectDomainEvents` on the returned events and the same
      // persistence path -- ascending never emits any events (see `ascendToPreviousFloor`), but
      // routing it identically keeps the two floor-change paths symmetric.
      const transition = ascendToPreviousFloor(this.run, { content: this.pack });
      const events = projectDomainEvents({
        state: transition.state, content: this.pack, heroId: transition.state.hero.actorId, events: transition.events,
      });
      this.applyNewState(transition.state, events);
      return;
    }

    if (built.kind === 'house') {
      this.setHouseOpen(true);
      return;
    }

    this.handleResolution(resolveCommand(this.run, built.command, { content: this.pack }));
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
      type: 'attack', targetActorId: decision.targetActorId,
      commandId: this.nextCommandId(), expectedRevision: this.run.revision,
    };
    this.handleResolution(resolveCommand(this.run, command, { content: this.pack }));
  }

  private handleResolution(resolution: CommandResolution): void {
    const { result } = resolution;
    if (result.status === 'decision_required') {
      this.pendingDecision = projectDecision({ state: this.run, content: this.pack, decision: result.decision })
        ?? result.decision;
      this.lastEvents = [];
      this.publish();
      return;
    }
    if (result.status === 'rejected') {
      this.appendSystemLine(
        result.reason === 'stale_revision' ? 'That action is out of date.' : 'That action was already handled.',
      );
      this.publish();
      return;
    }
    this.applyNewState(resolution.state, resolution.events);
  }

  private applyNewState(state: ActiveRun, events: readonly PublicEvent[]): void {
    this.run = state;
    const folded = foldEventsIntoLog(this.log, events, this.nextLogId);
    this.log = folded.log;
    this.nextLogId = folded.nextId;
    this.lastEvents = events;
    this.pendingDecision = null;
    this.persist();
    this.publish();
  }

  private appendSystemLine(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'system' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
    this.lastEvents = [];
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
  finalizeConcludedRun(repository: RunRecordRepository, enrichment: HallRecordEnrichment): RunConclusionProjection {
    const { conclusion } = this.run;
    if (conclusion === null) {
      throw new Error('finalizeConcludedRun requires a concluded run');
    }

    if (conclusion.finalized) {
      const recordId = deriveHallRecordId(this.run.runSeed, this.run.contentHash);
      const record = repository.records().find((candidate) => candidate.recordId === recordId) ?? null;
      const projection = projectRunConclusion({ run: this.run, record, achievements: [] });
      if (projection === null) {
        throw new Error('internal invariant: an already-concluded run projected to null');
      }
      return projection;
    }

    const finalized = finalizeRun({ run: this.run, content: this.pack, lifetime: repository.lifetime() });
    const stored: StoredHallRecord = { ...finalized.record, enrichment };
    repository.appendRecord(stored);
    repository.applyDeltas(finalized.deltas);

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
      run: this.run, record: stored, achievements: finalized.deltas.achievementGrants,
    });
    if (projection === null) {
      throw new Error('internal invariant: a just-finalized run projected to null');
    }
    this.publish();
    return projection;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
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
      notice: this.notice,
      houseOpen: this.houseOpen,
      conclusion: this.run.conclusion === null ? null
        : projectRunConclusion({ run: this.run, record: null, achievements: [] }),
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
