import type { CompiledContentPack } from '@woven-deep/content';
import {
  createNewRun,
  decodeActiveRun,
  encodeActiveRun,
  isHeartBossActive,
  projectGameplayState,
  projectRunConclusion,
  DEFAULT_GUEST_HERO,
  type ActiveRun,
  type GameCommand,
  type NewRunHero,
  type PublicDecision,
  type PublicEvent,
  type Uint32State,
} from '@woven-deep/engine';
import {
  dispatchCommand,
  dispatchIntent,
  type PlayerIntent,
  type ServerRunSnapshot,
} from '@woven-deep/session-core';
import type { ActiveRunRepository } from '../db/active-run-repository.js';

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
const CONSEQUENTIAL_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'attack.missed',
  'attack.hit',
  'actor.damaged',
  'actor.died',
  'actor.healed',
  'loot.dropped',
  'item.picked-up',
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
  private readonly profileId: string;
  private readonly clock: Clock;
  private run!: ActiveRun;
  private houseOpen = false;
  private lastEvents: readonly PublicEvent[] = [];
  private pendingDecision: PublicDecision | null = null;
  private movesSinceCheckpoint = 0;
  private dirty = false;

  constructor(
    input: Readonly<{
      pack: CompiledContentPack;
      repo: ActiveRunRepository;
      profileId: string;
      clock?: Clock;
    }>,
  ) {
    this.pack = input.pack;
    this.repo = input.repo;
    this.profileId = input.profileId;
    this.clock = input.clock ?? (() => new Date().toISOString());
  }

  /**
   * Loads the profile's run — rehydrating a stored one (guarding its content hash) or creating a
   * fresh one. The SERVER supplies the seed (anti-cheat: a client-provided seed is never trusted);
   * `hero` is the profile's chosen hero (defaults to the guest hero until the start-run flow lands).
   * A freshly-created run is persisted immediately so a reconnect finds it.
   */
  open(input: Readonly<{ hero?: NewRunHero; seed: Uint32State }>): ServerRunSnapshot {
    const stored = this.repo.get(this.profileId);
    if (stored !== undefined) {
      if (stored.contentHash !== this.pack.hash) {
        throw new ContentHashMismatchError(this.pack.hash, stored.contentHash);
      }
      this.run = decodeActiveRun(stored.runBlob);
    } else {
      this.run = createNewRun({
        pack: this.pack,
        seed: input.seed,
        hero: input.hero ?? DEFAULT_GUEST_HERO,
      });
      this.persist();
    }
    return this.snapshot();
  }

  /** Applies a dispatched player intent, mutating + persisting the authoritative run. */
  applyIntent(
    input: Readonly<{ commandId: string; expectedRevision: number; intent: PlayerIntent }>,
  ): ApplyOutcome {
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
      // A floor change is always consequential — persist immediately.
      this.run = outcome.run;
      this.lastEvents = outcome.events;
      this.pendingDecision = null;
      this.persist();
      return { kind: 'state', snapshot: this.snapshot() };
    }
    // outcome.kind === 'command'
    return this.applyResolution(outcome.resolution, input.intent.type === 'move');
  }

  /** Applies a raw engine command (the decision / final-chamber paths that bypass `buildIntent`). */
  applyCommand(command: GameCommand): ApplyOutcome {
    return this.applyResolution(dispatchCommand(this.run, command, { pack: this.pack }), false);
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
    return { kind: 'state', snapshot: this.snapshot() };
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
          ? projectRunConclusion({ run: this.run, record: null, achievements: [] })
          : null,
      houseOpen: this.houseOpen,
      heroClassTags: this.run.hero.classTags,
      bossActive: isHeartBossActive(this.run),
    };
  }
}
