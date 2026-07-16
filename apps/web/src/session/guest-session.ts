import type { CompiledContentPack } from '@woven-deep/content';
import {
  createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, descendToNextFloor, encodeActiveRun,
  projectDecision, projectDomainEvents, projectGameplayState, RECENT_COMMAND_LIMIT, resolveCommand,
  SaveLoadError,
  type ActiveRun, type CommandResolution, type GameCommand, type GameplayProjection, type NewRunHero,
  type PublicDecision, type PublicEvent, type Uint32State,
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
  readonly backpackOpen: boolean;
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
  private backpackOpen = false;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    input: Readonly<{
      pack: CompiledContentPack; storage: SessionStorageLike; seed?: Uint32State; hero?: NewRunHero;
    }>,
  ) {
    this.pack = input.pack;
    this.storage = input.storage;
    this.hero = input.hero ?? DEFAULT_GUEST_HERO;
    const booted = this.boot(input.seed);
    this.run = booted.run;
    this.notice = booted.notice;
    this.commandSequence = booted.commandSequence;
    this.snapshot = this.buildSnapshot();
  }

  private boot(seed?: Uint32State): Readonly<{ run: ActiveRun; notice: SessionNotice; commandSequence: number }> {
    const raw = this.storage.get(SAVE_KEY);
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

  setBackpackOpen(open: boolean): void {
    this.backpackOpen = open;
    this.publish();
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
      backpackOpen: this.backpackOpen,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
