import type { CompiledContentPack } from '@woven-deep/content';
import {
  entryById,
  FINAL_CHAMBER_DEPTH,
  HEART_BOSS_ENCOUNTER_ID,
  tabletFragmentIds,
  type FinalChamberChoiceCommand,
  type GameplayProjection,
  type HallRecordEnrichment,
  type PublicDecision,
  type PublicEvent,
  type RunConclusionProjection,
  type RunRecordRepository,
} from '@woven-deep/engine';
import {
  accumulateSightings,
  loadSightings,
  newLoreReveals,
  saveSightings,
  type Sightings,
} from './codex.js';
import { foldEventsIntoLog, LOG_CAPACITY, type LogLine } from './event-log.js';
import type { PendingFinalChamberChoice, SessionNotice, SessionSnapshot } from './guest-session.js';
import type { PlayerIntent } from './intents.js';
import {
  dismissHint,
  loadOnboarding,
  recordIntent,
  saveOnboarding,
  type OnboardingState,
} from './onboarding.js';
import { actorsOf, heroOf } from './projection-view.js';
import type { RunSession } from './run-session.js';
import { classifyStorageFailure, type SessionStorageLike } from './storage.js';
import { WsClient, type WebSocketFactory } from './ws-client.js';

/**
 * The run-authoritative snapshot the server sends after every applied command --
 * STRUCTURALLY mirrors `apps/server/src/play/play-session.ts`'s `ServerRunSnapshot` exactly.
 * There is no shared protocol package yet (per the plan's File Structure, `ws-protocol.ts` lives
 * only in `apps/server`, and `apps/web` has no dependency on `@woven-deep/server`), so this type
 * is duplicated here rather than imported -- the wire is untyped JSON either way. Keep this in
 * sync with the server's `ServerRunSnapshot` by hand; a genuine drift is exactly what
 * `PROTOCOL_VERSION`/content-hash mismatches (surfaced as an `error` message) are for.
 */
export interface ServerRunSnapshot {
  readonly projection: GameplayProjection;
  readonly lastEvents: readonly PublicEvent[];
  readonly revision: number;
  readonly pendingDecision: PublicDecision | null;
  readonly conclusion: RunConclusionProjection | null;
  readonly houseOpen: boolean;
  readonly heroClassTags: readonly string[];
}

/** Client -> server messages, mirroring `apps/server/src/ws-protocol.ts`'s `ClientMessage`. */
type ClientMessage =
  | {
      readonly type: 'command';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly intent: PlayerIntent;
    }
  | {
      readonly type: 'answer-decision';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly confirmed: boolean;
    }
  | {
      readonly type: 'final-chamber-choice';
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly choice: FinalChamberChoiceCommand['choice'];
    };

/** Server -> client messages, mirroring `apps/server/src/ws-protocol.ts`'s `ServerMessage`. */
export type ServerMessage =
  | {
      readonly type: 'hello';
      readonly protocolVersion: number;
      readonly contentHash: string;
      readonly gameVersion: string;
      readonly saveSchemaVersion: number;
    }
  | { readonly type: 'state'; readonly snapshot: ServerRunSnapshot }
  | { readonly type: 'rejected'; readonly reason: string; readonly snapshot: ServerRunSnapshot }
  | {
      readonly type: 'decision-required';
      readonly decision: PublicDecision | null;
      readonly snapshot: ServerRunSnapshot;
    }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
  | { readonly type: 'superseded' };

/** Width of the zero-padded counter component of a client-minted command id -- mirrors
 * `GuestSession`'s `COMMAND_SEQUENCE_WIDTH` (same rationale: a fixed, easy-to-scan shape). */
const COMMAND_SEQUENCE_WIDTH = 10;

/** A private, ephemeral `SessionStorageLike` fallback for `storage`/`localStorage`, mirroring
 * `guest-session.ts`'s own `inMemoryLocalStorage` -- a `ProfileSession` constructed with neither
 * (every unit test that only cares about the wire protocol) simply never persists the sighting
 * cache or onboarding ledger past this object's lifetime. */
function inMemorySessionStorage(): SessionStorageLike {
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

function parseServerMessage(raw: unknown): ServerMessage | null {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/** Wording for a `rejected` message's `reason` -- mirrors `GuestSession.handleResolution`'s two
 * canned engine-level reasons; anything else is already a human-readable message straight from
 * `dispatchIntent`'s own rejection text (the guest's `outcome.kind === 'rejected'` path uses that
 * raw text directly too), so it is surfaced as-is. */
function rejectionLine(reason: string): string {
  if (reason === 'stale_revision') return 'That action is out of date.';
  if (reason === 'command_id_conflict') return 'That action was already handled.';
  return reason;
}

/** The Weakened Heart boss's monster content id, looked up once per computation rather than
 * hardcoded -- resilient to the id itself changing, since only `HEART_BOSS_ENCOUNTER_ID` (an
 * engine constant) is assumed stable. */
function heartBossMonsterId(pack: CompiledContentPack): string | null {
  const entry = entryById(pack, HEART_BOSS_ENCOUNTER_ID);
  return entry?.kind === 'encounter' && entry.model === 'boss' ? entry.definition.monsterId : null;
}

/**
 * `ProfileSession`'s counterpart to `GuestSession`'s private `computePendingFinalChamberChoice`.
 * The guest computes this straight off its own held `ActiveRun` (`isHeartBossActive`,
 * `heroHoldsAllFragments`) -- fields the wire's redacted `GameplayProjection` never carries, by
 * design (raw run state never crosses the wire; see `ServerRunSnapshot`'s own doc comment in
 * `play-session.ts`). This re-derives the SAME predicate from what IS on the projection: the boss
 * is "active" iff its monster is present among the currently perceived, living actors (the
 * projection already excludes dead/unperceived actors -- see `projectVisibleActors`), and
 * `canBreakCycle` iff every tablet-fragment content id appears (by `contentId`) in the hero's
 * projected backpack.
 */
function computePendingFinalChamberChoice(
  pack: CompiledContentPack,
  snapshot: ServerRunSnapshot,
): PendingFinalChamberChoice | null {
  if (snapshot.conclusion !== null) return null;
  if (snapshot.projection.floor.depth !== FINAL_CHAMBER_DEPTH) return null;

  const bossMonsterId = heartBossMonsterId(pack);
  const bossActive =
    bossMonsterId !== null &&
    actorsOf(snapshot.projection).some((actor) => actor.contentId === bossMonsterId);
  if (bossActive) return null;

  const fragmentIds = tabletFragmentIds(pack);
  const backpackContentIds = new Set(
    heroOf(snapshot.projection).backpack.flatMap((item) =>
      item.contentId === undefined ? [] : [item.contentId],
    ),
  );
  const canBreakCycle =
    fragmentIds.length > 0 && fragmentIds.every((fragmentId) => backpackContentIds.has(fragmentId));
  return { canBreakCycle };
}

export interface ProfileSessionInput {
  readonly pack: CompiledContentPack;
  readonly url: string;
  /** Injectable transport for tests -- see `ws-client.ts`'s `WebSocketFactory`. */
  readonly createSocket?: WebSocketFactory;
  readonly backoffMs?: readonly number[];
  /** Device/tab-local store for the sighting cache (`codex.ts`) -- mirrors `GuestSession`'s
   * `storage`, but here it is the ONLY thing kept in it (the run itself is server-authoritative,
   * and the command-id counter is a plain in-memory counter -- see `nextCommandId`). */
  readonly storage?: SessionStorageLike;
  /** Device-persistent store for the onboarding mastery ledger -- mirrors `GuestSession`'s
   * `localStorage` exactly. */
  readonly localStorage?: SessionStorageLike;
}

/**
 * `RunSession` over a `/ws/play` WebSocket, for signed-in profiles. Holds the last server
 * `ServerRunSnapshot` and assembles the full `SessionSnapshot` the UI reads from it, exactly like
 * `GuestSession` assembles one from its own held `ActiveRun` -- `dispatch`/`answerDecision`/
 * `chooseFinalChamber` never mutate anything locally; they only send the corresponding message and
 * wait for the server's `state`/`rejected`/`decision-required` reply to update the snapshot.
 *
 * Construction is asynchronous (`connect`, not `new`): `RunSession.getSnapshot()` must always
 * return a fully-populated `SessionSnapshot` (same contract `GuestSession` has from the moment
 * it's constructed), and there is no safe placeholder `GameplayProjection` to hand back before the
 * server's first `state` has actually arrived -- so no `ProfileSession` instance exists until then.
 */
export class ProfileSession implements RunSession {
  private readonly pack: CompiledContentPack;
  private readonly storage: SessionStorageLike;
  private readonly localStorage: SessionStorageLike;
  private readonly ws: WsClient;
  private serverSnapshot: ServerRunSnapshot;
  private commandSequence = 0;
  private log: readonly LogLine[] = [];
  private nextLogId = 0;
  private lastEvents: readonly PublicEvent[];
  private sightings: Sightings = { monsterIds: [], itemIds: [], landmarks: [] };
  private onboarding: OnboardingState;
  private notice: SessionNotice | null = null;
  private houseOpen: boolean;
  /** The intent type of the dispatch currently awaiting a server reply, if any -- the ONLY signal
   * `ProfileSession` has for "did a `house` intent just succeed" (the server's own `houseOpen`
   * flips true once and never back to false, so it can't be read as a rising edge on its own; see
   * `setHouseOpen`'s doc comment for the full houseOpen design). Cleared on every reply. */
  private lastDispatchedIntentType: string | null = null;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private sightingsCorruptionNotified = false;
  private onboardingCorruptionNotified = false;

  private constructor(
    input: ProfileSessionInput,
    ws: WsClient,
    initialSnapshot: ServerRunSnapshot,
  ) {
    this.pack = input.pack;
    this.storage = input.storage ?? inMemorySessionStorage();
    this.localStorage = input.localStorage ?? inMemorySessionStorage();
    this.ws = ws;

    const onboardingLoad = loadOnboarding(this.localStorage);
    this.onboarding = onboardingLoad.state;
    if (onboardingLoad.corrupted) this.markOnboardingCorrupted();

    this.serverSnapshot = initialSnapshot;
    this.lastEvents = initialSnapshot.lastEvents;
    // `houseOpen` is CLIENT-side UI state (screen visibility), only ever SEEDED from the server --
    // see `setHouseOpen`'s doc comment for why it can never simply mirror the server field
    // thereafter. On boot, the server's own value is the only signal available, so it wins
    // outright (a reconnect mid-house-visit should reopen the screen, not hide it).
    this.houseOpen = initialSnapshot.houseOpen;
    // Mirrors `GuestSession`'s boot-restore sync: silent (no lore-reveal lines) exactly once, for
    // whatever the run already shows the instant this session comes to exist.
    this.syncSightings(false);
    this.snapshot = this.buildSnapshot();

    ws.onMessage((raw) => this.handleMessage(raw));
  }

  /**
   * Opens the `/ws/play` connection and resolves once the server's initial `hello` + `state` have
   * both arrived -- the earliest point a `ProfileSession` can exist at all (see the class doc
   * comment). Rejects if the server closes the handshake with a version/content-hash `error`
   * before ever reaching that point. Every message the fake/real socket delivers before this
   * settles is consumed here; once settled, the constructed instance's own handler takes over.
   */
  static connect(input: ProfileSessionInput): Promise<ProfileSession> {
    return new Promise<ProfileSession>((resolve, reject) => {
      const ws = new WsClient({
        url: input.url,
        ...(input.createSocket ? { createSocket: input.createSocket } : {}),
        ...(input.backoffMs ? { backoffMs: input.backoffMs } : {}),
      });
      let settled = false;
      const unsubscribe = ws.onMessage((raw) => {
        if (settled) return;
        const message = parseServerMessage(raw);
        if (message === null) return;
        if (message.type === 'hello' || message.type === 'superseded') return;
        if (message.type === 'error') {
          settled = true;
          unsubscribe();
          ws.close();
          reject(new Error(`${message.code}: ${message.message}`));
          return;
        }
        // 'state' | 'decision-required' | 'rejected' all carry a usable initial snapshot.
        settled = true;
        unsubscribe();
        resolve(new ProfileSession(input, ws, message.snapshot));
      });
      ws.connect();
    });
  }

  /** Closes the underlying connection for good (no further reconnects) -- for callers that need
   * to tear this session down deliberately (e.g. signing out), distinct from the terminal states
   * `superseded`/`error` put this session into on their own. */
  close(): void {
    this.ws.close();
  }

  private nextCommandId(): string {
    const id = `command.profile-${String(this.commandSequence).padStart(
      COMMAND_SEQUENCE_WIDTH,
      '0',
    )}`;
    this.commandSequence += 1;
    return id;
  }

  private send(message: ClientMessage): void {
    this.ws.send(message);
  }

  dispatch(intent: PlayerIntent): void {
    this.notice = null;
    this.lastDispatchedIntentType = intent.type;
    this.send({
      type: 'command',
      commandId: this.nextCommandId(),
      expectedRevision: this.serverSnapshot.revision,
      intent,
    });
  }

  answerDecision(confirmed: boolean): void {
    this.notice = null;
    this.lastDispatchedIntentType = null;
    this.send({
      type: 'answer-decision',
      commandId: this.nextCommandId(),
      expectedRevision: this.serverSnapshot.revision,
      confirmed,
    });
  }

  chooseFinalChamber(choice: FinalChamberChoiceCommand['choice']): void {
    this.notice = null;
    this.lastDispatchedIntentType = null;
    this.send({
      type: 'final-chamber-choice',
      commandId: this.nextCommandId(),
      expectedRevision: this.serverSnapshot.revision,
      choice,
    });
  }

  /**
   * Purely local UI-visibility state. Unlike everything else on the snapshot, `houseOpen` is NOT
   * simply read off the server: the server's own `ServerRunSnapshot.houseOpen` flips `true` once
   * (the first successful `house` intent) and never back to `false` -- there is no server intent
   * for "close the house", since closing the house screen is a client-only concern, mirroring
   * `GuestSession.setHouseOpen`'s own posture exactly. So the server field can only ever be used to
   * SEED this flag (on boot/reconnect, `houseOpen: true` means "the screen should already be open"
   * -- see the constructor) or to DETECT a fresh, successful `house` dispatch (`handleMessage`
   * sets it true when the reply to a `lastDispatchedIntentType === 'house'` command arrives) --
   * never to force it back closed. Closing is always this method, called locally by the UI.
   */
  setHouseOpen(open: boolean): void {
    this.houseOpen = open;
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  /**
   * Stubbed for 6B: the Hall of Records stays guest-scoped (a non-goal of this milestone, per the
   * plan), so this never writes a server-side Hall record. It re-exposes the same cheap,
   * `record: null`/`achievements: []` conclusion projection the server already computed (see
   * `ServerPlaySession.snapshot`'s `conclusion` field) -- `finalized` is therefore always `false`
   * here, identical to `GuestSession`'s in-progress `SessionSnapshot.conclusion`. `repository` and
   * `enrichment` are unused (nothing is appended anywhere).
   *
   * TODO(6C): server-authoritative Hall -- finalize the profile's run server-side (a dedicated
   * `/ws/play` message or HTTP route) and return the REAL score/heirloom/achievement projection.
   */
  finalizeConcludedRun(
    _repository: RunRecordRepository,
    _enrichment: HallRecordEnrichment,
  ): RunConclusionProjection {
    if (this.serverSnapshot.conclusion === null) {
      throw new Error('finalizeConcludedRun requires a concluded run');
    }
    return this.serverSnapshot.conclusion;
  }

  recordOnboardingIntent(intentType: string): void {
    this.noteOnboardingIntent(intentType);
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  dismissOnboardingHint(hintId: string): void {
    this.onboarding = dismissHint(this.onboarding, hintId);
    try {
      saveOnboarding(this.localStorage, this.onboarding);
    } catch {
      // Best-effort, same posture as `noteOnboardingIntent` below.
    }
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  private noteOnboardingIntent(intentType: string): void {
    this.onboarding = recordIntent(this.onboarding, intentType);
    try {
      saveOnboarding(this.localStorage, this.onboarding);
    } catch {
      // Best-effort -- the in-memory ledger is already correct for the rest of this session
      // regardless of whether the write itself succeeds (mirrors `GuestSession`).
    }
  }

  private handleMessage(raw: unknown): void {
    const message = parseServerMessage(raw);
    if (message === null) return;
    switch (message.type) {
      case 'hello':
        return;
      case 'state':
        this.applyServerState(message.snapshot, { foldEvents: true });
        return;
      case 'decision-required':
        this.applyServerState(message.snapshot, { foldEvents: false });
        return;
      case 'rejected':
        this.serverSnapshot = message.snapshot;
        this.lastEvents = [];
        this.lastDispatchedIntentType = null;
        this.notice = null;
        this.appendSystemLine(rejectionLine(message.reason));
        this.syncSightings(true);
        this.snapshot = this.buildSnapshot();
        this.notify();
        return;
      case 'error':
        this.notice = { kind: 'protocol-error', code: message.code, message: message.message };
        this.ws.close();
        this.snapshot = this.buildSnapshot();
        this.notify();
        return;
      case 'superseded':
        this.notice = { kind: 'superseded' };
        this.ws.close();
        this.snapshot = this.buildSnapshot();
        this.notify();
        return;
    }
  }

  private applyServerState(
    snapshot: ServerRunSnapshot,
    options: Readonly<{ foldEvents: boolean }>,
  ): void {
    this.serverSnapshot = snapshot;
    if (options.foldEvents) {
      const folded = foldEventsIntoLog(this.log, snapshot.lastEvents, this.nextLogId);
      this.log = folded.log;
      this.nextLogId = folded.nextId;
      this.lastEvents = snapshot.lastEvents;
    } else {
      // Mirrors `GuestSession.handleResolution`'s `decision_required` branch: never folds/replays
      // events for a prompt that hasn't been resolved yet.
      this.lastEvents = [];
    }
    if (this.lastDispatchedIntentType === 'house') this.houseOpen = true;
    this.lastDispatchedIntentType = null;
    this.notice = null;
    this.syncSightings(true);
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  private appendSystemLine(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'system' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
  }

  private appendReveal(text: string): void {
    let entries = [...this.log, { id: this.nextLogId, text, tone: 'info' as const }];
    this.nextLogId += 1;
    if (entries.length > LOG_CAPACITY) entries = entries.slice(entries.length - LOG_CAPACITY);
    this.log = entries;
  }

  /** Mirrors `GuestSession.syncSightings` exactly (same helpers, same notice-downgrade posture) --
   * reused, not forked; see that method's doc comment for the full rationale. */
  private syncSightings(emitReveals: boolean): void {
    const loaded = loadSightings(this.storage);
    if (loaded.corrupted) this.markSightingsCorrupted();
    const next = accumulateSightings(loaded.sightings, this.serverSnapshot.projection);
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

  private markSightingsCorrupted(): void {
    if (this.sightingsCorruptionNotified) return;
    this.sightingsCorruptionNotified = true;
    if (this.notice !== null && this.notice.kind === 'storage') return;
    this.notice = { kind: 'data-reset', source: 'sightings' };
  }

  private markOnboardingCorrupted(): void {
    if (this.onboardingCorruptionNotified) return;
    this.onboardingCorruptionNotified = true;
    if (this.notice !== null && this.notice.kind === 'storage') return;
    this.notice = { kind: 'data-reset', source: 'onboarding' };
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
      projection: this.serverSnapshot.projection,
      log: this.log,
      lastEvents: this.lastEvents,
      pendingDecision: this.serverSnapshot.pendingDecision,
      pendingFinalChamberChoice: computePendingFinalChamberChoice(this.pack, this.serverSnapshot),
      notice: this.notice,
      houseOpen: this.houseOpen,
      conclusion: this.serverSnapshot.conclusion,
      sightings: this.sightings,
      heroClassTags: this.serverSnapshot.heroClassTags,
      onboarding: this.onboarding,
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
