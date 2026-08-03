import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import {
  heroFromChoices,
  newRunRecords,
  type HeroChoices,
  type RunConclusionProjection,
  type RunMode,
  type RunRecordRepository,
  type Uint32State,
} from '@woven-deep/engine';
import { deleteAccount, logout, playWsUrl } from './api.js';
import { GUEST_ACCOUNT, type AccountState } from './session/account.js';
import { loadSightings } from './session/codex.js';
import type { LogLine } from './session/event-log.js';
import { GuestSession, type SessionNotice } from './session/guest-session.js';
import { ProfileSession, type PendingProfileStart } from './session/profile-session.js';
import type { RunSession } from './session/run-session.js';
import { clearGuestSession } from './session/clear-guest-session.js';
import { randomSeed } from './session/seed.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './session/settings.js';
import { useRunSession } from './session/store.js';
import type { WebSocketFactory } from './session/ws-client.js';
import {
  browserLocalStorage,
  browserSessionStorage,
  classifyStorageFailure,
  PORTRAIT_KEY,
  type SessionStorageLike,
} from './session/storage.js';
import {
  AppBanners,
  isStorageNotice,
  noticeMessage,
  storageWarningMessage,
} from './ui/AppBanners.js';
import { RootStyling } from './ui/RootStyling.js';
import { useAccount } from './ui/hooks/useAccount.js';
import { useContentPack } from './ui/hooks/useContentPack.js';
import { useHallRepository } from './ui/hooks/useHallRepository.js';
import { useScreenRouter } from './ui/hooks/useScreenRouter.js';
import { useSettingsRoaming } from './ui/hooks/useSettingsRoaming.js';
import { DeathOverlay } from './ui/overlays/DeathOverlay.js';
import { canOpenOverlay, OVERLAY_REGISTRY, type OverlayId } from './ui/overlays/registry.js';
import { OverlayHost } from './ui/overlays/OverlayHost.js';
import { concludedByDeath } from './ui/playfield/scene-state.js';
import { ChargenScreen } from './ui/screens/ChargenScreen.js';
import { ConclusionScreen } from './ui/screens/ConclusionScreen.js';
import { HallScreen } from './ui/screens/HallScreen.js';
import { SignInScreen } from './ui/screens/SignInScreen.js';
import { TitleScreen } from './ui/screens/TitleScreen.js';
import { PlayScreen } from './ui/PlayScreen.js';
import { UiProviders } from './ui/providers.js';
import './styles.css';

export interface AppProps {
  readonly fetcher?: typeof fetch;
  /** Test-only escape hatch: lets tests swap in an in-memory `SessionStorageLike` instead of the
   * real `window.sessionStorage`, exactly like `PlayScreen`'s `tier` prop. */
  readonly storage?: SessionStorageLike;
  /** Same escape hatch as `storage`, but for the settings module's `localStorage`-backed store
   * (`woven-deep.settings.v1`) -- a distinct browser storage area from the run/session state
   * above, so it gets its own override rather than reusing `storage`. */
  readonly localStorage?: SessionStorageLike;
  /** Test-only escape hatch mirroring `localStorage` above: when provided, skips the network
   * `loadAccount` fetch entirely and seeds `account` state with this value directly -- lets tests
   * assert on a signed-in title/App without wiring a session-shaped fetcher response. */
  readonly accountOverride?: AccountState;
  /** Test-only escape hatch: injects the transport a signed-in profile's `ProfileSession` opens
   * `/ws/play` over, exactly like `ProfileSessionInput.createSocket` -- lets tests supply a fully
   * in-memory fake `WebSocketLike` instead of the real browser `WebSocket`. Never set in
   * production (the default `WsClient` behaviour -- the real global `WebSocket` -- applies). */
  readonly createSocket?: WebSocketFactory;
}

export type { ScreenState } from './ui/hooks/useScreenRouter.js';

/** Re-exported from `session/storage.js`, which owns this constant so the framework-free
 * `clear-guest-session.ts` module can list it as a wipe target without importing this (React)
 * entry point -- also exported from `App` since one test imports it from here. */
export { PORTRAIT_KEY };

/**
 * Test-only seed override: `?seed=11.22.33.44` (four dot-separated `Uint32` words) pins the
 * fresh run's RNG instead of the ambient `crypto.getRandomValues` seed `GuestSession` otherwise
 * generates. Never a real feature — no UI links to it, and it's parsed straight out of
 * `location.search`, so it only ever matters to a test (or a developer poking at the URL bar).
 * When chargen is reached, the SAME seed also drives the wizard's attribute rolls (see
 * `chargenSeed` below), so this one query parameter pins both.
 */
function parseSeedFromQuery(search: string): Uint32State | undefined {
  const raw = new URLSearchParams(search).get('seed');
  if (!raw) return undefined;
  const words = raw.split('.').map(Number);
  if (words.length !== 4 || words.some((word) => !Number.isFinite(word))) return undefined;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

/**
 * Test-only escape hatch (documented, not a real feature): `?quickstart=1` skips the title and
 * chargen screens entirely and boots straight into play with `DEFAULT_GUEST_HERO`. It exists so
 * the e2e specs (recorded against a fixed keypress walk over the default hero's stats) keep
 * passing unmodified apart from their boot URL.
 */
function isQuickstart(search: string): boolean {
  return new URLSearchParams(search).get('quickstart') === '1';
}

/** How much of the adventure log the conclusion screen's "last moments" recap keeps. */
const CONCLUSION_LOG_TAIL = 8;

interface GameRootProps {
  readonly session: RunSession;
  readonly pack: CompiledContentPack;
  readonly repository: RunRecordRepository;
  readonly portraitGlyph: string | undefined;
  readonly onConcluded: (projection: RunConclusionProjection, logTail: readonly LogLine[]) => void;
  /** Called if `finalizeConcludedRun` itself throws (e.g. the Hall write hit a storage quota) --
   * surfaces a persistent, non-dismissible warning while the conclusion screen still shows the
   * in-memory (unfinalized) projection instead of leaving the player on a white screen. */
  readonly onFinalizeError: (message: string) => void;
  /** Forwarded straight through to `PlayScreen` -- `App` owns this state (see the guest-interface
   * overlay infrastructure), `GameRoot` just plumbs it past the `useRunSession` split. */
  readonly overlay: OverlayId | null;
  readonly onOpenOverlay: (overlay: OverlayId) => void;
  readonly onCloseOverlay: () => void;
  /** `App` owns the settings-clear handler; `GameRoot` forwards it to `PlayScreen` so the settings
   * overlay body's "clear guest session" action works identically whether opened from play or from
   * the title screen. Settings/keymap themselves reach `PlayScreen` (and every overlay) via
   * `useSettingsCtx()`, sourced from the single `UiProviders` `App` renders around the whole
   * authenticated tree. */
  readonly onClearGuestSession: () => void;
  /** Signs the current profile out -- forwarded straight through to `PlayScreen`. `undefined` for
   * a guest's `GuestSession` (there is no account to sign out of); only ever set for a signed-in
   * `ProfileSession` run. See `PlayScreenProps.onSignOut`'s doc comment. */
  readonly onSignOut?: (() => void) | undefined;
  /** Permanently deletes the current profile -- forwarded straight through to `PlayScreen`, exactly
   * like `onSignOut` (undefined for a guest's `GuestSession`, only ever set for a signed-in
   * `ProfileSession` run). */
  readonly onDeleteAccount?: (() => void) | undefined;
  /** Forwarded straight through to `PlayScreen`'s settings overlay body -- the current account
   * (always populated; `GUEST_ACCOUNT` for a guest run), driving the signed-in-only "Lifetime &
   * achievements" section. */
  readonly account: AccountState;
  /** Whether the contextual onboarding hint strip may show at all: `settings.onboarding === 'on'`
   * AND not a quickstart boot -- quickstart always forces it off regardless of the stored setting,
   * protecting every pinned e2e walk (see `isQuickstart`'s doc comment). */
  readonly onboardingEnabled: boolean;
}

/** Everything that needs a live `RunSession` snapshot: the notice banners and the play screen
 * itself. Split out from `App` so `useRunSession` (a hook) is only ever called once a session
 * actually exists — `App` renders this conditionally, not the hook. Works identically whether
 * `session` is a local `GuestSession` or a WebSocket-backed `ProfileSession`.
 *
 * Storage notices (unavailable/full) get their own persistent, non-dismissible `role="alert"`
 * warning per the design spec — play continues unsaved, but the player must keep seeing that.
 * Every other notice (fresh/restored/save-discarded) stays a dismissible `role="status"` banner.
 *
 * Once the snapshot's `conclusion` first becomes non-null (the hero died, or a save restored an
 * already-concluded run), this finalizes the run into the Hall exactly once — `finalizeRun`'s own
 * `finalized` flag makes a repeat call safe, but `finalizedRef` also stops this component from
 * calling it again on every subsequent render before `onConcluded` swaps the screen away.
 *
 * The single exception is a Wanderer DEATH (`wandererDeath` below): that conclusion may still be
 * undone by the player, so nothing is finalized until they accept it. Every other conclusion,
 * a Wanderer victory included, finalizes on sight exactly as described above. */
function GameRoot({
  session,
  pack,
  repository,
  portraitGlyph,
  onConcluded,
  onFinalizeError,
  overlay,
  onOpenOverlay,
  onCloseOverlay,
  onClearGuestSession,
  onSignOut,
  onDeleteAccount,
  account,
  onboardingEnabled,
}: GameRootProps): JSX.Element {
  const snapshot = useRunSession(session);
  const { notice, conclusion } = snapshot;
  /** The notice the player dismissed, held by identity so a NEW notice is shown again without an
   * effect having to reset a boolean: the banner is dismissed only while this IS the live notice. */
  const [dismissedNotice, setDismissedNotice] = useState<SessionNotice | null>(null);
  const dismissed = notice !== null && dismissedNotice === notice;
  const finalizedRef = useRef(false);
  /** Set the instant a CLASSIC death conclusion finalizes, holding the exact `onConcluded`
   * arguments until the player acknowledges the `DeathOverlay` -- the run is already finalized (the
   * Hall write above has already happened) the moment this is set; only the navigation is deferred.
   * A non-death conclusion never touches this state -- `onConcluded` still fires immediately for
   * those, unchanged. A Wanderer death never touches it either: it has not been finalized yet, so
   * there is no projection to hold, and its overlay is driven by `wandererDeath` instead. */
  const [pendingDeathConclusion, setPendingDeathConclusion] = useState<{
    projection: RunConclusionProjection;
    logTail: readonly LogLine[];
  } | null>(null);
  /** A Wanderer run concluded by hero death: the one conclusion this component does not finalize
   * on sight, because the player still gets to decide whether it stands (see the effect below). */
  const wandererDeath = snapshot.projection.mode === 'wanderer' && concludedByDeath(snapshot);
  /** Bumped on every Rise again click, purely to REMOUNT the overlay: its one-shot guard is
   * per-mount, and a profile's rise is answered asynchronously by the server -- when the server
   * finds no usable checkpoint it pushes back the same concluded snapshot, leaving this overlay on
   * screen with a spent guard and a dead Accept death button. A guest's refusal is synchronous and
   * never gets this far (it falls through to Accept death inside the same click). */
  const [riseAttempts, setRiseAttempts] = useState(0);

  // `set-state-in-effect` is disabled for this effect alone: finalizing is an imperative, exactly-
  // once side effect (it writes the Hall record through the repository), and the death branch has to
  // publish that call's own return value -- the projection and log tail the `DeathOverlay` shows --
  // back into React. `finalizedRef` makes it a genuine one-shot, so there is no cascade to avoid,
  // and there is no render-time derivation available for a value that only exists once the
  // side-effecting call has run.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (conclusion === null || finalizedRef.current) return;
    // A Wanderer death is the player's decision, not the app's: nothing is finalized, nothing is
    // cleared, and nothing navigates until they pick Rise again or Accept death below. Every other
    // conclusion (including a Wanderer victory) finalizes immediately, exactly as before.
    if (wandererDeath) return;
    finalizedRef.current = true;
    const isDeath = concludedByDeath(snapshot);
    try {
      const projection = session.finalizeConcludedRun(repository, {
        achievedAt: `Run #${repository.records().length + 1}`,
        portraitGlyph: portraitGlyph ?? '@',
      });
      const logTail = session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL);
      if (isDeath) setPendingDeathConclusion({ projection, logTail });
      else onConcluded(projection, logTail);
    } catch (thrown) {
      // The Hall write itself failed (quota/unavailable) -- this is not a bug in the run, so
      // don't let it crash out of the effect into a white screen. Surface the same persistent
      // storage-warning wording the rest of the app uses, and still move to the conclusion
      // screen with whatever the session can already project in-memory (score/heirloom null,
      // since the record never made it into the Hall).
      const failure = classifyStorageFailure(thrown);
      onFinalizeError(
        failure === 'full'
          ? 'Your browser storage is full, so this run could not be saved to the Hall of Records.'
          : 'The Hall of Records is unavailable, so this run could not be saved.',
      );
      const fallback = session.getSnapshot().conclusion;
      if (fallback) {
        const logTail = session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL);
        if (isDeath) setPendingDeathConclusion({ projection: fallback, logTail });
        else onConcluded(fallback, logTail);
      }
    }
  }, [
    conclusion,
    wandererDeath,
    onConcluded,
    onFinalizeError,
    portraitGlyph,
    repository,
    session,
    snapshot,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Accept-death in Wanderer: the death stands, so this is the ordinary finalize-and-navigate the
   * effect above would have done immediately in Classic, just deferred until the player said so.
   * A finalize failure degrades exactly as it does there (a persistent warning plus the in-memory
   * projection) rather than stranding the player under the overlay.
   */
  function acceptWandererDeath(): void {
    finalizedRef.current = true;
    try {
      const projection = session.finalizeConcludedRun(repository, {
        achievedAt: `Run #${repository.records().length + 1}`,
        portraitGlyph: portraitGlyph ?? '@',
      });
      onConcluded(projection, session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL));
    } catch (thrown) {
      const failure = classifyStorageFailure(thrown);
      onFinalizeError(
        failure === 'full'
          ? 'Your browser storage is full, so this run could not be saved to the Hall of Records.'
          : 'The Hall of Records is unavailable, so this run could not be saved.',
      );
      const fallback = session.getSnapshot().conclusion;
      if (fallback) onConcluded(fallback, session.getSnapshot().log.slice(-CONCLUSION_LOG_TAIL));
    }
  }

  const dismissibleNotice = notice && !isStorageNotice(notice) ? notice : null;
  const storageNotice = notice && isStorageNotice(notice) ? notice : null;

  const showDismissibleNotice = dismissibleNotice !== null && !dismissed;

  return (
    <div className="app-root relative">
      {/* Notices float over the top of the full-bleed HUD rather than stacking in flow above it, so
       * the play layout keeps the full 100vh and the TopBar stays anchored to the viewport top. The
       * wrapper ignores pointer events; each banner re-enables them so its Dismiss button stays
       * clickable. */}
      {(storageNotice || showDismissibleNotice) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col">
          {storageNotice && (
            <div
              role="alert"
              aria-label="Storage warning"
              className="storage-warning-banner pointer-events-auto bg-deep/85 font-mono text-sm backdrop-blur-sm"
              data-kind="storage"
            >
              <p>{storageWarningMessage(storageNotice)}</p>
            </div>
          )}
          {showDismissibleNotice && (
            <div
              role="status"
              aria-label="Session notice"
              className="session-banner pointer-events-auto flex items-center justify-between gap-4 border-b border-line bg-deep/85 px-4 py-2 font-mono text-sm text-fg backdrop-blur-sm"
              data-kind={dismissibleNotice.kind}
            >
              <p>{noticeMessage(dismissibleNotice)}</p>
              <button
                type="button"
                onClick={() => setDismissedNotice(dismissibleNotice)}
                className="shrink-0 text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      <PlayScreen
        session={session}
        pack={pack}
        overlay={overlay}
        onOpenOverlay={onOpenOverlay}
        onCloseOverlay={onCloseOverlay}
        onClearGuestSession={onClearGuestSession}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
        account={account}
        records={repository.records()}
        currentHeart={repository.currentHeart()}
        onboardingEnabled={onboardingEnabled}
      />
      {(pendingDeathConclusion || wandererDeath) && (
        <DeathOverlay
          key={riseAttempts}
          {...(wandererDeath
            ? {
                onRise: () => {
                  // A successful rise leaves the next snapshot unconcluded, so the effect's own
                  // guard re-arms naturally and this overlay unmounts; `finalizedRef` was never
                  // set on that path. A guest that cannot rise says so immediately, and the death
                  // stands here; a profile answers over the socket, which is what `riseAttempts`
                  // above keeps the overlay usable for.
                  setRiseAttempts((attempts) => attempts + 1);
                  if (session.riseAgain()) return;
                  acceptWandererDeath();
                },
                onAcknowledge: acceptWandererDeath,
              }
            : {
                onAcknowledge: () =>
                  onConcluded(pendingDeathConclusion!.projection, pendingDeathConclusion!.logTail),
              })}
        />
      )}
    </div>
  );
}

/**
 * Boots the guest client: fetches the compiled content pack, then walks the screen state machine
 * (title -> chargen -> play, plus a stub hall placeholder and a `?quickstart=1` shortcut that
 * skips straight to play). The `GuestSession` is created LAZILY —
 * quickstart and Continue construct it as soon as they're selected/available, while entering
 * chargen defers construction until the wizard is confirmed (its hero choices need to reach
 * `createNewRun`). Distinct screens for the two ways boot can go wrong: the pack fetch failing
 * (retry button) vs. anything the session itself surfaces once it's running (a dismissible
 * banner in `GameRoot`, covering storage being unavailable/full and save-discard notices alike).
 */
export function App({
  fetcher = fetch,
  storage: storageOverride,
  localStorage: localStorageOverride,
  accountOverride,
  createSocket,
}: AppProps): JSX.Element {
  const { pack, error, retry } = useContentPack(fetcher);

  const localStorageInstance = useMemo(
    () => localStorageOverride ?? browserLocalStorage(),
    [localStorageOverride],
  );
  // Settings are read once at boot; from here on `setSettings` is the single source of truth --
  // every mutation (font scale, motion, a rebind, a reset) flows through `handleSettingsChange`
  // below, which persists via `saveSettings` before applying the change in-memory.
  const [settingsLoad] = useState(() => loadSettings(localStorageInstance));
  const [settings, setSettings] = useState(() => settingsLoad.settings);
  const [settingsWriteWarning, setSettingsWriteWarning] = useState<string>();
  // When `loadSettings` detects a corrupt blob at boot it resets to `DEFAULT_SETTINGS` and flags
  // it; this state surfaces the standard dismissible notice for that reset. Read once, at the same
  // boot moment as `settingsLoad` above; dismissing it never re-shows it (a corrupt blob is a
  // one-time boot fact, not an ongoing condition).
  const [settingsCorruptedDismissed, setSettingsCorruptedDismissed] = useState(false);

  // The signed-in identity, if any -- `GUEST_ACCOUNT` until (and unless) a session cookie proves
  // otherwise. `accountOverride` is a test-only seam (mirroring `localStorageOverride`): when
  // given, it seeds state directly and the network fetch never fires, exactly like
  // `localStorage`'s override skips `browserLocalStorage()`. Otherwise every boot re-fetches the
  // session fresh (effect-ordered after the pack-load effect, so a shared/naive test fetcher
  // double serves the pack request first): this is also what picks up a freshly-established
  // session after a magic-link redirect lands back on `/` with `?auth=ok` in the URL, since that
  // redirect is itself a fresh page load and thus a fresh boot.
  const { account, setAccount } = useAccount(fetcher, accountOverride);

  // Settings roaming: server-adopt/seed on sign-in, plus the debounced push
  // (`pushSettings`) `handleSettingsChange` below calls on every change while signed in.
  const { pushSettings } = useSettingsRoaming(
    account,
    fetcher,
    settings,
    localStorageInstance,
    setSettings,
  );

  /**
   * The settings overlay's `onChange`. Persists first (`saveSettings` re-validates
   * `next.bindings` for conflicts as the write-time backstop the settings overlay's own
   * `bindingConflict` pre-check already guards against in practice), then applies the change
   * in-memory regardless of whether the write itself succeeded -- mirroring the "a failed
   * settings write warns and continues" rule: a storage failure (quota/unavailable) still lets
   * the guest keep playing with the new setting for this visit, surfaced as a persistent warning
   * rather than silently discarded or crashing. The one write `saveSettings` refuses outright (a
   * binding conflict with no `reason`) should be unreachable here -- the overlay's own
   * `bindingConflict` check refuses to even call `onChange` with a colliding chord -- so that
   * branch is treated as a no-op rather than a user-facing failure.
   */
  function handleSettingsChange(next: Settings): void {
    const result = saveSettings(localStorageInstance, next);
    if (!result.ok && result.reason === undefined) return;
    setSettings(next);
    setSettingsWriteWarning(
      result.ok
        ? undefined
        : result.reason === 'full'
          ? 'Your browser storage is full, so settings changes will not be saved.'
          : 'Saving settings is unavailable in this browser -- changes apply for this visit only.',
    );

    // Signed-in players roam settings across devices. The localStorage write above is
    // unconditional (guest and signed-in alike); `pushSettings` is the signed-in-only extra --
    // it no-ops for a guest, or a player who has since signed out.
    pushSettings(next);
  }

  // Bumped by `handleClearGuestSession` so the Hall-of-Records `repository` (keyed on this
  // alongside `storage`) is forced to reconstruct AFTER the wipe -- otherwise it would keep serving
  // the in-memory records it already loaded at its last construction, even though the underlying
  // storage key is now gone.
  const [storageEpoch, setStorageEpoch] = useState(0);

  const [overlay, setOverlay] = useState<OverlayId | null>(null);

  const storage = useMemo(() => storageOverride ?? browserSessionStorage(), [storageOverride]);

  const [repository, hallNotice] = useHallRepository(storage, storageEpoch);
  // The guest's cross-run history, handed to every `GuestSession` as a THUNK rather than a value:
  // a run started later in this page life (chargen after a death, a fresh quickstart) must read
  // the Hall as it stands at that moment, including the record its own previous run just
  // finalized. Curried over the pack because every construction site already has one in hand,
  // while this hook runs before the pack has loaded; `repository` is stable per storage epoch, so
  // `recordsFor` is too.
  const recordsFor = useMemo(
    () => (loaded: CompiledContentPack) => () => newRunRecords(repository, loaded),
    [repository],
  );

  // Read once at boot -- `window.location.search` never changes for the life of this component
  // (the app never navigates), so this is the one place `isQuickstart` needs calling repeatedly.
  const [quickstart] = useState(() => isQuickstart(window.location.search));
  const router = useScreenRouter(quickstart);
  const { screen } = router;
  const [session, setSession] = useState<RunSession>();
  // The live session, mirrored for `dropToGuest` below: the sign-out/delete teardown runs from a
  // promise callback, long after the click that started it, so it must not decide against the
  // session its closure happened to capture. Written after commit, never while rendering.
  const sessionRef = useRef<RunSession | undefined>(undefined);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [chargenSeed, setChargenSeed] = useState<Uint32State>();
  /** The held `/ws/play` connection of a signed-in profile with no run yet -- set when connect
   * resolves `{kind: 'chargen'}`, consumed by the chargen screen's profile confirm path, and torn
   * down on sign-out with the rest of the profile state. */
  const [pendingProfileStart, setPendingProfileStart] = useState<PendingProfileStart>();
  const [portraitGlyph, setPortraitGlyph] = useState<string>();
  const [conclusion, setConclusion] = useState<{
    projection: RunConclusionProjection;
    logTail: readonly LogLine[];
  }>();
  const [finalizeWarning, setFinalizeWarning] = useState<string>();
  const [chargenError, setChargenError] = useState<string>();
  // A signed-in profile's `/ws/play` connect failure (content/version mismatch, network error
  // before the handshake ever completes) -- distinct from the terminal `superseded`/`protocol-error`
  // notices `ProfileSession` itself surfaces once connected (those flow through `snapshot.notice` ->
  // `AppBanners` like any other session notice); there is no session object yet to carry a notice
  // when `ProfileSession.connect` itself rejects, so this is `App`'s own boot-error state for that.
  const [profileError, setProfileError] = useState<string>();

  const closeOverlay = (): void => setOverlay(null);
  /** Play-scope overlays (inventory / character sheet / map-journal) require an actual live run —
   * `screen.screen === 'play'` with a constructed `session` -- global overlays (codex / settings /
   * help) are always allowed, from title or play alike (see `canOpenOverlay`). */
  function openOverlay(id: OverlayId): void {
    const isPlayActive = screen.screen === 'play' && session !== undefined;
    if (!canOpenOverlay(OVERLAY_REGISTRY[id], isPlayActive)) return;
    setOverlay(id);
  }

  /**
   * The settings overlay's "clear guest session": wipes every guest-session storage key
   * (`clearGuestSession` -- run save, command counter, Hall of Records, portrait glyph, settings),
   * resets every piece of in-memory state those keys backed (so a stale run/portrait/settings
   * value can't survive the wipe only to be re-persisted on the next natural save), closes
   * whatever overlay is open, bumps `storageEpoch` so the Hall repository reloads as empty, and
   * lands on the title screen.
   */
  function handleClearGuestSession(): void {
    clearGuestSession(storage, localStorageInstance);
    setSettings(DEFAULT_SETTINGS);
    setSettingsWriteWarning(undefined);
    setSession(undefined);
    setConclusion(undefined);
    setPortraitGlyph(undefined);
    setChargenError(undefined);
    setFinalizeWarning(undefined);
    closeOverlay();
    setStorageEpoch((epoch) => epoch + 1);
    router.toTitle();
  }

  // Quickstart's session is constructed once the pack is ready (it can't be constructed at the
  // `useState` initializer above — the pack isn't loaded yet at first render). Gated on
  // `screen.screen === 'play'` (quickstart's initial screen): without it, a surviving
  // `?quickstart=1` query in the URL re-fires this effect after `handleClearGuestSession` sets
  // `session` back to undefined and the screen to 'title', silently constructing a hidden
  // `GuestSession` that re-persists storage (its constructor syncs sightings on its own) and breaks
  // the wipe contract on quickstart boots.
  // `set-state-in-effect` is disabled for this effect alone: constructing a `GuestSession` is a
  // side effect (it reads and re-persists browser storage), so it cannot move into render, and the
  // trigger is the content pack finishing its fetch rather than any user action -- there is no event
  // handler to host it. The guards above make it a one-shot, so no cascade follows.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pack || session) return;
    if (screen.screen !== 'play') return;
    if (!isQuickstart(window.location.search)) return;
    const seed = parseSeedFromQuery(window.location.search);
    setSession(
      seed
        ? new GuestSession({
            pack,
            storage,
            seed,
            localStorage: localStorageInstance,
            records: recordsFor(pack),
          })
        : new GuestSession({
            pack,
            storage,
            localStorage: localStorageInstance,
            records: recordsFor(pack),
          }),
    );
  }, [pack, storage, session, screen, localStorageInstance, recordsFor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Drops the profile back to guest: flips `account` to `GUEST_ACCOUNT` and, if a live
   * `ProfileSession` is what the player was playing, tears it down and returns to the title screen
   * (clearing `session` closes the underlying WS through the effect further below). The teardown
   * lives here, in the two actions that can cause it, rather than in an effect watching
   * `account.status` -- signing out and deleting the account are the only ways the status ever
   * leaves `'signed-in'`, and doing it in the action keeps the whole transition one atomic update.
   * A guest never has a `ProfileSession`, so the guest boot/play path is untouched.
   *
   * The `ProfileSession` check reads `sessionRef`, not the `session` this closure captured: both
   * callers run this from a promise callback, and a `ProfileSession.connect` that resolves between
   * the click and the server's reply would otherwise be missed -- the WS would survive the sign-out
   * with the player left on a play screen no longer backed by an account. */
  function dropToGuest(): void {
    setAccount(GUEST_ACCOUNT);
    // A held pre-run connection (profile chargen in progress) is torn down alongside everything
    // else profile-shaped; without a live ProfileSession the instanceof branch below never runs.
    if (pendingProfileStart !== undefined) {
      pendingProfileStart.close();
      setPendingProfileStart(undefined);
      setProfileError(undefined);
      closeOverlay();
      router.toTitle();
    }
    if (!(sessionRef.current instanceof ProfileSession)) return;
    setSession(undefined);
    setProfileError(undefined);
    closeOverlay();
    router.toTitle();
  }

  /** Signs the current profile out: logs out server-side, then drops back to guest (see
   * `dropToGuest`). Reused by both the title screen's "Sign out" menu entry and the in-play
   * settings overlay's "Sign out" action (the only two places `App` ever offers signing out). */
  function handleSignOut(): void {
    void logout(account.csrfToken ?? '', fetcher).then(() => dropToGuest());
  }

  /** Permanently deletes the signed-in profile: calls `DELETE /api/profile` server-side, then
   * reuses the exact same sign-out teardown (`dropToGuest`), since after a delete there is nothing
   * left to stay connected to either. Only ever wired up for a signed-in `ProfileSession` run (see
   * the `onDeleteAccount` prop below). If the server delete fails (network/5xx), `deleteAccount`
   * rejects and the tear-down never runs -- the account stays signed in and the failure is
   * surfaced through `profileError`, the same signed-in-action-failed banner the boot-time
   * `ProfileSession.connect` rejection above uses. */
  function handleDeleteAccount(): void {
    void deleteAccount(account.csrfToken ?? '', fetcher)
      .then(() => dropToGuest())
      .catch((thrown) => {
        setProfileError(thrown instanceof Error ? thrown.message : 'Failed to delete the account.');
      });
  }

  /**
   * Signed-in profile connect: opens a `ProfileSession` over `/ws/play` once the account is known
   * signed-in and the content pack is ready. Guarded on `session`/`profileError` both being unset
   * so this only ever attempts once per sign-in — a successful connect flips `session` (and this
   * effect never re-fires while it's live); a rejected connect (content/version mismatch, or the
   * handshake never completing) sets `profileError` instead, surfaced by the title screen's own
   * boot-error branch below, with a Retry that clears it. Mirrors the quickstart effect just above:
   * gated so a torn-down session (sign-out, handled by the next effect) is never resurrected --
   * signing out flips `account.status` back to `'guest'`, which alone (not `session`/`profileError`
   * clearing) blocks this effect from ever refiring for the same, now-signed-out account.
   */
  useEffect(() => {
    if (!pack) return;
    if (account.status !== 'signed-in') return;
    if (session !== undefined) return;
    if (profileError !== undefined) return;
    if (pendingProfileStart !== undefined) return;
    let cancelled = false;
    void ProfileSession.connect({
      pack,
      url: playWsUrl(),
      ...(createSocket ? { createSocket } : {}),
    }).then(
      (outcome) => {
        if (cancelled) {
          if (outcome.kind === 'session') outcome.session.close();
          else outcome.pending.close();
          return;
        }
        if (outcome.kind === 'session') {
          setSession(outcome.session);
          router.toPlay();
          return;
        }
        // The profile has no run yet: hold the connection and route through the SAME chargen
        // wizard guests use -- its confirm sends the choices over this connection (see the
        // profile branch in the chargen screen's onConfirm below).
        setPendingProfileStart(outcome.pending);
        setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
        router.toChargen();
      },
      (thrown: unknown) => {
        if (cancelled) return;
        setProfileError(
          thrown instanceof Error ? thrown.message : 'Could not reach your saved run.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // `router.toPlay` (read above) is a fresh closure every render (see `useScreenRouter`) --
    // depending on it would re-run (and reconnect) this effect on every unrelated re-render. The
    // `session`/`profileError` guards above already make this a run-once-per-sign-in effect
    // regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, account.status, session, profileError, createSocket]);

  /** Closes the underlying `/ws/play` connection whenever `session` stops being the live
   * `ProfileSession` -- covers both the sign-out teardown above and the component unmounting
   * outright. A no-op for a `GuestSession` (or no session at all), so guest behavior is
   * unaffected. */
  useEffect(() => {
    return () => {
      if (session instanceof ProfileSession) session.close();
    };
  }, [session]);

  if (error) {
    return (
      <RootStyling settings={settings} fadeToken={router.fadeToken}>
        <main className="shell boot-error">
          <p className="eyebrow">The Woven Deep</p>
          <h1>The archive would not answer.</h1>
          <p role="alert">{error}</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </main>
      </RootStyling>
    );
  }

  if (!pack) {
    return (
      <RootStyling settings={settings} fadeToken={router.fadeToken}>
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">Binding the current content pack…</p>
        </main>
      </RootStyling>
    );
  }

  /** The current screen's content, before the persistent-warning and root-styling wrappers. Every
   * post-boot screen shares those two wrappers (applied once below), so each branch here returns
   * only its own inner element. Takes the loaded `pack` so it stays non-nullable throughout. */
  function renderScreen(pack: CompiledContentPack): JSX.Element {
    if (screen.screen === 'title') {
      // A signed-in profile's `ProfileSession.connect` rejected outright (content/version
      // mismatch, or the handshake never completing) -- surfaced the same way the content-pack
      // fetch failure is above, since there is no session/notice to carry this through yet.
      if (account.status === 'signed-in' && profileError) {
        return (
          <main className="shell boot-error">
            <p className="eyebrow">The Woven Deep</p>
            <h1>Your run could not be reached.</h1>
            <p role="alert">{profileError}</p>
            <button type="button" onClick={() => setProfileError(undefined)}>
              Retry
            </button>
          </main>
        );
      }
      return (
        <main className="shell">
          <TitleScreen
            storage={storage}
            account={account}
            onEnterTheDeep={() => {
              // Guests only -- a signed-in profile's run is server-authoritative and connects
              // automatically (see the connect effect above); there is no client-side chargen
              // wizard for it (hero customization for profiles is a later milestone).
              if (account.status !== 'guest') return;
              closeOverlay();
              setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
              router.toChargen();
            }}
            onContinue={() => {
              if (account.status !== 'guest') return;
              closeOverlay();
              setPortraitGlyph(storage.get(PORTRAIT_KEY) ?? undefined);
              setSession(
                new GuestSession({
                  pack,
                  storage,
                  localStorage: localStorageInstance,
                  records: recordsFor(pack),
                }),
              );
              router.toPlay();
            }}
            onHall={() => router.toHall('title')}
            onOpenOverlay={openOverlay}
            onSignIn={() => router.toSignin()}
            onSignOut={handleSignOut}
          />
          <OverlayHost
            overlay={overlay}
            onClose={closeOverlay}
            isPlayActive={false}
            records={repository.records()}
            onClearGuestSession={handleClearGuestSession}
            sightings={loadSightings(storage).sightings}
            account={account}
          />
        </main>
      );
    }

    if (screen.screen === 'signin') {
      return (
        <main className="shell">
          <SignInScreen fetcher={fetcher} onBack={() => router.toTitle()} />
        </main>
      );
    }

    if (screen.screen === 'chargen') {
      if (chargenError) {
        return (
          <main className="shell boot-error">
            <p className="eyebrow">The Woven Deep</p>
            <h1>Something went wrong building your hero.</h1>
            <p role="alert">{chargenError}</p>
            <button type="button" onClick={() => setChargenError(undefined)}>
              Back
            </button>
          </main>
        );
      }
      // `chargenSeed` is always set before this screen is reached (see `onEnterTheDeep` above).
      const seed = chargenSeed!;
      return (
        <ChargenScreen
          pack={pack}
          seed={seed}
          settings={settings}
          onChangeSettings={handleSettingsChange}
          unlockedClassIds={account.unlockedClassIds}
          onConfirm={(choices: HeroChoices, glyph: string, mode: RunMode) => {
            try {
              storage.set(PORTRAIT_KEY, glyph);
            } catch {
              // Best-effort, same as every other portrait/cosmetic persistence attempt in this app —
              // the run itself is unaffected if this particular write fails.
            }
            setPortraitGlyph(glyph);
            // A signed-in profile's confirm sends the CHOICES to the server over the held
            // connection -- the server rebuilds and validates the hero itself and rolls its own
            // seed (anti-cheat), so nothing hero-shaped is trusted from this client.
            if (pendingProfileStart !== undefined) {
              void pendingProfileStart.startRun(choices, mode).then(
                (profileSession) => {
                  setPendingProfileStart(undefined);
                  setSession(profileSession);
                  router.toPlay();
                },
                (thrown: unknown) => {
                  // Rejected choices leave the connection open -- surface the reason and let the
                  // wizard correct and resend.
                  setChargenError(
                    thrown instanceof Error ? thrown.message : 'Hero creation was refused.',
                  );
                },
              );
              return;
            }
            let hero: ReturnType<typeof heroFromChoices>;
            try {
              hero = heroFromChoices({ pack, choices });
            } catch (thrown) {
              // A client bug (a malformed choice heroFromChoices' own validation somehow missed
              // upstream) must never fail silently -- surface it visibly rather than only logging.
              setChargenError(
                thrown instanceof Error ? thrown.message : 'Hero creation failed unexpectedly.',
              );
              return;
            }
            setSession(
              new GuestSession({
                pack,
                storage,
                seed,
                hero,
                startFresh: true,
                localStorage: localStorageInstance,
                records: recordsFor(pack),
                mode,
              }),
            );
            router.toPlay();
          }}
        />
      );
    }

    if (screen.screen === 'hall') {
      const { returnTo } = screen;
      return (
        <main className="shell">
          <HallScreen
            pack={pack}
            repository={repository}
            onBack={() => router.returnFromHall(returnTo)}
          />
        </main>
      );
    }

    if (screen.screen === 'conclusion') {
      // `conclusion` is always set before this screen is reached — `GameRoot`'s `onConcluded`
      // (below) sets both together, in the same event.
      if (!conclusion) {
        return (
          <main className="shell boot-loading">
            <p className="eyebrow">The Woven Deep</p>
            <p role="status">The run has ended.</p>
          </main>
        );
      }
      return (
        <ConclusionScreen
          projection={conclusion.projection}
          pack={pack}
          logTail={conclusion.logTail}
          onHall={() => router.toHall('conclusion')}
          onNewHero={() => {
            const wasProfile = session instanceof ProfileSession;
            setSession(undefined);
            setConclusion(undefined);
            if (wasProfile) {
              // Dropping `session` re-arms the profile connect effect: the finalized run's row is
              // gone server-side, so the reconnect answers `no-run` and routes into chargen with a
              // HELD connection -- the profile path. Pre-routing here would open the guest wizard
              // instead and confirm into a GuestSession while signed in.
              return;
            }
            setChargenSeed(parseSeedFromQuery(window.location.search) ?? randomSeed());
            router.toChargen();
          }}
          onTitle={() => {
            setSession(undefined);
            setConclusion(undefined);
            router.toTitle();
          }}
        />
      );
    }

    if (!session) {
      return (
        <main className="shell boot-loading">
          <p className="eyebrow">The Woven Deep</p>
          <p role="status">Binding the current content pack…</p>
        </main>
      );
    }

    return (
      <GameRoot
        session={session}
        pack={pack}
        repository={repository}
        portraitGlyph={portraitGlyph}
        overlay={overlay}
        onOpenOverlay={openOverlay}
        onCloseOverlay={closeOverlay}
        onClearGuestSession={handleClearGuestSession}
        onSignOut={account.status === 'signed-in' ? handleSignOut : undefined}
        onDeleteAccount={account.status === 'signed-in' ? handleDeleteAccount : undefined}
        account={account}
        onboardingEnabled={settings.onboarding === 'on' && !quickstart}
        onConcluded={(projection, logTail) => {
          setConclusion({ projection, logTail });
          router.toConclusion();
        }}
        onFinalizeError={setFinalizeWarning}
      />
    );
  }

  return (
    <RootStyling settings={settings} fadeToken={router.fadeToken}>
      <AppBanners
        hallNotice={hallNotice}
        finalizeWarning={finalizeWarning}
        settingsWriteWarning={settingsWriteWarning}
        showSettingsCorrupted={settingsLoad.corrupted && !settingsCorruptedDismissed}
        onDismissSettingsCorrupted={() => setSettingsCorruptedDismissed(true)}
      >
        <UiProviders
          pack={pack}
          settings={settings}
          onChangeSettings={handleSettingsChange}
          session={session}
          repository={repository}
        >
          {renderScreen(pack)}
        </UiProviders>
      </AppBanners>
    </RootStyling>
  );
}
